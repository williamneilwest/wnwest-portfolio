import logging
from datetime import datetime
from io import BytesIO

from flask import Blueprint, Response, current_app, request
from requests import RequestException
from requests.exceptions import Timeout

from ..api_response import error_response, success_response
from .email_upload import (
    MAX_ATTACHMENT_BYTES,
    extract_recipient_from_request,
    is_allowed_attachment,
    iter_sendgrid_attachments,
    resolve_target_from_recipient,
    save_attachment_bytes_to_directory,
)
from ..services.active_tickets import (
    build_todo_from_tickets,
    canonicalize_ticket_row,
    compute_ticket_metrics,
    SOURCE_EMAIL,
    get_ticket_by_id,
    load_active_ticket_dataset,
    load_latest_ticket_payload,
    update_ticket_assignee,
)
from ..services.analysis_store import get_analysis_file, list_recent_analyses, save_analysis
from ..services.csv_analyzer import build_csv_analysis
from ..services.data_source_service import register_source
from ..services.data_sources.manager import get_source
from ..services.metrics_service import generate_ticket_metrics
from ..services.user_service import get_user_devices, get_user_full_context, resolve_user
from ..services.authz import get_current_user
from ..services.ai_client import build_compat_chat_response, call_gateway_chat
from ..utils.deprecation import log_deprecated_route

work_bp = Blueprint('work', __name__)
LOGGER = logging.getLogger(__name__)
SOURCE_TICKET_ID_KEYS = ('ticket', 'number', 'ticket_number', 'id', 'sys_id', 'u_task_1')


def _find_ticket_in_source(source_key: str, ticket_id: str):
    normalized_source_key = str(source_key or '').strip()
    normalized_ticket_id = str(ticket_id or '').strip()
    if not normalized_source_key or not normalized_ticket_id:
        return None

    rows = get_source(normalized_source_key, normalized=False)
    if not isinstance(rows, list):
        return None

    target = normalized_ticket_id.lower()
    for row in rows:
        if not isinstance(row, dict):
            continue
        for key in SOURCE_TICKET_ID_KEYS:
            value = row.get(key)
            if value is None:
                continue
            text = str(value).strip()
            if text and text.lower() == target:
                return row
    return None

@work_bp.get('/flows/work/recent-analyses')
def recent_analyses():
    try:
        return success_response(list_recent_analyses())
    except Exception as error:
        LOGGER.warning('Failed to load recent analyses: %s', error)
        return success_response([])


@work_bp.get('/flows/work/recent-analyses/<analysis_id>/file')
def recent_analysis_file(analysis_id):
    record = get_analysis_file(analysis_id)

    if not record:
        return error_response('Analysis file not found.', 404)

    return Response(
        record['content'],
        mimetype='text/csv; charset=utf-8',
        headers={
            'Content-Disposition': f'inline; filename="{record["fileName"]}"',
            'Cache-Control': 'no-store',
        },
    )


@work_bp.post('/flows/work/analyze-csv')
@work_bp.post('/api/work/analyze-csv')
def analyze_csv():
    try:
        uploaded_file = request.files.get('file')

        if uploaded_file is None or not uploaded_file.filename:
            raise ValueError('A CSV file is required.')

        content = uploaded_file.stream.read()
        result = build_csv_analysis(uploaded_file.filename, content)
        record = save_analysis(uploaded_file.filename, content, result)

        return success_response(
            {
                **result,
                'savedAt': record['savedAt'],
                'analysisId': record['id'],
            }
        )
    except ValueError as error:
        return error_response(str(error), 400)


@work_bp.post('/api/email/upload')
def upload_email_csv():
    try:
        saved_files = []
        routing = resolve_target_from_recipient(extract_recipient_from_request())
        transport = None

        for uploaded_file in request.files.values():
            filename = (uploaded_file.filename or '').strip()
            if not is_allowed_attachment(filename):
                LOGGER.info('Ignoring unsupported email attachment: %s', filename or 'unnamed attachment')
                continue

            uploaded_file.stream.seek(0, 2)
            size = uploaded_file.stream.tell()
            uploaded_file.stream.seek(0)
            if size > MAX_ATTACHMENT_BYTES:
                LOGGER.info('Ignoring oversized email attachment: %s (%s bytes)', filename or 'unnamed attachment', size)
                continue

            content = uploaded_file.stream.read()
            uploaded_file.stream = BytesIO(content)
            saved_record = save_attachment_bytes_to_directory(
                filename,
                content,
                routing['directory'],
                source=SOURCE_EMAIL,
                recipient=routing['recipient'],
                route=routing['target'],
            )
            saved_files.append(
                {
                    'originalFileName': filename,
                    'savedFileName': saved_record['filename'],
                    'savedFileUrl': saved_record['url'],
                    'route': routing['target'],
                }
            )

        if not saved_files:
            for attachment in iter_sendgrid_attachments():
                saved_record = save_attachment_bytes_to_directory(
                    attachment['filename'],
                    attachment['content'],
                    routing['directory'],
                    source=SOURCE_EMAIL,
                    recipient=routing['recipient'],
                    route=routing['target'],
                )
                saved_files.append(
                    {
                        'originalFileName': attachment['filename'],
                        'savedFileName': saved_record['filename'],
                        'savedFileUrl': saved_record['url'],
                        'route': routing['target'],
                    }
                )
                transport = 'base64'

        if not saved_files:
            return success_response(
                {
                    'saved': False,
                    'message': 'No valid attachments were found.',
                }
            )

        response_payload = {
            'saved': True,
            'savedFiles': saved_files,
            'source': SOURCE_EMAIL,
            'route': routing['target'],
            'datasetUpdated': False,
        }

        if transport:
            response_payload['transport'] = transport

        return success_response(response_payload)
    except ValueError as error:
        LOGGER.warning('Email CSV upload rejected: %s', error)
        return success_response(
            {
                'saved': False,
                'message': str(error),
            }
        )

