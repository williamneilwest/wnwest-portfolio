from flask import Blueprint, current_app, jsonify, request

from ..services.chat import (
    build_compat_chat_response,
    build_openai_chat_response,
    run_chat_completion,
)

chat_bp = Blueprint('chat', __name__)


def _request_model(payload):
    model = str(payload.get('model', '')).strip()
    if model:
        return model

    return current_app.config['LITELLM_MODEL']


@chat_bp.post('/ai/chat')
@chat_bp.post('/api/ai/chat')
@chat_bp.post('/chat')
def chat():
    payload = request.get_json(silent=True) or {}
    try:
        result = run_chat_completion(
            payload=payload,
            model=_request_model(payload),
            temperature=current_app.config['LITELLM_TEMPERATURE'],
            max_tokens=current_app.config['LITELLM_MAX_TOKENS'],
            api_base=current_app.config['OLLAMA_API_BASE'],
        )
        return jsonify(build_compat_chat_response(payload, result))
    except ValueError as error:
        return jsonify({'error': str(error)}), 400
    except RuntimeError as error:
        return jsonify({'error': str(error)}), 503


@chat_bp.post('/ai/v1/chat/completions')
@chat_bp.post('/api/ai/v1/chat/completions')
@chat_bp.post('/v1/chat/completions')
def openai_chat():
    payload = request.get_json(silent=True) or {}

    try:
        result = run_chat_completion(
            payload=payload,
            model=_request_model(payload),
            temperature=current_app.config['LITELLM_TEMPERATURE'],
            max_tokens=current_app.config['LITELLM_MAX_TOKENS'],
            api_base=current_app.config['OLLAMA_API_BASE'],
        )
        return jsonify(build_openai_chat_response(result))
    except ValueError as error:
        return jsonify({'error': {'message': str(error), 'type': 'invalid_request_error'}}), 400
    except RuntimeError as error:
        return jsonify({'error': {'message': str(error), 'type': 'service_unavailable'}}), 503
