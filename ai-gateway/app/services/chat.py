from litellm import completion


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


def run_chat_completion(payload, model, temperature, max_tokens, api_base):
    if not model:
        raise RuntimeError('LiteLLM model is not configured. Set LITELLM_MODEL in the environment.')

    messages = _normalize_messages(payload)
    request_temperature = payload.get('temperature', temperature)
    request_max_tokens = payload.get('max_tokens', max_tokens)

    request_kwargs = {
        'model': model,
        'messages': messages,
        'temperature': request_temperature,
        'max_tokens': request_max_tokens,
        'extra_body': {'keep_alive': -1},
    }

    if _uses_ollama(model, api_base):
        request_kwargs['api_base'] = api_base

    try:
        response = completion(**request_kwargs)
    except Exception as error:
        if _uses_ollama(model, api_base):
            raise RuntimeError(
                'LiteLLM could not reach Ollama. Verify OLLAMA_API_BASE and that the Ollama server is running.'
            ) from error
        raise RuntimeError(f'LiteLLM request failed: {error}') from error

    return response.model_dump() if hasattr(response, 'model_dump') else response


def warmup_chat_completion(model, temperature, max_tokens, api_base):
    if not model:
        return

    request_kwargs = {
        'model': model,
        'messages': [{'role': 'user', 'content': 'warmup'}],
        'temperature': temperature,
        'max_tokens': 1,
        'extra_body': {'keep_alive': -1},
    }

    if _uses_ollama(model, api_base):
        request_kwargs['api_base'] = api_base

    completion(**request_kwargs)


def build_compat_chat_response(payload, result):
    choices = result.get('choices') or []
    first_choice = choices[0] if choices else {}
    message = first_choice.get('message') or {}
    content = _extract_message_content(message)

    return {
        'status': 'ok',
        'message': content,
        'model': result.get('model'),
        'received': payload,
        'usage': result.get('usage'),
    }


def build_openai_chat_response(result):
    return result
