import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from requests import RequestException
from requests.exceptions import Timeout
from flask import Blueprint, current_app, jsonify, request

from .email_upload import clean_filename
from ..models.reference import AIAnalysis, SessionLocal, init_db
from ..services.settings_store import get_ai_settings
from ..services.ai_client import (
    build_compat_chat_response,
    build_health_payload,
    build_openai_chat_response,
    call_gateway_chat,
    call_gateway_openai_chat,
    send_chat,
)
from ..services.ai_interaction_log import read_ai_interactions, write_ai_interaction_error
from ..services.document_ai import analyze_document
from ..services.document_parser import parse_document
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
from ..utils.deprecation import log_deprecated_route


ai_bp = Blueprint('ai', __name__)


def _ai_analysis_enabled():
    value = str(os.getenv('AI_ANALYSIS_ENABLED', 'true')).strip().lower()
    return value in {'1', 'true', 'yes', 'on'}


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


def _run_model_prompt(prompt, analysis_mode='preview', agent_id='', context=None):
    payload = _gateway_payload({'message': prompt, 'analysis_mode': analysis_mode})
    result = call_gateway_chat(
        payload,
        current_app.config['AI_GATEWAY_BASE_URL'],
        agent_id=agent_id,
        context=context,
    )
    # `call_gateway_chat` returns an OpenAI-style completion payload.
    # Normalize through compat helper so callers always get plain text.
    compat = build_compat_chat_response(payload, result)
    return compat.get('message', '')


def _extract_document_path(document_url):
    raw_url = str(document_url or '').strip()
    if not raw_url:
        return ''

    path_only = re.sub(r'^https?://[^/]+', '', raw_url)
    path_only = path_only.split('?', 1)[0]
    base_dir = current_app.config.get('BACKEND_DATA_DIR', '/app/data')

    if path_only.startswith('/uploads/'):
        filename = clean_filename(path_only[len('/uploads/'):])
        if not filename:
            return ''
        return os.path.join(base_dir, 'uploads', filename)

    if path_only.startswith('/api/uploads/'):
        filename = clean_filename(path_only[len('/api/uploads/'):])
        if not filename:
            return ''
        return os.path.join(base_dir, 'uploads', filename)

    kb_match = re.match(r'^/(?:api/)?kb/([^/]+)/([^/]+)$', path_only)
    if kb_match:
        category = clean_filename(kb_match.group(1))
        filename = clean_filename(kb_match.group(2))
        if not category or not filename:
            return ''
        return os.path.join(base_dir, 'work', 'kb', category, filename)

    return ''


def _extract_full_quick_sections(raw_message):
    message = str(raw_message or '').strip()
    if not message:
        return {
            'full': '',
            'quick': '',
        }

    match = re.search(
        r'(?:full(?:_analysis)?\s*[:\-]\s*)(?P<full>[\s\S]*?)(?:\n+\s*(?:quick(?:_summary)?|quick view)\s*[:\-]\s*)(?P<quick>[\s\S]*)',
        message,
        flags=re.IGNORECASE,
    )
    if match:
        full = str(match.group('full') or '').strip()
        quick = str(match.group('quick') or '').strip()
        return {
            'full': full or message,
            'quick': quick or full or message,
        }

    return {
        'full': message,
        'quick': message,
    }


def _analysis_metadata_path(file_path):
    directory = os.path.dirname(file_path or '')
    filename = os.path.basename(file_path or '')
    if not directory or not filename:
        return ''
    return os.path.join(directory, f'{filename}.meta.json')


def _read_analysis_metadata(file_path):
    meta_path = _analysis_metadata_path(file_path)
    if not meta_path or not os.path.exists(meta_path):
        return {}
    try:
        with open(meta_path, 'r', encoding='utf-8') as handle:
            data = json.load(handle)
            return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _write_analysis_metadata(file_path, payload):
    meta_path = _analysis_metadata_path(file_path)
    if not meta_path:
        return

    merged = dict(_read_analysis_metadata(file_path))
    merged['analysis'] = payload

    try:
        with open(meta_path, 'w', encoding='utf-8') as handle:
            json.dump(merged, handle, ensure_ascii=False)
    except OSError:
        current_app.logger.warning('Failed to write AI analysis metadata for %s', file_path)


