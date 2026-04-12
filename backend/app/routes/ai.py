import json

from requests import RequestException
from flask import Blueprint, current_app, jsonify, request

from ..services.settings_store import get_ai_settings
from ..services.ai_client import (
    build_compat_chat_response,
    build_health_payload,
    build_openai_chat_response,
    call_gateway_chat,
    call_gateway_openai_chat,
)
from ..services.smart_analysis import (
    build_execution_plan,
    build_output_payload,
    get_cached_result,
    has_meaningful_ticket_data,
    parse_llm_json,
    prepare_analysis_request,
    save_cached_result,
    smart_analysis_requested,
)


ai_bp = Blueprint('ai', __name__)


def _default_ai_settings():
    return {
        'pipeline': {
            'preview_max_rows': int(current_app.config.get('PREVIEW_MAX_ROWS', 10)),
            'focused_max_rows': int(current_app.config.get('FOCUSED_MAX_ROWS', 5)),
            'enable_chunking': bool(current_app.config.get('ENABLE_CHUNKING', True)),
        },
    }


def _gateway_payload(payload):
    next_payload = dict(payload or {})
    next_payload.pop('model', None)
    return next_payload


def _run_model_prompt(prompt, analysis_mode='preview'):
    payload = _gateway_payload({'message': prompt, 'analysis_mode': analysis_mode})
    result = call_gateway_chat(payload, current_app.config['AI_GATEWAY_BASE_URL'])
    return result.get('message', '')


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

    plan = build_execution_plan(prepared, 'gateway-managed')

    if prepared['mode'] == 'full_dataset':
        if not ai_settings.get('pipeline', {}).get('enable_chunking', True):
            plan = {
                'mode': prepared['mode'],
                'model': 'gateway-managed',
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
            parsed = parse_llm_json(_run_model_prompt(plan['prompt'], analysis_mode='full_dataset'))
            meta = {
                'records_used': prepared['recordCount'],
                'truncated': prepared['truncated'],
                'chunked': False,
                'model': 'gateway-managed',
            }
            output = build_output_payload(prepared['mode'], parsed, meta)
            if prepared.get('cacheKey'):
                save_cached_result(prepared['cacheKey'], output)
            return output

        chunk_summaries = []
        for chunk_prompt in plan['chunks']:
            chunk_result = parse_llm_json(_run_model_prompt(chunk_prompt, analysis_mode='focused'))
            chunk_summaries.append(
                {
                    'summary': chunk_result.get('summary', ''),
                    'insights': chunk_result.get('insights', []),
                }
            )

        final_prompt = plan['finalPrompt'](chunk_summaries, prepared)
        parsed = parse_llm_json(_run_model_prompt(final_prompt, analysis_mode='full_dataset'))
        meta = {
            'records_used': prepared['recordCount'],
            'truncated': prepared['truncated'],
            'chunked': True,
            'chunk_count': len(chunk_summaries),
            'model': 'gateway-managed',
        }
    else:
        parsed = parse_llm_json(_run_model_prompt(plan['prompt'], analysis_mode=prepared['mode']))
        meta = {
            'records_used': prepared['recordsUsed'],
            'truncated': prepared['truncated'],
            'chunked': False,
            'model': 'gateway-managed',
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

    payload = _gateway_payload(raw_payload)

    try:
        result = call_gateway_chat(payload, current_app.config['AI_GATEWAY_BASE_URL'])
        return jsonify(build_compat_chat_response(payload, result))
    except ValueError as error:
        return jsonify({'error': str(error)}), 400
    except RequestException as error:
        return jsonify({'error': f'AI request failed: {error}'}), 503


@ai_bp.post('/ai/v1/chat/completions')
@ai_bp.post('/api/ai/v1/chat/completions')
@ai_bp.post('/v1/chat/completions')
def openai_chat():
    payload = _gateway_payload(request.get_json(silent=True) or {})

    try:
        return jsonify(build_openai_chat_response(call_gateway_openai_chat(payload, current_app.config['AI_GATEWAY_BASE_URL'])))
    except ValueError as error:
        return jsonify({'error': {'message': str(error), 'type': 'invalid_request_error'}}), 400
    except RequestException as error:
        return jsonify({'error': {'message': f'AI request failed: {error}', 'type': 'service_unavailable'}}), 503


@ai_bp.get('/ai/health')
@ai_bp.get('/api/ai/health')
def health():
    return jsonify(
        build_health_payload(
            app_name=current_app.config['APP_NAME'],
            model='gateway-managed',
            api_base=current_app.config['AI_GATEWAY_BASE_URL'],
            use_ai_gateway=True,
        )
    )
