import logging
import os
import re
import json
from time import perf_counter

import requests
from flask import current_app, has_app_context
from requests import RequestException
from .agent_store import get_agent

from .ai_interaction_log import write_ai_interaction

DEFAULT_CONNECT_TIMEOUT_SECONDS = 5
DEFAULT_READ_TIMEOUT_SECONDS = 20
DEFAULT_REQUEST_TIMEOUT = (DEFAULT_CONNECT_TIMEOUT_SECONDS, DEFAULT_READ_TIMEOUT_SECONDS)
MAX_PROMPT_CHARS = 12000
ACK_PATTERNS = [
    r'thank you for contacting.*?(?=\n|$)',
    r'your ticket has been received.*?(?=\n|$)',
    r'we will be in contact with you.*?(?=\n|$)',
    r'feel free to check.*?(?=\n|$)',
    r'thank you for taking the time.*?(?=\n|$)',
    r'ticket has been prioritized.*?(?=\n|$)',
    r'https?://\S+',
    r'help desk acknowledged ticket',
    r'acknowledged ticket with template',
    r'andi acknowledged ticket.*?(?=\n|$)',
]


LOGGER = logging.getLogger(__name__)


def _preserve_prompt(payload):
    if not isinstance(payload, dict):
        return False
    if bool(payload.get('preserve_prompt')):
        return True
    return str(payload.get('analysis_mode') or '').strip().lower() == 'document_processing'


def extract_message_content(message):
    content = message.get('content', '')

    if isinstance(content, str):
        return content

    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get('type') == 'text':
                parts.append(item.get('text', ''))
        return '\n'.join(part for part in parts if part)

    return ''


def clean_ticket_text(text):
    if not text:
        return ''

    cleaned = str(text)

    for pattern in ACK_PATTERNS:
        cleaned = re.sub(pattern, '', cleaned, flags=re.IGNORECASE | re.DOTALL)

    filtered_lines = []
    for raw_line in cleaned.splitlines():
        line = re.sub(r'\s+', ' ', raw_line).strip()
        if not line:
            continue

        word_count = len(line.split())
        if word_count < 15 and 'thank you' in line.lower():
            continue

        filtered_lines.append(line)

    cleaned = '\n'.join(filtered_lines)
    cleaned = re.sub(r'\n\s*\n+', '\n', cleaned)
    cleaned = cleaned.strip()

    return cleaned


def clean_ai_output(text):
    output = str(text or '').strip()
    if not output:
        return ''

    output = re.sub(r'```(?:json)?', '', output, flags=re.IGNORECASE)
    output = output.replace('```', '')
    return output.strip()


def clean_message_content(content):
    if isinstance(content, str):
        return clean_ticket_text(content)

    if isinstance(content, list):
        cleaned_content = []
        for item in content:
            if not isinstance(item, dict):
                cleaned_content.append(item)
                continue

            if item.get('type') != 'text':
                cleaned_content.append(item)
                continue

            cleaned_text = clean_ticket_text(item.get('text', ''))
            if cleaned_text:
                cleaned_content.append({**item, 'text': cleaned_text})

        return cleaned_content

    return content


def normalize_messages(payload, preserve_prompt=False):
    if isinstance(payload.get('messages'), list) and payload['messages']:
        cleaned_messages = []
        for message in payload['messages']:
            if not isinstance(message, dict):
                continue

            cleaned_content = message.get('content', '') if preserve_prompt else clean_message_content(message.get('content', ''))
            if not extract_message_content({'content': cleaned_content}).strip():
                continue

            cleaned_messages.append({**message, 'content': cleaned_content})

        if not cleaned_messages:
            raise ValueError('A prompt is required.')

        return cleaned_messages

    prompt = str(payload.get('message', '') or '').strip() if preserve_prompt else clean_ticket_text(payload.get('message', ''))
    if not prompt:
        raise ValueError('A prompt is required.')

    return [{'role': 'user', 'content': prompt}]


def build_prompt(payload):
    messages = normalize_messages(payload, preserve_prompt=_preserve_prompt(payload))

    if len(messages) == 1:
        return extract_message_content(messages[0]).strip()

    parts = []
    for message in messages:
        content = extract_message_content(message).strip()
        if not content:
            continue
        role = str(message.get('role', 'user')).strip() or 'user'
        parts.append(f'{role}: {content}')

    prompt = '\n\n'.join(parts).strip()
    if not prompt:
        raise ValueError('A prompt is required.')

    if len(prompt) > MAX_PROMPT_CHARS:
        prompt = prompt[:MAX_PROMPT_CHARS].rstrip()

    return prompt


def sanitize_payload(payload):
    if not isinstance(payload, dict):
        return {}

    sanitized = dict(payload)
    preserve_prompt = _preserve_prompt(payload)
    sanitized.pop('preserve_prompt', None)

    if isinstance(payload.get('messages'), list):
        sanitized['messages'] = normalize_messages(payload, preserve_prompt=preserve_prompt)
        return sanitized

    if 'message' in payload:
        sanitized['message'] = str(payload.get('message', '') or '').strip() if preserve_prompt else clean_ticket_text(payload.get('message', ''))

    return sanitized