@work_bp.get('/work/tickets')
@work_bp.get('/api/work/tickets')
@work_bp.get('/api/tickets')
@work_bp.get('/api/tickets/latest')
def latest_tickets():
    if request.path == '/work/tickets':
        log_deprecated_route('/work/tickets', '/api/work/tickets')
    elif request.path == '/api/tickets':
        log_deprecated_route('/api/tickets', '/api/work/tickets')
    elif request.path == '/api/tickets/latest':
        log_deprecated_route('/api/tickets/latest', '/api/work/tickets')

    try:
        payload = load_latest_ticket_payload()
        tickets = payload.get('tickets') if isinstance(payload.get('tickets'), list) else []
        columns = payload.get('columns') if isinstance(payload.get('columns'), list) else []
        register_source(
            key='tickets_active',
            name='Active Tickets',
            table_name='tickets_active',
            row_count=len(tickets),
        )
        assignee = str(request.args.get('assignee') or '').strip()
        metrics = compute_ticket_metrics(tickets, columns)
        todo = build_todo_from_tickets(tickets, assignee, columns, limit=10) if assignee else []
        payload['metrics'] = metrics
        payload['todo'] = todo
        return success_response(payload)
    except ValueError as error:
        return error_response(str(error), 400)


@work_bp.get('/api/users/<path:identifier>')
def user_template(identifier: str):
    normalized_identifier = str(identifier or '').strip()
    if not normalized_identifier:
        return error_response('identifier is required', 400)

    refresh = str(request.args.get('refresh') or '').strip().lower() in {'1', 'true', 'yes', 'y'}
    resolved_user = resolve_user(normalized_identifier)
    resolved_opid = str(resolved_user.get('opid') or '').strip().lower()
    if not resolved_opid:
        return error_response('user could not be resolved', 404)

    current_user = get_current_user()
    current_user_id = int(current_user.id) if current_user is not None else None
    context = get_user_full_context(resolved_opid, user_id=current_user_id, refresh=refresh)

    profile = context.get('profile') if isinstance(context, dict) else {}
    groups = context.get('groups') if isinstance(context, dict) else []
    devices = context.get('devices') if isinstance(context, dict) else []

    return success_response(
        {
            'user': {
                'name': str(resolved_user.get('name') or profile.get('display_name') or resolved_opid),
                'opid': resolved_opid,
                'email': str(resolved_user.get('email') or profile.get('email') or ''),
            },
            'profile': profile if isinstance(profile, dict) else {},
            'groups': groups if isinstance(groups, list) else [],
            'devices': devices if isinstance(devices, list) else [],
        }
    )


@work_bp.get('/api/users/<path:identifier>/devices')
def user_devices(identifier: str):
    normalized_identifier = str(identifier or '').strip()
    if not normalized_identifier:
        return error_response('identifier is required', 400)

    name = str(request.args.get('name') or '').strip()
    email = str(request.args.get('email') or '').strip()
    payload = get_user_devices(normalized_identifier, name=name, email=email)
    user = payload.get('user') if isinstance(payload, dict) else {}
    resolved_opid = str(user.get('opid') or '').strip().lower()
    if not resolved_opid:
        return error_response('user could not be resolved', 404)

    devices = payload.get('devices') if isinstance(payload, dict) else []
    return success_response(
        {
            'user': user if isinstance(user, dict) else {},
            'devices': devices if isinstance(devices, list) else [],
        }
    )


@work_bp.get('/api/tickets/metrics')
def ticket_metrics():
    try:
        payload = load_latest_ticket_payload()
        tickets = payload.get('tickets') if isinstance(payload.get('tickets'), list) else []
        columns = payload.get('columns') if isinstance(payload.get('columns'), list) else []
        metrics = generate_ticket_metrics(tickets, columns)
        return success_response(metrics)
    except ValueError as error:
        return error_response(str(error), 400)


