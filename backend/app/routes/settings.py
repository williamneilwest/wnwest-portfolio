import os

from flask import Blueprint, current_app, jsonify, request

from ..services.settings_store import get_ai_settings, save_ai_settings
from ..utils.deprecation import log_deprecated_route


settings_bp = Blueprint('settings', __name__)


def _available_ai_models():
    configured = os.getenv('AVAILABLE_AI_MODELS', 'ollama/llama3.2,gpt-4o-mini,gpt-4o')
    models = [model.strip() for model in configured.split(',') if model.strip()]

    if os.getenv('OPENAI_API_KEY'):
        for model in ('gpt-4o-mini', 'gpt-4o'):
            if model not in models:
                models.append(model)

    for model in ('ollama/llama3.2', 'gpt-4o-mini', 'gpt-4o'):
        if model not in models:
            models.append(model)

    return models


def _default_ai_settings():
    return {
        'models': {
            'preview': current_app.config.get('OLLAMA_MODEL', 'ollama/llama3.2'),
            'focused': current_app.config.get('LITELLM_MODEL', 'gpt-4o-mini'),
            'deep': current_app.config.get('LITELLM_MODEL', 'gpt-4o'),
            'document_processing': current_app.config.get('LITELLM_MODEL', 'gpt-4o-mini'),
        },
        'pipeline': {
            'preview_max_rows': int(current_app.config.get('PREVIEW_MAX_ROWS', 10)),
            'focused_max_rows': int(current_app.config.get('FOCUSED_MAX_ROWS', 5)),
            'enable_chunking': bool(current_app.config.get('ENABLE_CHUNKING', True)),
        },
    }


def _settings_payload():
    settings = get_ai_settings(defaults=_default_ai_settings())

    return {
        'provider': 'ai-gateway' if current_app.config.get('USE_AI_GATEWAY') else 'ollama',
        'useGateway': bool(current_app.config.get('USE_AI_GATEWAY')),
        'availableModels': _available_ai_models(),
        'currentModel': settings['models']['deep'],
        'models': settings['models'],
        'pipeline': settings['pipeline'],
        'note': 'AI settings are stored in backend data and apply to new requests immediately.',
    }


def _validate_model_map(model_map):
    available_models = set(_available_ai_models())
    required_keys = {'preview', 'focused', 'deep', 'document_processing'}

    if set(model_map.keys()) != required_keys:
        return 'models must include preview, focused, deep, and document_processing'

    for mode, model in model_map.items():
        normalized = str(model or '').strip()
        if not normalized:
            return f'{mode} model is required'
        if normalized not in available_models:
            return f'Unsupported model for {mode}: {normalized}'

    return ''


def _validate_pipeline(pipeline):
    preview_max_rows = pipeline.get('preview_max_rows')
    focused_max_rows = pipeline.get('focused_max_rows')

    try:
        preview_value = int(preview_max_rows)
        focused_value = int(focused_max_rows)
    except (TypeError, ValueError):
        return 'preview_max_rows and focused_max_rows must be integers'

    if preview_value < 1 or focused_value < 1:
        return 'preview_max_rows and focused_max_rows must be at least 1'

    return ''


@settings_bp.get('/api/settings')
@settings_bp.get('/settings')
def get_settings():
    if request.path == '/settings':
        log_deprecated_route('/settings', '/api/settings')

    return jsonify({'ai': _settings_payload()})


@settings_bp.get('/api/settings/ai')
@settings_bp.get('/settings/ai')
def get_ai_settings_route():
    if request.path == '/settings/ai':
        log_deprecated_route('/settings/ai', '/api/settings/ai')

    return jsonify(_settings_payload())


@settings_bp.post('/api/settings/ai')
@settings_bp.post('/settings/ai')
def update_ai_settings():
    if request.path == '/settings/ai':
        log_deprecated_route('/settings/ai', '/api/settings/ai')

    payload = request.get_json(silent=True) or {}
    models = payload.get('models') or {}
    pipeline = payload.get('pipeline') or {}

    model_error = _validate_model_map(models)
    if model_error:
        return jsonify({'error': model_error}), 400

    pipeline_error = _validate_pipeline(pipeline)
    if pipeline_error:
        return jsonify({'error': pipeline_error}), 400

    next_settings = save_ai_settings(
        {
            'models': {
                'preview': str(models['preview']).strip(),
                'focused': str(models['focused']).strip(),
                'deep': str(models['deep']).strip(),
                'document_processing': str(models['document_processing']).strip(),
            },
            'pipeline': {
                'preview_max_rows': int(pipeline['preview_max_rows']),
                'focused_max_rows': int(pipeline['focused_max_rows']),
                'enable_chunking': bool(pipeline.get('enable_chunking', True)),
            },
        },
        defaults=_default_ai_settings(),
    )

    return jsonify(
        {
            **_settings_payload(),
            'models': next_settings['models'],
            'pipeline': next_settings['pipeline'],
        }
    )