def _resolve_analysis_file_path(file_path):
    raw_value = str(file_path or '').strip()
    if not raw_value:
        return ''

    path_only = re.sub(r'^https?://[^/]+', '', raw_value).split('?', 1)[0]
    if path_only.startswith(('/uploads/', '/api/uploads/', '/kb/', '/api/kb/')):
        return _extract_document_path(path_only)

    candidate = Path(raw_value).expanduser()
    base_dir = Path(current_app.config.get('BACKEND_DATA_DIR', '/app/data')).resolve()
    if not candidate.is_absolute():
        candidate = (base_dir / raw_value.lstrip('/')).resolve()
    else:
        candidate = candidate.resolve()

    allowed_roots = [
        base_dir / 'uploads',
        base_dir / 'kb',
        base_dir / 'csv_analyses',
        base_dir / 'work' / 'kb',
    ]
    for root in allowed_roots:
        try:
            candidate.relative_to(root.resolve())
            return str(candidate)
        except ValueError:
            continue

    return ''


def _run_smart_analysis(payload):
    ai_settings = get_ai_settings(defaults=_default_ai_settings())
    prepared = prepare_analysis_request(payload, settings=ai_settings)
    if prepared.get('mode') == 'full_dataset' and int(prepared.get('recordCount') or 0) > 1:
        raise ValueError('Blocked: bulk dataset AI analysis is not allowed')
    selected_agent_id = str(payload.get('agent_id') or '').strip()
    if selected_agent_id and prepared.get('cacheKey'):
        prepared['cacheKey'] = f"{prepared['cacheKey']}::{selected_agent_id}"
    agent_context = {
        'mode': prepared['mode'],
        'fileName': prepared['fileName'],
        'columns': prepared['columns'],
        'recordCount': prepared['recordCount'],
        'records': prepared['selectedRecords'] if prepared['mode'] != 'full_dataset' else prepared['records'],
    }
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
            parsed = parse_llm_json(
                _run_model_prompt(
                    plan['prompt'],
                    analysis_mode='full_dataset',
                    agent_id=selected_agent_id,
                    context=agent_context,
                )
            )
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
            chunk_result = parse_llm_json(
                _run_model_prompt(
                    chunk_prompt,
                    analysis_mode='focused',
                    agent_id=selected_agent_id,
                    context=agent_context,
                )
            )
            chunk_summaries.append(
                {
                    'summary': chunk_result.get('summary', ''),
                    'insights': chunk_result.get('insights', []),
                }
            )

        final_prompt = plan['finalPrompt'](chunk_summaries, prepared)
        parsed = parse_llm_json(
            _run_model_prompt(
                final_prompt,
                analysis_mode='full_dataset',
                agent_id=selected_agent_id,
                context=agent_context,
            )
        )
        meta = {
            'records_used': prepared['recordCount'],
            'truncated': prepared['truncated'],
            'chunked': True,
            'chunk_count': len(chunk_summaries),
            'model': 'gateway-managed',
        }
    else:
        parsed = parse_llm_json(
            _run_model_prompt(
                plan['prompt'],
                analysis_mode=prepared['mode'],
                agent_id=selected_agent_id,
                context=agent_context,
            )
        )
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
    if request.path == '/ai/chat':
        log_deprecated_route('/ai/chat', '/api/ai/chat')
    elif request.path == '/chat':
        log_deprecated_route('/chat', '/api/ai/chat')

    raw_payload = request.get_json(silent=True) or {}
    selected_agent_id = str(raw_payload.get('agent_id') or '').strip()
    if not current_app.config.get('USE_AI_GATEWAY', False):
        return jsonify({'status': 'error', 'error': 'AI gateway is disabled.'}), 503

    request_type = str(raw_payload.get('type') or '').strip().lower()
    if request_type == 'log_analysis':
        logs = raw_payload.get('logs')
        has_logs = isinstance(logs, str) and logs.strip()
        if isinstance(logs, list):
            has_logs = len(logs) > 0
        if not has_logs:
            return jsonify({'status': 'skipped', 'reason': 'no_logs', 'message': 'No logs available to analyze'})

    if smart_analysis_requested(raw_payload):
        try:
            output = _run_smart_analysis(raw_payload)
            return jsonify(
                {
                    **output,
                }
            )
        except ValueError as error:
            write_ai_interaction_error(raw_payload, str(error), interaction_type='smart_analysis')
            return jsonify({'error': str(error)}), 400
        except Timeout:
            write_ai_interaction_error(raw_payload, 'AI request timed out', interaction_type='smart_analysis')
            return jsonify({'status': 'timeout', 'error': 'AI request timed out'}), 504
        except RequestException as error:
            write_ai_interaction_error(raw_payload, f'AI request failed: {error}', interaction_type='smart_analysis')
            return jsonify({'status': 'error', 'error': f'AI request failed: {error}'}), 502

    payload = _gateway_payload(raw_payload)

    try:
        result = call_gateway_chat(
            payload,
            current_app.config['AI_GATEWAY_BASE_URL'],
            agent_id=selected_agent_id,
            context=raw_payload.get('context'),
        )
        return jsonify(build_compat_chat_response(payload, result))
    except ValueError as error:
        write_ai_interaction_error(payload, str(error))
        return jsonify({'error': str(error)}), 400
    except Timeout:
        write_ai_interaction_error(payload, 'AI request timed out')
        return jsonify({'status': 'timeout', 'error': 'AI request timed out'}), 504
    except RequestException as error:
        write_ai_interaction_error(payload, f'AI request failed: {error}')
        return jsonify({'status': 'error', 'error': f'AI request failed: {error}'}), 502


