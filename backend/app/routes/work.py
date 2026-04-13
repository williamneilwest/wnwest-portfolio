import logging
import json
import re
from datetime import datetime
from io import BytesIO

from flask import Blueprint, Response, current_app, request

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
    SOURCE_EMAIL,
    get_active_tickets_for_assignee,
    get_ticket_by_id,
    load_latest_ticket_payload,
    update_ticket_assignee,
)
from ..services.analysis_store import get_analysis_file, list_recent_analyses, save_analysis
from ..services.ai_client import build_compat_chat_response, call_gateway_chat
from ..services.csv_analyzer import build_csv_analysis

work_bp = Blueprint('work', __name__)
LOGGER = logging.getLogger(__name__)


def _extract_json_block(value):
    text = str(value or '').strip()
    if not text:
        return {}
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        pass

    match = re.search(r'\{[\s\S]*\}', text)
    if not match:
        return {}
    try:
        parsed = json.loads(match.group(0))
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


def _build_todo_fallback_items(tickets):
    items = []
    for ticket in tickets:
        summary = str(ticket.get('description') or '').strip()
        if summary:
            summary = re.split(r'(?<=[.!?])\s+', summary)[0].strip()
        if not summary:
            summary = 'Review and complete the next required action.'
        items.append(
            {
                'id': str(ticket.get('id') or '').strip() or 'UNKNOWN',
                'title': str(ticket.get('title') or '').strip() or 'Untitled ticket',
                'summary': summary[:180],
                'priority': str(ticket.get('priority') or 'Medium').strip() or 'Medium',
                'completed': False,
            }
        )
    return items


def _transform_tickets_to_todo_items(assignee, tickets):
    prompt = (
        'You are an IT task assistant.\n\n'
        'Convert the following active tickets into a concise daily to-do list.\n\n'
        'Rules:\n'
        '- Each item should be actionable\n'
        '- Keep summaries short (1 sentence)\n'
        '- Focus on what needs to be done\n'
        '- Do NOT repeat full ticket descriptions\n'
        '- Prioritize clarity over detail\n\n'
        'Return JSON format:\n\n'
        '{\n'
        '  "items": [\n'
        '    {\n'
        '      "id": "",\n'
        '      "title": "",\n'
        '      "summary": "",\n'
        '      "priority": ""\n'
        '    }\n'
        '  ]\n'
        '}\n\n'
        f'Tickets:\n{json.dumps(tickets, ensure_ascii=True, indent=2)}'
    )

    try:
        result = call_gateway_chat(
            {
                'message': prompt,
                'analysis_mode': 'ticket_todo',
                'route_selected': 'work',
                'source_agent': 'ticket_analyzer',
                'original_user_query': f'Daily actionable to-do list for {assignee}',
                'response_type': 'ticket_todo',
            },
            current_app.config.get('AI_GATEWAY_BASE_URL', ''),
            agent_id='ticket_analyzer',
            context={'assignee': assignee, 'tickets': tickets},
        )
        compat = build_compat_chat_response({'message': prompt}, result)
        parsed = _extract_json_block(compat.get('message') if isinstance(compat, dict) else '')
    except Exception as error:
        LOGGER.warning('Ticket todo AI transform failed: %s', error)
        parsed = {}

    raw_items = parsed.get('items') if isinstance(parsed.get('items'), list) else []
    normalized_items = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        normalized_items.append(
            {
                'id': str(item.get('id') or '').strip() or 'UNKNOWN',
                'title': str(item.get('title') or '').strip() or 'Untitled ticket',
                'summary': str(item.get('summary') or '').strip() or 'Review and complete the next required action.',
                'priority': str(item.get('priority') or 'Medium').strip() or 'Medium',
                'completed': False,
            }
        )

    return normalized_items or _build_todo_fallback_items(tickets)


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
@work_bp.get('/api/tickets')
@work_bp.get('/api/tickets/latest')
def latest_tickets():
    try:
        payload = load_latest_ticket_payload()
        return success_response(payload)
    except ValueError as error:
        return error_response(str(error), 400)


@work_bp.get('/api/tickets/todo')
def ticket_todo():
    assignee = str(request.args.get('assignee') or '').strip()
    if not assignee:
        return error_response('assignee is required.', 400)

    tickets = get_active_tickets_for_assignee(assignee, limit=15)
    response_date = datetime.now().date().isoformat()

    if not tickets:
        return success_response(
            {
                'assignee': assignee,
                'date': response_date,
                'items': [],
                'message': 'No active tickets',
            }
        )

    items = _transform_tickets_to_todo_items(assignee, tickets)
    return success_response(
        {
            'assignee': assignee,
            'date': response_date,
            'items': items,
        }
    )


@work_bp.get('/api/tickets/<ticket_id>')
def get_ticket(ticket_id):
    try:
        ticket = get_ticket_by_id(ticket_id)
    except ValueError as error:
        return error_response(str(error), 400)

    if not ticket:
        return error_response(f'Ticket {ticket_id} was not found.', 404)

    return success_response(ticket)


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