@work_bp.get('/api/metrics/active-tickets')
def active_ticket_metrics():
    try:
        payload = load_latest_ticket_payload()
        tickets = payload.get('tickets') if isinstance(payload.get('tickets'), list) else []
        columns = payload.get('columns') if isinstance(payload.get('columns'), list) else []
        metrics = generate_ticket_metrics(tickets, columns)
        metrics['source'] = {
            'fileName': payload.get('fileName'),
            'last_updated': payload.get('last_updated'),
            'row_count': len(tickets),
        }
        return success_response(metrics)
    except ValueError as error:
        return error_response(str(error), 400)


@work_bp.get('/api/tickets/todo')
def ticket_todo():
    assignee = str(request.args.get('assignee') or '').strip()
    if not assignee:
        return error_response('assignee is required.', 400)

    dataset = load_active_ticket_dataset()
    tickets = dataset.get('rows') if isinstance(dataset.get('rows'), list) else []
    columns = dataset.get('columns') if isinstance(dataset.get('columns'), list) else []
    todo = build_todo_from_tickets(tickets, assignee, columns, limit=10)
    response_date = datetime.now().date().isoformat()

    if not todo:
        return success_response(
            {
                'assignee': assignee,
                'date': response_date,
                'items': [],
                'message': 'No active tickets',
            }
        )

    return success_response(
        {
            'assignee': assignee,
            'date': response_date,
            'items': todo,
        }
    )


@work_bp.get('/api/tickets/<ticket_id>')
def get_ticket(ticket_id):
    source_key = str(request.args.get('source') or '').strip()
    if source_key:
        source_ticket = _find_ticket_in_source(source_key, ticket_id)
        if source_ticket:
            return success_response(canonicalize_ticket_row(source_ticket))

    try:
        ticket = get_ticket_by_id(ticket_id)
    except ValueError as error:
        return error_response(str(error), 400)

    if not ticket:
        return error_response(f'Ticket {ticket_id} was not found.', 404)

    return success_response(ticket)


@work_bp.post('/api/tickets/<ticket_id>/summary')
def summarize_ticket(ticket_id):
    # Keep this endpoint aligned with the authenticated /api/ai/chat smart-analysis
    # behavior so ticket summaries use the same ticket_analyzer pipeline.
    from .ai import _run_smart_analysis

    payload = request.get_json(silent=True) or {}
    ticket = get_ticket_by_id(ticket_id)
    if ticket is None and isinstance(payload.get('ticket'), dict):
        ticket = payload.get('ticket')

    if not isinstance(ticket, dict):
        return error_response(f'Ticket {ticket_id} was not found.', 404)

    ai_payload = {
        'analysis_mode': 'deep',
        'agent_id': str(payload.get('agent_id') or 'ticket_analyzer').strip() or 'ticket_analyzer',
        'ticket': ticket,
        'fileName': str(payload.get('fileName') or '').strip(),
        'type': 'ticket_summary',
        'smart_analysis': True,
    }

    try:
        smart_output = _run_smart_analysis(ai_payload)
        message = str(smart_output.get('message') or smart_output.get('summary') or '').strip()

        if not message:
            # Fallback for unexpected empty smart payloads to preserve prior response behavior.
            result = call_gateway_chat(
                ai_payload,
                current_app.config['AI_GATEWAY_BASE_URL'],
                agent_id=ai_payload['agent_id'],
                context={
                    'route_selected': '/api/tickets/<ticket_id>/summary',
                    'source_agent': ai_payload['agent_id'],
                    'response_type': 'ticket_summary',
                    'ticket_id': str(ticket_id),
                },
            )
            compat = build_compat_chat_response(ai_payload, result)
            message = str(compat.get('message') or compat.get('summary') or '').strip()

        return success_response(
            {
                'ticket_id': str(ticket_id),
                'summary': message,
                'message': message,
                'agent_id': ai_payload['agent_id'],
            }
        )
    except ValueError as error:
        return error_response(str(error), 400)
    except Timeout:
        return error_response('AI request timed out.', 504)
    except RequestException as error:
        return error_response(f'AI request failed: {error}', 502)


@work_bp.post('/api/tickets/update-assignee')
def update_assignee():
    payload = request.get_json(silent=True) or {}
    ticket_id = str(payload.get('ticket_id', '')).strip()
    assignee = str(payload.get('assignee', '')).strip()

    if not ticket_id:
        return error_response('ticket_id is required.', 400)

    try:
        ticket = update_ticket_assignee(ticket_id, assignee)
    except ValueError as error:
        return error_response(str(error), 400)

    if not ticket:
        return error_response(f'Ticket {ticket_id} was not found.', 404)

    return success_response(ticket)


@work_bp.post('/api/tickets')
def create_ticket():
    return error_response('Ticket creation is not enabled in this module.', 405)


@work_bp.put('/api/tickets/<ticket_id>')
def replace_ticket(ticket_id):
    return error_response(f'Ticket updates are not enabled for {ticket_id}.', 405)


@work_bp.delete('/api/tickets/<ticket_id>')
def delete_ticket(ticket_id):
    return error_response(f'Ticket deletes are not enabled for {ticket_id}.', 405)