@ai_bp.post('/ai/v1/chat/completions')
@ai_bp.post('/api/ai/v1/chat/completions')
@ai_bp.post('/v1/chat/completions')
def openai_chat():
    if request.path == '/ai/v1/chat/completions':
        log_deprecated_route('/ai/v1/chat/completions', '/api/ai/v1/chat/completions')
    elif request.path == '/v1/chat/completions':
        log_deprecated_route('/v1/chat/completions', '/api/ai/v1/chat/completions')

    if not current_app.config.get('USE_AI_GATEWAY', False):
        return jsonify({'error': {'message': 'AI gateway is disabled.', 'type': 'service_unavailable'}}), 503
    payload = _gateway_payload(request.get_json(silent=True) or {})

    try:
        return jsonify(build_openai_chat_response(call_gateway_openai_chat(payload, current_app.config['AI_GATEWAY_BASE_URL'])))
    except ValueError as error:
        write_ai_interaction_error(payload, str(error), interaction_type='openai_chat')
        return jsonify({'error': {'message': str(error), 'type': 'invalid_request_error'}}), 400
    except RequestException as error:
        write_ai_interaction_error(payload, f'AI request failed: {error}', interaction_type='openai_chat')
        return jsonify({'error': {'message': f'AI request failed: {error}', 'type': 'service_unavailable'}}), 503


@ai_bp.get('/api/ai/logs')
@ai_bp.get('/ai/logs')
def ai_logs():
    if request.path == '/ai/logs':
        log_deprecated_route('/ai/logs', '/api/ai/logs')

    try:
        limit = int(request.args.get('limit', 200))
    except (TypeError, ValueError):
        limit = 200

    items = read_ai_interactions(limit=limit)
    return jsonify({'status': 'ok', 'items': items})


@ai_bp.get('/ai/health')
@ai_bp.get('/api/ai/health')
def health():
    if request.path == '/ai/health':
        log_deprecated_route('/ai/health', '/api/ai/health')

    return jsonify(
        build_health_payload(
            app_name=current_app.config['APP_NAME'],
            model='gateway-managed',
            api_base=current_app.config['AI_GATEWAY_BASE_URL'],
            use_ai_gateway=True,
        )
    )


@ai_bp.post('/api/analyze/document')
def analyze_document_manual():
    log_deprecated_route('/api/analyze/document', '/api/ai/analyze-document')

    payload = request.get_json(silent=True) or {}
    file_path = str(payload.get('file_path') or payload.get('filePath') or '').strip()
    agent_id = str(payload.get('agent_id') or payload.get('agentId') or 'kb_ingestion').strip() or 'kb_ingestion'

    resolved_path = _resolve_analysis_file_path(file_path)
    if not resolved_path:
        return jsonify({'error': 'A valid file_path within data directories is required.'}), 400
    if not os.path.isfile(resolved_path):
        return jsonify({'error': 'Document file not found.'}), 404

    extracted = parse_document(resolved_path) or {}
    document_text = str(extracted.get('text') or '').strip()
    if not document_text:
        return jsonify({'error': 'No text could be extracted from this file.'}), 400

    print('[AI] Triggered manually by user')
    result = send_chat(
        {
            'message': 'Analyze this document for KB ingestion',
            'agent_id': agent_id,
            'context': {
                'document_text': document_text,
                'file_name': Path(resolved_path).name,
            },
            'analysis_mode': 'document_processing',
        },
        timeout_seconds=(5, 60),
    )
    return jsonify({'success': True, 'data': result})


