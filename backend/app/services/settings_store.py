import json
import os
from copy import deepcopy


DEFAULT_AI_SETTINGS = {
    'models': {
        'preview': 'ollama/llama3.2',
        'focused': 'gpt-4o-mini',
        'deep': 'gpt-4o',
        'document_processing': 'gpt-4o-mini',
    },
    'pipeline': {
        'preview_max_rows': 10,
        'focused_max_rows': 5,
        'enable_chunking': True,
    },
}


def _settings_path():
    configured_path = os.getenv('SETTINGS_PATH')
    if configured_path:
        return configured_path

    data_dir = os.getenv('BACKEND_DATA_DIR', '/app/data')
    return os.path.join(data_dir, 'settings.json')


def _deep_merge(base, updates):
    merged = deepcopy(base)

    for key, value in (updates or {}).items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
            continue

        merged[key] = value

    return merged


def _normalize_settings(raw_settings, defaults=None):
    base_settings = _deep_merge(DEFAULT_AI_SETTINGS, defaults or {})
    normalized = deepcopy(base_settings)

    if isinstance(raw_settings, dict):
        if 'models' in raw_settings or 'pipeline' in raw_settings:
            normalized = _deep_merge(normalized, raw_settings)
        elif raw_settings.get('ai_model'):
            normalized['models']['deep'] = str(raw_settings.get('ai_model')).strip() or normalized['models']['deep']
            normalized['models']['focused'] = normalized['models']['deep']
            normalized['models']['document_processing'] = normalized['models']['focused']

    normalized['pipeline']['preview_max_rows'] = max(1, int(normalized['pipeline'].get('preview_max_rows', 10) or 10))
    normalized['pipeline']['focused_max_rows'] = max(1, int(normalized['pipeline'].get('focused_max_rows', 5) or 5))
    normalized['pipeline']['enable_chunking'] = bool(normalized['pipeline'].get('enable_chunking', True))

    for key, fallback in base_settings['models'].items():
        value = str(normalized['models'].get(key) or fallback).strip() or fallback
        if '/' not in value and value not in {'gpt-4o-mini', 'gpt-4o'}:
            value = f'ollama/{value}'
        normalized['models'][key] = value

    return normalized


def _ensure_file(defaults=None):
    settings_path = _settings_path()
    os.makedirs(os.path.dirname(settings_path), exist_ok=True)

    if os.path.exists(settings_path):
        return settings_path

    with open(settings_path, 'w', encoding='utf-8') as file:
        json.dump(_normalize_settings({}, defaults=defaults), file, indent=2)

    return settings_path


def get_ai_settings(defaults=None):
    settings_path = _ensure_file(defaults=defaults)

    try:
        with open(settings_path, 'r', encoding='utf-8') as file:
            stored = json.load(file)
    except (json.JSONDecodeError, OSError):
        stored = {}

    settings = _normalize_settings(stored, defaults=defaults)
    return settings


def save_ai_settings(data, defaults=None):
    settings = get_ai_settings(defaults=defaults)
    settings = _normalize_settings(_deep_merge(settings, data or {}), defaults=defaults)

    settings_path = _ensure_file(defaults=defaults)
    with open(settings_path, 'w', encoding='utf-8') as file:
        json.dump(settings, file, indent=2)

    return settings


def get_ai_model(mode='preview', defaults=None):
    settings = get_ai_settings(defaults=defaults)
    models = settings.get('models', {})
    normalized_mode = str(mode or 'preview').strip().lower() or 'preview'
    return models.get(normalized_mode) or models.get('deep') or models.get('focused') or models.get('preview')
