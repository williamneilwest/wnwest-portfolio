import logging
from time import perf_counter

from litellm import completion


LOGGER = logging.getLogger(__name__)


def _uses_ollama(model, api_base):
    return bool(api_base) and (model == 'mistral' or model.startswith('ollama/'))


def _extract_message_content(message):
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


def _normalize_messages(payload):
    if isinstance(payload.get('messages'), list) and payload['messages']:
        return payload['messages']

    prompt = str(payload.get('message', '')).strip()
    if not prompt:
        raise ValueError('A prompt is required.')

    return [{'role': 'user', 'content': prompt}]


def clean_ai_output(text):
    cleaned = str(text or '').strip()

    if cleaned.startswith('```'):
        cleaned = cleaned.strip()
        if cleaned.startswith('```json'):
            cleaned = cleaned[len('```json') :].strip()
        elif cleaned.startswith('```'):
            cleaned = cleaned[3:].strip()

        if cleaned.endswith('```'):
            cleaned = cleaned[:-3].strip()

    return cleaned


def run_chat_completion(payload, model, temperature, max_tokens, api_base):
    if not model:
        raise RuntimeError('LiteLLM model is not configured. Set LITELLM_MODEL in the environment.')

    messages = _normalize_messages(payload)
    request_temperature = 0.2
    request_max_tokens = min(int(payload.get('max_tokens', max_tokens)), 100)

    request_kwargs = {
        'model': model,
        'messages': messages,
        'temperature': request_temperature,
        'max_tokens': request_max_tokens,
        'stream': False,
    }

    if _uses_ollama(model, api_base):
        request_kwargs['api_base'] = api_base
        request_kwargs['extra_body'] = {
            'keep_alive': -1,
            'options': {
                'num_predict': 100,
                'num_ctx': 1024,
                'temperature': 0.2,
            },
        }

    started_at = perf_counter()
    LOGGER.info('Starting AI request for model %s', model)

    try:
        response = completion(**request_kwargs)
    except Exception as error:
        LOGGER.info('AI request failed for model %s in %.2fs', model, perf_counter() - started_at)
        if _uses_ollama(model, api_base):
            raise RuntimeError(
                'LiteLLM could not reach Ollama. Verify OLLAMA_API_BASE and that the Ollama server is running.'
            ) from error
        raise RuntimeError(f'LiteLLM request failed: {error}') from error

    LOGGER.info('AI request finished for model %s in %.2fs', model, perf_counter() - started_at)

    return response.model_dump() if hasattr(response, 'model_dump') else response


def warmup_chat_completion(model, temperature, max_tokens, api_base):
    if not model:
        return

    request_kwargs = {
        'model': model,
        'messages': [{'role': 'user', 'content': 'warmup'}],
        'temperature': 0.2,
        'max_tokens': 1,
        'stream': False,
    }

    if _uses_ollama(model, api_base):
        request_kwargs['api_base'] = api_base
        request_kwargs['extra_body'] = {
            'keep_alive': -1,
            'options': {
                'num_predict': 100,
                'num_ctx': 1024,
                'temperature': 0.2,
            },
        }

    completion(**request_kwargs)


def build_compat_chat_response(payload, result):
    choices = result.get('choices') or []
    first_choice = choices[0] if choices else {}
    message = first_choice.get('message') or {}
    content = clean_ai_output(_extract_message_content(message))

    return {
        'status': 'ok',
        'message': content,
        'model': result.get('model'),
        'received': payload,
        'usage': result.get('usage'),
    }


def build_openai_chat_response(result):
    return result
