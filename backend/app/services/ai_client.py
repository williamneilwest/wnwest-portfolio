import logging
import re
from time import perf_counter

import requests


DEFAULT_TIMEOUT_SECONDS = 120
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


def normalize_messages(payload):
    if isinstance(payload.get('messages'), list) and payload['messages']:
        cleaned_messages = []
        for message in payload['messages']:
            if not isinstance(message, dict):
                continue

            cleaned_content = clean_message_content(message.get('content', ''))
            if not extract_message_content({'content': cleaned_content}).strip():
                continue

            cleaned_messages.append({**message, 'content': cleaned_content})

        if not cleaned_messages:
            raise ValueError('A prompt is required.')

        return cleaned_messages

    prompt = clean_ticket_text(payload.get('message', ''))
    if not prompt:
        raise ValueError('A prompt is required.')

    return [{'role': 'user', 'content': prompt}]


def build_prompt(payload):
    messages = normalize_messages(payload)

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

    if isinstance(payload.get('messages'), list):
        sanitized['messages'] = normalize_messages(payload)
        return sanitized

    if 'message' in payload:
        sanitized['message'] = clean_ticket_text(payload.get('message', ''))

    return sanitized


def call_gateway_chat(payload, gateway_base_url, timeout_seconds=DEFAULT_TIMEOUT_SECONDS):
    sanitized_payload = sanitize_payload(payload)
    response = requests.post(
        f"{gateway_base_url.rstrip('/')}/v1/chat/completions",
        json=sanitized_payload,
        timeout=timeout_seconds,
    )
    response.raise_for_status()
    return response.json()


def call_gateway_openai_chat(payload, gateway_base_url):
    sanitized_payload = sanitize_payload(payload)
    response = requests.post(
        f"{gateway_base_url.rstrip('/')}/v1/chat/completions",
        json=sanitized_payload,
        timeout=DEFAULT_TIMEOUT_SECONDS,
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
        timeout=DEFAULT_TIMEOUT_SECONDS,
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