@ai_bp.post('/api/ai/analyze-document')
@ai_bp.post('/ai/analyze-document')
def analyze_document_endpoint():
    if request.path == '/ai/analyze-document':
        log_deprecated_route('/ai/analyze-document', '/api/ai/analyze-document')

    if not _ai_analysis_enabled():
        return jsonify({'error': 'AI document analysis is disabled by environment configuration.'}), 503

    init_db()
    payload = request.get_json(silent=True) or {}
    document_text = str(payload.get('documentText') or '').strip()
    document_name = str(payload.get('documentName') or '').strip() or 'Untitled Document'
    document_url = str(payload.get('documentUrl') or '').strip()
    rerun = bool(payload.get('rerun', True))
    lookup_only = bool(payload.get('lookupOnly') or payload.get('lookup_only'))
    resolved_path = _extract_document_path(document_url)

    if not document_text and resolved_path and os.path.isfile(resolved_path):
        extracted = parse_document(resolved_path) or {}
        document_text = str(extracted.get('text') or '').strip()

    if not document_text:
        return jsonify({'error': 'documentText is required.'}), 400

    session = SessionLocal()
    try:
        if (not rerun) or lookup_only:
            existing = (
                session.query(AIAnalysis)
                .filter(AIAnalysis.document_name == document_name, AIAnalysis.raw_text == document_text)
                .order_by(AIAnalysis.created_at.desc(), AIAnalysis.id.desc())
                .first()
            )
            if existing:
                if resolved_path and os.path.isfile(resolved_path):
                    _write_analysis_metadata(
                        resolved_path,
                        {
                            'status': 'success',
                            'analyzedAt': existing.created_at.isoformat() if existing.created_at else datetime.now(timezone.utc).isoformat(),
                            'analysisId': existing.id,
                            'documentName': existing.document_name,
                            'analyzer': 'document_ai',
                            'analysisMode': 'document_processing',
                            'promptSource': 'backend/app/services/document_ai.py:PROMPT_TEMPLATE',
                            'full_analysis': existing.full_analysis,
                            'quick_summary': existing.quick_summary,
                            'raw': existing.full_analysis,
                            'cached': True,
                        },
                    )
                return jsonify(
                    {
                        'success': True,
                        'data': {
                            'id': existing.id,
                            'document_name': existing.document_name,
                            'full_analysis': existing.full_analysis,
                            'quick_summary': existing.quick_summary,
                            'raw': existing.full_analysis,
                            'token_usage': {
                                'input': int(existing.input_tokens or 0),
                                'output': int(existing.output_tokens or 0),
                                'total': int(existing.input_tokens or 0) + int(existing.output_tokens or 0),
                            },
                            'created_at': existing.created_at.isoformat() if existing.created_at else None,
                            'cached': True,
                            'found': True,
                        },
                    }
                )
            if lookup_only:
                return jsonify(
                    {
                        'success': True,
                        'data': {
                            'id': None,
                            'document_name': document_name,
                            'full_analysis': '',
                            'quick_summary': '',
                            'raw': '',
                            'token_usage': {
                                'input': 0,
                                'output': 0,
                                'total': 0,
                            },
                            'created_at': None,
                            'cached': False,
                            'found': False,
                        },
                    }
                )

        ai_result = analyze_document(document_text, document_name)
        raw_response = str(ai_result.get('raw_response') or '').strip()
        if not raw_response:
            raw_response = 'AI returned an empty response.'
        if len(raw_response) < 1000:
            current_app.logger.warning('Possible truncated AI response for %s (length=%s)', document_name, len(raw_response))

        input_tokens = int(ai_result.get('input_tokens') or 0)
        output_tokens = int(ai_result.get('output_tokens') or 0)
        parsed_sections = _extract_full_quick_sections(raw_response)
        full_analysis = raw_response
        quick_summary = str(ai_result.get('summary') or '').strip() or parsed_sections.get('quick') or raw_response

        record = AIAnalysis(
            document_name=document_name,
            raw_text=document_text,
            full_analysis=str(full_analysis),
            quick_summary=str(quick_summary),
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            created_at=datetime.now(timezone.utc),
        )
        session.add(record)
        session.commit()
        session.refresh(record)

        if resolved_path and os.path.isfile(resolved_path):
            _write_analysis_metadata(
                resolved_path,
                {
                    'status': 'success',
                    'analyzedAt': record.created_at.isoformat() if record.created_at else datetime.now(timezone.utc).isoformat(),
                    'analysisId': record.id,
                    'documentName': record.document_name,
                    'analyzer': 'document_ai',
                    'analysisMode': 'document_processing',
                    'promptSource': 'backend/app/services/document_ai.py:PROMPT_TEMPLATE',
                    'full_analysis': record.full_analysis,
                    'quick_summary': record.quick_summary,
                    'raw': record.full_analysis,
                    'cached': False,
                },
            )

        return jsonify(
            {
                'success': True,
                'data': {
                    'id': record.id,
                    'document_name': record.document_name,
                    'full_analysis': record.full_analysis,
                    'quick_summary': record.quick_summary,
                    'raw': record.full_analysis,
                    'token_usage': {
                        'input': input_tokens,
                        'output': output_tokens,
                        'total': input_tokens + output_tokens,
                    },
                    'created_at': record.created_at.isoformat() if record.created_at else None,
                    'cached': False,
                    'found': True,
                },
            }
        )
    except ValueError as error:
        return jsonify({'error': str(error)}), 400
    except RequestException as error:
        return jsonify({'error': f'AI request failed: {error}'}), 503
    finally:
        session.close()
