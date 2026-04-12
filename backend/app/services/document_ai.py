import json
import logging
import re
from pathlib import Path

from flask import current_app

from .ai_client import build_compat_chat_response, call_gateway_chat
from .settings_store import get_ai_model


LOGGER = logging.getLogger(__name__)
PROMPT_TEMPLATE = """Convert the following document into STRICT JSON with this exact shape:

{{
  "summary": "...short summary...",
  "type": "ticket | kb | instruction | report | unknown",
  "tags": ["vpn", "access", "responder"],
  "entities": {{
    "systems": [],
    "users": [],
    "groups": [],
    "keywords": []
  }},
  "actionable_insights": [
    "...what should be done...",
    "...possible resolution..."
  ]
}}

Rules:
- NO markdown
- NO explanation
- JSON ONLY
- tags must be lowercase reusable keywords

Filename: {filename}

Document text:
{text}
"""


def _normalize_string_list(value, lowercase=False):
    if not isinstance(value, list):
        return []

    items = []
    seen = set()
    for item in value:
        normalized = str(item or '').strip()
        if lowercase:
            normalized = normalized.lower()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        items.append(normalized)
    return items


def _normalize_payload(parsed):
    if not isinstance(parsed, dict):
        return {}

    entities = parsed.get('entities')
    if not isinstance(entities, dict):
        entities = {}

    return {
        'summary': str(parsed.get('summary') or '').strip(),
        'type': str(parsed.get('type') or 'unknown').strip().lower() or 'unknown',
        'tags': _normalize_string_list(parsed.get('tags'), lowercase=True),
        'entities': {
            'systems': _normalize_string_list(entities.get('systems')),
            'users': _normalize_string_list(entities.get('users')),
            'groups': _normalize_string_list(entities.get('groups')),
            'keywords': _normalize_string_list(entities.get('keywords'), lowercase=True),
        },
        'actionable_insights': _normalize_string_list(parsed.get('actionable_insights')),
    }


def _strip_trailing_commas(text):
    return re.sub(r',\s*([}\]])', r'\1', text)


def extract_json(text):
    candidate = str(text or '').strip()
    if not candidate:
        return None

    try:
        return json.loads(candidate)
    except Exception:
        pass

    cleaned = re.sub(r'```json|```', '', candidate, flags=re.IGNORECASE).strip()
    cleaned = _strip_trailing_commas(cleaned)
    try:
        return json.loads(cleaned)
    except Exception:
        pass

    match = re.search(r'\{.*\}', cleaned, re.DOTALL)
    if match:
        snippet = _strip_trailing_commas(match.group(0).strip())
        try:
            return json.loads(snippet)
        except Exception:
            pass

    return None


def analyze_document(text, filename):
    prompt = PROMPT_TEMPLATE.format(
        filename=Path(filename or '').name,
        text=(text or '')[:12000],
    )

    document_model = get_ai_model(mode='document_processing')

    request_payload = {
        'message': prompt,
        'analysis_mode': 'focused',
        'model': document_model,
    }
    gateway_result = call_gateway_chat(
        request_payload,
        current_app.config['AI_GATEWAY_BASE_URL'],
        timeout_seconds=25,
    )
    payload = build_compat_chat_response(request_payload, gateway_result)
    raw_message = str(payload.get('message') or '').strip()
    if not raw_message:
        raise ValueError('AI analysis returned an empty response.')

    # Temporary raw passthrough mode for debugging:
    # keep the full model body and skip JSON extraction/normalization.
    preview = re.sub(r'\s+', ' ', raw_message)[:500]
    LOGGER.info('AI raw response preview for %s: %s', filename, preview)
    first_line = raw_message.splitlines()[0].strip() if raw_message else ''
    summary = first_line[:200] if first_line else 'Raw AI response captured.'

    return {
        'summary': summary,
        'type': 'raw',
        'tags': [],
        'entities': {
            'systems': [],
            'users': [],
            'groups': [],
            'keywords': [],
        },
        'actionable_insights': [],
        'raw_response': raw_message,
    }
