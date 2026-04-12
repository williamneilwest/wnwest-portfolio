import logging
from io import BytesIO

from flask import Blueprint, Response, request

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
    get_ticket_by_id,
    load_latest_ticket_payload,
    update_ticket_assignee,
)
from ..services.analysis_store import get_analysis_file, list_recent_analyses, save_analysis
from ..services.csv_analyzer import build_csv_analysis

work_bp = Blueprint('work', __name__)
LOGGER = logging.getLogger(__name__)


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
