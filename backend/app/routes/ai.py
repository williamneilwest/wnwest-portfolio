import json

from requests import RequestException
from flask import Blueprint, current_app, jsonify, request

from ..services.settings_store import get_ai_model, get_ai_settings
from ..services.ai_client import (
    build_compat_chat_response,
    build_health_payload,
    build_openai_chat_response,
    call_gateway_chat,
    call_gateway_openai_chat,
    call_ollama_generate,
)
from ..services.smart_analysis import (
    build_execution_plan,
    build_output_payload,
    get_cached_result,
    has_meaningful_ticket_data,
    parse_llm_json,
    preferred_model,
    prepare_analysis_request,
    save_cached_result,
    smart_analysis_requested,
)


ai_bp = Blueprint('ai', __name__)


def _using_gateway():
    return bool(current_app.config.get('USE_AI_GATEWAY'))


def _is_gateway_model(model):
    normalized = str(model or '').strip().lower()
    if not normalized:
        return _using_gateway()

    if normalized.startswith(('gpt-', 'o1', 'o3', 'o4', 'openai/', 'anthropic/', 'gemini/')):
        return True

    return '/' in normalized and not normalized.startswith('ollama/')


def _payload_with_model(payload):
    next_payload = dict(payload)
    active_model = get_ai_model(
        mode='deep',
        defaults=_default_ai_settings(),
    )
    if _is_gateway_model(active_model):
        next_payload.setdefault('model', active_model)

    return next_payload


def _available_models():
    configured = str(current_app.config.get('AVAILABLE_AI_MODELS', '') or '').strip()
    models = [model.strip() for model in configured.split(',') if model.strip()]

    if not models:
        models = ['ollama/llama3.2', 'ollama/mistral', 'qwen2.5-coder']

    if current_app.config.get('OPENAI_API_KEY'):
        for model in ('gpt-4o-mini', 'gpt-4o'):
            if model not in models:
                models.append(model)

    return models


def _default_ai_settings():
    return {
        'models': {
            'preview': current_app.config.get('OLLAMA_MODEL', 'ollama/llama3.2'),
            'focused': current_app.config.get('LITELLM_MODEL', 'gpt-4o-mini'),
            'deep': current_app.config.get('LITELLM_MODEL', 'gpt-4o'),
        },
        'pipeline': {
            'preview_max_rows': int(current_app.config.get('PREVIEW_MAX_ROWS', 10)),
            'focused_max_rows': int(current_app.config.get('FOCUSED_MAX_ROWS', 5)),
            'enable_chunking': bool(current_app.config.get('ENABLE_CHUNKING', True)),
        },
    }


def _run_model_prompt(prompt, model, analysis_mode='preview'):
    payload = _payload_with_model({'message': prompt, 'model': model, 'analysis_mode': analysis_mode})
    active_model = str(payload.get('model') or model).strip()

    if _is_gateway_model(active_model):
        result = call_gateway_chat(payload, current_app.config['AI_GATEWAY_BASE_URL'])
        return result.get('message', '')

    result = call_ollama_generate(
        payload=payload,
        ollama_api_base=current_app.config['OLLAMA_API_BASE'],
        ollama_model=active_model,
    )
    return result.get('response', '')