def resolve_prompt(agent_id, user_input, context=None):
    selected_agent_id = str(agent_id or "").strip()
    if not selected_agent_id:
        return ""

    agent = get_agent(selected_agent_id)
    if not agent or not agent.get("enabled", True):
        return ""

    template = str(agent.get("prompt_template") or "").strip()
    if not template:
        return ""

    input_text = str(user_input or "").strip()
    if not input_text:
        input_text = "No user input provided."

    if isinstance(context, (dict, list)):
        context_text = json.dumps(context, ensure_ascii=False, indent=2)
    else:
        context_text = str(context or "").strip()

    return template.replace("{{input}}", input_text).replace("{{context}}", context_text)


def call_gateway_chat(payload, gateway_base_url, timeout_seconds=DEFAULT_REQUEST_TIMEOUT, agent_id=None, context=None):
    if not str(gateway_base_url or "").strip():
        raise RequestException('AI gateway is not configured.')
    if has_app_context() and not current_app.config.get('USE_AI_GATEWAY', False):
        raise RequestException('AI gateway is disabled by configuration.')

    next_payload = dict(payload or {})
    selected_agent_id = str(agent_id or next_payload.get("agent_id") or "").strip()
    if selected_agent_id:
        try:
            user_input = build_prompt(next_payload)
        except ValueError:
            user_input = str(next_payload.get("message") or "").strip()

        resolved = resolve_prompt(
            selected_agent_id,
            user_input=user_input,
            context=context if context is not None else next_payload.get("context"),
        )
        if resolved:
            next_payload.pop("messages", None)
            next_payload["message"] = resolved

    logged_agent_id = selected_agent_id
    next_payload.pop("agent_id", None)
    sanitized_payload = sanitize_payload(next_payload)
    started_at = perf_counter()
    response = requests.post(
        f"{gateway_base_url.rstrip('/')}/v1/chat/completions",
        json=sanitized_payload,
        timeout=timeout_seconds,
    )
    response.raise_for_status()
    result = response.json()
    duration_ms = int((perf_counter() - started_at) * 1000)
    interaction_type = str((sanitized_payload or {}).get("type") or (sanitized_payload or {}).get("analysis_mode") or "chat")
    log_payload = dict(sanitized_payload)
    if logged_agent_id:
        log_payload["agent_id"] = logged_agent_id
    if next_payload.get("analysis_mode"):
        log_payload["analysis_mode"] = next_payload.get("analysis_mode")

    write_ai_interaction(log_payload, result, duration_ms, provider="ai-gateway", interaction_type=interaction_type)
    return result


def call_gateway_openai_chat(payload, gateway_base_url):
    sanitized_payload = sanitize_payload(payload)
    response = requests.post(
        f"{gateway_base_url.rstrip('/')}/v1/chat/completions",
        json=sanitized_payload,
        timeout=DEFAULT_REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    return response.json()


def call_ollama_generate(payload, ollama_api_base, ollama_model):
    prompt = build_prompt(payload)
    request_payload = {
        'model': ollama_model,
        'prompt': prompt,
        'stream': False,
        'options': {
            'temperature': 0,
            'top_p': 0.1,
            'repeat_penalty': 1.0,
            'num_predict': 200,
        },
    }
    started_at = perf_counter()
    response = requests.post(
        f"{ollama_api_base.rstrip('/')}/api/generate",
        json=request_payload,
        timeout=DEFAULT_REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    result = response.json()
    duration = perf_counter() - started_at

    LOGGER.info('Ollama request finished in %.2fs', duration)
    if duration > 5:
        LOGGER.warning('Ollama request exceeded 5 seconds: %.2fs', duration)

    return result


def build_compat_chat_response(payload, result):
    choices = result.get('choices') or []
    first_choice = choices[0] if choices else {}
    message = first_choice.get('message') or {}
    content = clean_ai_output(extract_message_content(message))

    return {
        'status': 'ok',
        'message': content,
        'model': result.get('model'),
        'received': payload,
        'usage': result.get('usage'),
    }


def build_openai_chat_response(result, _ignored_model=None):
    return result


def build_health_payload(app_name, model, api_base, use_ai_gateway):
    return {
        'name': app_name,
        'service': 'backend-ai',
        'status': 'ok',
        'provider': 'ai-gateway' if use_ai_gateway else 'ollama',
        'model': model or 'unconfigured',
        'apiBase': api_base,
    }


def send_chat(payload, timeout_seconds=DEFAULT_REQUEST_TIMEOUT):
    request_payload = payload if isinstance(payload, dict) else {}
    gateway_base_url = ''
    if has_app_context():
        gateway_base_url = str(current_app.config.get('AI_GATEWAY_BASE_URL') or '').strip()
    if not gateway_base_url:
        gateway_base_url = str(request_payload.get('gateway_base_url') or '').strip()
    if not gateway_base_url:
        gateway_base_url = str(os.getenv('AI_GATEWAY_BASE_URL', 'http://ai-gateway:5001')).strip()

    result = call_gateway_chat(request_payload, gateway_base_url, timeout_seconds=timeout_seconds)
    return build_compat_chat_response(request_payload, result)
