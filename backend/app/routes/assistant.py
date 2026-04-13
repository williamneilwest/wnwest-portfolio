import re

from flask import Blueprint, current_app, jsonify, request
from requests import RequestException

from ..services.ai_client import build_compat_chat_response, call_gateway_chat
from ..services.kb_router import answer_kb_query, classify_route


assistant_bp = Blueprint('assistant', __name__)


SYSTEM_CONTEXT = {
    'routes': {
        '/app/life': 'System and service health overview page.',
        '/app/work': 'Ticket operations hub with active tickets and workflow tools.',
        '/app/console': 'Logs and endpoint monitoring workspace.',
        '/app/kb': 'Knowledge base browsing and analysis area.',
    },
    'features': {
        'ticket_uploads': 'Upload and process ticket-related files from the Uploads and Work areas.',
        'active_tickets': 'Review latest tickets, open details, and run AI-assisted analysis.',
        'knowledge_base': 'Browse KB documents and run analysis on supported files.',
        'console_logs': 'View logs, inspect services, and monitor endpoint status.',
    },
}

NAV_KEYWORDS = (
    'go',
    'open',
    'take me to',
    'navigate',
    'bring me to',
)

GUIDE_KEYWORDS = (
    'how',
    'help',
    'where',
    'steps',
    'upload',
)

EXPLAIN_KEYWORDS = (
    'what is this',
    'what is',
    'explain',
    'what does',
)

ROUTE_ALIASES = {
    '/app/life': ('life', 'status', 'health'),
    '/app/work': ('work', 'ticket', 'tickets', 'workflow'),
    '/app/console': ('console', 'logs', 'endpoint', 'monitoring'),
    '/app/kb': ('kb', 'knowledge base', 'knowledge', 'docs', 'documents'),
}


def _normalize_text(value):
    return re.sub(r'\s+', ' ', str(value or '').strip().lower())


def _detect_intent(normalized_query):
    if any(keyword in normalized_query for keyword in NAV_KEYWORDS):
        return 'navigation'
    if any(keyword in normalized_query for keyword in GUIDE_KEYWORDS):
        return 'guide'
    if any(keyword in normalized_query for keyword in EXPLAIN_KEYWORDS):
        return 'explanation'
    return 'general'


def _extract_route(normalized_query):
    for route, aliases in ROUTE_ALIASES.items():
        if any(alias in normalized_query for alias in aliases):
            return route
    return ''


def _build_prompt(query, current_route, intent, suggested_route):
    routes_text = '\n'.join([f'- {path}: {desc}' for path, desc in SYSTEM_CONTEXT['routes'].items()])
    features_text = '\n'.join([f'- {name}: {desc}' for name, desc in SYSTEM_CONTEXT['features'].items()])

    route_hint = suggested_route or 'none'

    return (
        'You are an in-app assistant for westOS. '
        'Answer in 2-5 sentences, clear and task-oriented. '
        'If user asks where/how in app, mention the relevant route from context. '
        'If navigation intent is present and route is clear, include direct guidance to that route.\n\n'
        f'Current route: {current_route or "unknown"}\n'
        f'Detected intent: {intent}\n'
        f'Suggested route: {route_hint}\n\n'
        f'Routes:\n{routes_text}\n\n'
        f'Features:\n{features_text}\n\n'
        f'User query: {query}'
    )


@assistant_bp.post('/api/assistant')
def assistant():
    payload = request.get_json(silent=True) or {}
    query = str(payload.get('query') or '').strip()
    current_route = str(payload.get('current_route') or '').strip()

    if not query:
        return jsonify({'error': 'query is required'}), 400

    normalized_query = _normalize_text(query)
    route_payload = classify_route(query)
    intent = _detect_intent(normalized_query)
    suggested_route = _extract_route(normalized_query)

    # Deterministic routing handoff: KB-like requests are routed before any generic answer generation.
    if route_payload.get('route') == 'kb':
        kb_answer, kb_matches = answer_kb_query(query, route_payload)
        answer_type = str(kb_answer.get('answer_type') or '').strip().lower()
        document_id = str(kb_answer.get('document_id') or '').strip()
        message = str(kb_answer.get('message') or '').strip() or 'I found a relevant knowledge base article.'
        action_path = f'/app/kb?id={document_id}' if answer_type == 'kb_link' and document_id else '/app/kb'
        return jsonify(
            {
                'message': message,
                'action': {'type': 'navigate', 'path': action_path},
                'routing': route_payload,
                'source_agent': 'kb_ingestion',
                'original_user_query': query,
                'response_type': answer_type or 'kb_no_match',
                'kb_response': kb_answer,
                'kb_matches': [
                    {
                        'document_id': item.get('document_id') or item.get('doc_id'),
                        'title': item.get('title'),
                        'confidence': item.get('confidence') if item.get('confidence') is not None else item.get('score'),
                    }
                    for item in (
                        (kb_answer.get('matches') if isinstance(kb_answer.get('matches'), list) else [])[:3]
                        or kb_matches[:3]
                    )
                ],
            }
        )

    action = {'type': 'none', 'path': ''}
    if intent in {'navigation', 'guide'} and suggested_route:
        action = {'type': 'navigate', 'path': suggested_route}

    prompt = _build_prompt(query, current_route, intent, suggested_route)

    try:
        result = call_gateway_chat(
            {
                'message': prompt,
                'analysis_mode': 'preview',
                'route_selected': route_payload.get('route') or 'general',
                'source_agent': 'global_assistant',
                'original_user_query': query,
                'response_type': 'assistant_reply',
            },
            current_app.config['AI_GATEWAY_BASE_URL'],
        )
        compat = build_compat_chat_response({'message': prompt}, result)
        message = str(compat.get('message') or '').strip() or 'I can help with navigation and workflow guidance in this app.'
    except (ValueError, RequestException):
        if action['type'] == 'navigate':
            route_description = SYSTEM_CONTEXT['routes'].get(action['path'], 'that page')
            message = f'You can go to {action["path"]}. It is the {route_description}'
        else:
            message = 'I can help with navigation, feature explanations, and upload workflows. Ask what you want to do next.'

    return jsonify(
        {
            'message': message,
            'action': action,
            'routing': route_payload,
            'source_agent': 'global_assistant',
            'original_user_query': query,
            'response_type': 'assistant_reply',
        }
    )