def _run_smart_analysis(payload):
    ai_settings = get_ai_settings(defaults=_default_ai_settings())
    prepared = prepare_analysis_request(payload, settings=ai_settings)
    if not has_meaningful_ticket_data(prepared):
        return {
            'status': 'no_data',
            'mode': prepared['mode'],
            'summary': 'Not enough ticket data to analyze.',
            'insights': [],
            'message': 'Not enough ticket data to analyze.',
            'meta': {
                'records_used': prepared['recordsUsed'],
                'truncated': prepared['truncated'],
                'chunked': False,
            },
        }

    cached_result = get_cached_result(prepared['cacheKey']) if prepared.get('cacheKey') else None
    if cached_result:
        return cached_result

    model = str(payload.get('model') or '').strip() or preferred_model(prepared['mode'], _available_models(), settings=ai_settings)
    plan = build_execution_plan(prepared, model)

    if prepared['mode'] == 'full_dataset':
        if not ai_settings.get('pipeline', {}).get('enable_chunking', True):
            # Fall back to the focused-style pass over the selected records when chunking is disabled.
            plan = {
                'mode': prepared['mode'],
                'model': model,
                'prompt': '\n'.join(
                    [
                        'Analyze the following dataset and summarize the major trends, issues, and anomalies.',
                        'Return valid JSON with keys: summary, insights, meta.',
                        f'Dataset: {prepared["fileName"]}',
                        'Records:',
                        json.dumps(prepared['records'], ensure_ascii=False, indent=2),
                    ]
                ),
            }
            parsed = parse_llm_json(_run_model_prompt(plan['prompt'], model, analysis_mode='full_dataset'))
            meta = {
                'records_used': prepared['recordCount'],
                'truncated': prepared['truncated'],
                'chunked': False,
                'model': model,
            }
            output = build_output_payload(prepared['mode'], parsed, meta)
            if prepared.get('cacheKey'):
                save_cached_result(prepared['cacheKey'], output)
            return output

        chunk_summaries = []
        for chunk_prompt in plan['chunks']:
            chunk_result = parse_llm_json(_run_model_prompt(chunk_prompt, model, analysis_mode='focused'))
            chunk_summaries.append(
                {
                    'summary': chunk_result.get('summary', ''),
                    'insights': chunk_result.get('insights', []),
                }
            )

        final_prompt = plan['finalPrompt'](chunk_summaries, prepared)
        parsed = parse_llm_json(_run_model_prompt(final_prompt, model, analysis_mode='full_dataset'))
        meta = {
            'records_used': prepared['recordCount'],
            'truncated': prepared['truncated'],
            'chunked': True,
            'chunk_count': len(chunk_summaries),
            'model': model,
        }
    else:
        parsed = parse_llm_json(_run_model_prompt(plan['prompt'], model, analysis_mode=prepared['mode']))
        meta = {
            'records_used': prepared['recordsUsed'],
            'truncated': prepared['truncated'],
            'chunked': False,
            'model': model,
        }

    output = build_output_payload(prepared['mode'], parsed, meta)
    if prepared.get('cacheKey'):
        save_cached_result(prepared['cacheKey'], output)
    return output


@ai_bp.post('/ai/chat')
@ai_bp.post('/api/ai/chat')
@ai_bp.post('/chat')
def chat():
    raw_payload = request.get_json(silent=True) or {}

    if smart_analysis_requested(raw_payload):
        try:
            output = _run_smart_analysis(raw_payload)
            return jsonify(
                {
                    **output,
                }
            )
        except ValueError as error:
            return jsonify({'error': str(error)}), 400
        except RequestException as error:
            return jsonify({'error': f'AI request failed: {error}'}), 503

    payload = _payload_with_model(raw_payload)
    active_model = get_ai_model(mode='deep', defaults=_default_ai_settings())

    try:
        if _is_gateway_model(active_model):
            return jsonify(call_gateway_chat(payload, current_app.config['AI_GATEWAY_BASE_URL']))

        result = call_ollama_generate(
            payload=payload,
            ollama_api_base=current_app.config['OLLAMA_API_BASE'],
            ollama_model=active_model,
        )
        return jsonify(build_compat_chat_response(payload, result))
    except ValueError as error:
        return jsonify({'error': str(error)}), 400
    except RequestException as error:
        return jsonify({'error': f'AI request failed: {error}'}), 503


@ai_bp.post('/ai/v1/chat/completions')
@ai_bp.post('/api/ai/v1/chat/completions')
@ai_bp.post('/v1/chat/completions')
def openai_chat():
    payload = _payload_with_model(request.get_json(silent=True) or {})
    active_model = get_ai_model(mode='deep', defaults=_default_ai_settings())

    try:
        if _is_gateway_model(active_model):
            return jsonify(call_gateway_openai_chat(payload, current_app.config['AI_GATEWAY_BASE_URL']))

        result = call_ollama_generate(
            payload=payload,
            ollama_api_base=current_app.config['OLLAMA_API_BASE'],
            ollama_model=active_model,
        )
        return jsonify(build_openai_chat_response(result, active_model))
    except ValueError as error:
        return jsonify({'error': {'message': str(error), 'type': 'invalid_request_error'}}), 400
    except RequestException as error:
        return jsonify({'error': {'message': f'AI request failed: {error}', 'type': 'service_unavailable'}}), 503


@ai_bp.get('/ai/health')
@ai_bp.get('/api/ai/health')
def health():
    model = get_ai_model(mode='deep', defaults=_default_ai_settings())
    use_gateway = _is_gateway_model(model)
    api_base = current_app.config['AI_GATEWAY_BASE_URL'] if use_gateway else current_app.config['OLLAMA_API_BASE']

    return jsonify(
        build_health_payload(
            app_name=current_app.config['APP_NAME'],
            model=model,
            api_base=api_base,
            use_ai_gateway=use_gateway,
        )
    )
