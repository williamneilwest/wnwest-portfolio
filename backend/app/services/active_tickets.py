import csv
import io
import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from .data_processing import normalize_headers
from .data_sources.manager import get_source
from ..utils.storage import get_uploads_dir
from ..utils.note_cleaner import clean_note_blob


LOGGER = logging.getLogger(__name__)
_cached_dataset = None
_cached_metadata = None

SOURCE_EMAIL = 'email'
SOURCE_MANUAL = 'manual'
ASSIGNEE_PATTERNS = (
    re.compile(r'assigned_to', re.IGNORECASE),
    re.compile(r'assignee', re.IGNORECASE),
    re.compile(r'owner', re.IGNORECASE),
    re.compile(r'agent', re.IGNORECASE),
)
TICKET_ID_PATTERNS = (
    re.compile(r'^ticket$', re.IGNORECASE),
    re.compile(r'incident', re.IGNORECASE),
    re.compile(r'case', re.IGNORECASE),
    re.compile(r'request', re.IGNORECASE),
    re.compile(r'task', re.IGNORECASE),
    re.compile(r'number', re.IGNORECASE),
    re.compile(r'id', re.IGNORECASE),
)
STATUS_PATTERNS = (
    re.compile(r'status', re.IGNORECASE),
    re.compile(r'state', re.IGNORECASE),
    re.compile(r'resolution', re.IGNORECASE),
)
TITLE_PATTERNS = (
    re.compile(r'short_description', re.IGNORECASE),
    re.compile(r'^title$', re.IGNORECASE),
    re.compile(r'subject', re.IGNORECASE),
    re.compile(r'summary', re.IGNORECASE),
    re.compile(r'description', re.IGNORECASE),
)
PRIORITY_PATTERNS = (
    re.compile(r'priority', re.IGNORECASE),
    re.compile(r'severity', re.IGNORECASE),
    re.compile(r'impact', re.IGNORECASE),
    re.compile(r'urgency', re.IGNORECASE),
)
OPENED_AT_PATTERNS = (
    re.compile(r'opened', re.IGNORECASE),
    re.compile(r'created', re.IGNORECASE),
    re.compile(r'opened_at', re.IGNORECASE),
    re.compile(r'opened_on', re.IGNORECASE),
)
UPDATED_AT_PATTERNS = (
    re.compile(r'updated', re.IGNORECASE),
    re.compile(r'modified', re.IGNORECASE),
    re.compile(r'last_updated', re.IGNORECASE),
    re.compile(r'sys_updated_on', re.IGNORECASE),
)
DESCRIPTION_PATTERNS = (
    re.compile(r'^description$', re.IGNORECASE),
    re.compile(r'full_description', re.IGNORECASE),
    re.compile(r'issue_description', re.IGNORECASE),
    re.compile(r'details', re.IGNORECASE),
)
ACTIVE_BLOCKLIST = ('closed', 'resolved', 'complete', 'completed', 'done', 'cancelled', 'canceled')
TICKET_NUMBER_VALUE_PATTERN = re.compile(r'\b(?:INC|TASK|REQ)\s*[-_]?\s*\d+\b', re.IGNORECASE)
EMPTY_NOTE_TOKENS = {'', 'null', 'none', 'nan', '[]', '{}'}
NOTE_FIELD_CANDIDATES = {
    'comments': ('comments', 'u_task_1.comments'),
    'work_notes': ('work_notes', 'u_task_1.work_notes'),
    'comments_and_work_notes': ('comments_and_work_notes', 'u_task_1.comments_and_work_notes'),
    'work_notes_list': ('work_notes_list', 'u_task_1.work_notes_list'),
    'workflow_activity': ('workflow_activity', 'wf_activity', 'u_task_1.wf_activity'),
    'description': ('description', 'u_task_1.description'),
    'short_description': ('short_description', 'u_task_1.short_description'),
}
ACTIVE_TICKETS_UPLOAD_STEM = 'activeticketslah'


def _storage_root():
    return Path(os.getenv('BACKEND_DATA_DIR', '/app/data'))


def _is_active_tickets_upload_name(filename):
    name = str(filename or '').strip()
    if not name:
        return False

    path = Path(name)
    if path.suffix.lower() != '.csv':
        return False

    return path.stem.strip().lower() == ACTIVE_TICKETS_UPLOAD_STEM


def _latest_csv_path():
    return _storage_root() / 'latest.csv'


def _source_metadata_path():
    return _storage_root() / 'source.json'


def _ensure_storage_dir():
    _storage_root().mkdir(parents=True, exist_ok=True)


def _current_timestamp():
    return datetime.now(timezone.utc).isoformat()


def _format_file_mtime(value):
    if value is None:
        return None
    try:
        return datetime.fromtimestamp(float(value), tz=timezone.utc).isoformat()
    except (TypeError, ValueError, OSError):
        return None


def _resolve_active_ticket_dataset_path():
    uploads_dir = Path(get_uploads_dir())
    latest_upload_match = None
    latest_upload_mtime = -1.0

    if uploads_dir.exists():
        for entry in uploads_dir.iterdir():
            if not entry.is_file():
                continue
            name = entry.name
            lower_name = name.lower()
            if not lower_name.endswith('.csv'):
                continue
            if lower_name.endswith('.old') or lower_name.endswith('.meta.json'):
                continue
            if not _is_active_tickets_upload_name(name):
                continue

            try:
                mtime = entry.stat().st_mtime
            except OSError:
                mtime = 0
            if mtime >= latest_upload_mtime:
                latest_upload_mtime = mtime
                latest_upload_match = entry

    if latest_upload_match is not None:
        return latest_upload_match

    fixed_path = _storage_root() / 'work' / 'live' / 'ActiveTicketsLAH.csv'
    if fixed_path.exists():
        return fixed_path
    return None


def _parse_csv_bytes(content):
    decoded = content.decode('utf-8-sig', errors='replace')
    reader = csv.DictReader(io.StringIO(decoded))
    headers = normalize_headers(reader.fieldnames)
    reader.fieldnames = headers
    rows = [dict(row) for row in reader]
    combined_notes_empty = 0
    normalization_fallback_rows = 0

    for index, row in enumerate(rows):
        normalized = canonicalize_ticket_row(row, headers)
        fallback_used = bool(normalized.get('combined_notes')) and not clean_note_value(row.get('combined_notes'))
        rows[index] = normalized
        if fallback_used:
            normalization_fallback_rows += 1
        if not normalized.get('combined_notes'):
            combined_notes_empty += 1

    LOGGER.info('Active ticket dataset loaded with %s records.', len(rows))
    if normalization_fallback_rows:
        LOGGER.debug(
            'Active ticket note normalization used legacy/raw key fallback for %s rows.',
            normalization_fallback_rows,
        )
    if combined_notes_empty:
        LOGGER.debug(
            'Active ticket rows with empty combined_notes after normalization: %s of %s.',
            combined_notes_empty,
            len(rows),
        )

    return {
        'columns': headers,
        'rows': rows,
    }


def _dataset_from_rows(rows):
    source_rows = rows if isinstance(rows, list) else []
    key_order = []

    for row in source_rows:
        source_row = row if isinstance(row, dict) else {}
        keys = [str(key or '').strip() for key in source_row.keys()]
        for key in keys:
            if key and key not in key_order:
                key_order.append(key)

    discovered_columns = normalize_headers(key_order)
    if 'combined_notes' not in discovered_columns:
        discovered_columns.append('combined_notes')

    normalized_rows = []
    header_map = dict(zip(key_order, normalize_headers(key_order), strict=False))

    for row in source_rows:
        source_row = row if isinstance(row, dict) else {}
        aligned = {header_map.get(str(key), str(key)): value for key, value in source_row.items()}
        normalized = canonicalize_ticket_row(aligned, discovered_columns)
        normalized_rows.append(normalized)

    return {
        'columns': discovered_columns,
        'rows': normalized_rows,
    }


def _write_csv(dataset):
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=dataset['columns'], extrasaction='ignore')
    writer.writeheader()

    for row in dataset['rows']:
        writer.writerow({column: row.get(column, '') for column in dataset['columns']})

    content = output.getvalue().encode('utf-8')
    _latest_csv_path().write_bytes(content)
    LOGGER.info('Latest ticket CSV overwritten at %s', _latest_csv_path())


def _read_source_metadata():
    path = _source_metadata_path()
    if not path.exists():
        return {
            'source': None,
            'last_updated': None,
        }

    try:
        with path.open('r', encoding='utf-8') as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {
            'source': None,
            'last_updated': None,
        }

    if not isinstance(payload, dict):
        return {
            'source': None,
            'last_updated': None,
        }

    return {
        'source': payload.get('source'),
        'last_updated': payload.get('last_updated'),
    }


def _write_source_metadata(source, last_updated):
    _ensure_storage_dir()
    payload = {
        'source': source,
        'last_updated': last_updated,
    }

    with _source_metadata_path().open('w', encoding='utf-8') as handle:
        json.dump(payload, handle, indent=2)


def _set_cached_metadata(source, last_updated):
    global _cached_metadata
    path = _resolve_active_ticket_dataset_path()
    try:
        file_mtime = path.stat().st_mtime if path else None
    except OSError:
        file_mtime = None
    _cached_metadata = {
        'source': source,
        'last_updated': last_updated,
        'file_name': path.name if path else None,
        'file_mtime': file_mtime,
    }


def _find_assignee_column(columns):
    for column in columns:
        if any(pattern.search(column) for pattern in ASSIGNEE_PATTERNS):
            return column

    return ''


def _find_ticket_id_columns(columns):
    prioritized = []
    seen = set()

    for column in columns:
        if str(column).strip().lower() == 'ticket':
            prioritized.append(column)
            seen.add(column)
            break

    for pattern in TICKET_ID_PATTERNS:
        for column in columns:
            if column in seen:
                continue
            if pattern.search(str(column)):
                prioritized.append(column)
                seen.add(column)

    if not prioritized and columns:
        prioritized.append(columns[0])

    return prioritized


def _find_first_column(columns, patterns):
    for pattern in patterns:
        for column in columns:
            if pattern.search(str(column or '')):
                return column
    return ''


def _is_active_status(value):
    normalized = str(value or '').strip().lower()
    if not normalized:
        return True
    return not any(token in normalized for token in ACTIVE_BLOCKLIST)


def _normalize_priority(value):
    raw = str(value or '').strip()
    normalized = raw.lower()
    if not normalized:
        return 'Medium'
    if any(token in normalized for token in ('critical', 'p1', 'sev1')):
        return 'Critical'
    if any(token in normalized for token in ('high', 'p2', 'sev2')):
        return 'High'
    if any(token in normalized for token in ('low', 'p4', 'sev4')):
        return 'Low'
    if any(token in normalized for token in ('medium', 'med', 'p3', 'sev3')):
        return 'Medium'
    return raw[:24] or 'Medium'


def _is_flagged_row(row):
    if not isinstance(row, dict):
        return False
    for key, value in row.items():
        label = str(key or '').strip().lower()
        if 'flag' not in label:
            continue
        normalized = str(value or '').strip().lower()
        if normalized in {'true', '1', 'yes', 'y', 'flagged'}:
            return True
    return False


def clean_note_value(value):
    if value is None:
        return ''

    text = str(value).strip()
    if not text:
        return ''
    if text.lower() in EMPTY_NOTE_TOKENS:
        return ''
    return text


def _clean_text_value(value):
    text = str(value or '').strip()
    if not text:
        return ''
    if text.lower() in EMPTY_NOTE_TOKENS:
        return ''
    return text


def _resolve_row_value(row, keys):
    for key in keys:
        if key not in row:
            continue
        cleaned = clean_note_value(row.get(key))
        if cleaned:
            return cleaned, key
    return '', ''


def _resolve_text_value(row, keys):
    for key in keys:
        if key not in row:
            continue
        text = _clean_text_value(row.get(key))
        if text:
            return text
    return ''


def _resolve_pattern_value(row, patterns):
    if not isinstance(row, dict):
        return ''
    for pattern in patterns:
        for key, value in row.items():
            if pattern.search(str(key or '')):
                text = _clean_text_value(value)
                if text:
                    return text
    return ''


def resolve_combined_notes(row):
    first_candidates = (
        ('comments_and_work_notes', NOTE_FIELD_CANDIDATES['comments_and_work_notes']),
        ('work_notes', NOTE_FIELD_CANDIDATES['work_notes']),
        ('comments', NOTE_FIELD_CANDIDATES['comments']),
        ('work_notes_list', NOTE_FIELD_CANDIDATES['work_notes_list']),
        ('workflow_activity', NOTE_FIELD_CANDIDATES['workflow_activity']),
    )
    last_context = ('description', NOTE_FIELD_CANDIDATES['description'])
    chunks = []
    seen = set()

    for _, keys in first_candidates:
        value, _ = _resolve_row_value(row, keys)
        normalized = re.sub(r'\s+', ' ', value).strip().lower()
        if not value or normalized in seen:
            continue
        seen.add(normalized)
        chunks.append(value)

    if not chunks:
        description, _ = _resolve_row_value(row, last_context[1])
        if description:
            chunks.append(description)

    return '\n\n'.join(chunks).strip()


def _clean_ticket_text(value):
    return clean_note_blob(value)


def _resolve_ticket_assignee(row, columns):
    assignee_column = _find_assignee_column(columns if isinstance(columns, list) else [])
    if assignee_column:
        assignee_value = _clean_text_value(row.get(assignee_column))
        if assignee_value:
            return assignee_value
    return _resolve_pattern_value(row, ASSIGNEE_PATTERNS)


def _resolve_ticket_status(row, columns):
    status_column = _resolve_column(columns if isinstance(columns, list) else [], STATUS_PATTERNS)
    if status_column:
        status_value = _clean_text_value(row.get(status_column))
        if status_value:
            return status_value
    return _resolve_pattern_value(row, STATUS_PATTERNS)


def _resolve_ticket_opened_at(row):
    return _resolve_text_value(
        row,
        ('opened_at', 'opened_on', 'sys_created_on', 'created_at', 'created_on', 'opened'),
    ) or _resolve_pattern_value(row, OPENED_AT_PATTERNS)


def _resolve_ticket_updated_at(row):
    return _resolve_text_value(
        row,
        ('updated_at', 'updated_on', 'sys_updated_on', 'modified_at', 'last_updated'),
    ) or _resolve_pattern_value(row, UPDATED_AT_PATTERNS)


def _resolve_ticket_description(row, title=''):
    description = _resolve_text_value(
        row,
        ('description', 'u_task_1.description', 'full_description', 'issue_description'),
    ) or _resolve_pattern_value(row, DESCRIPTION_PATTERNS)
    cleaned = _clean_ticket_text(description)
    if cleaned:
        return cleaned
    return title


def canonicalize_ticket_row(row, columns=None):
    existing_row = dict(row) if isinstance(row, dict) else {}
    raw_source = existing_row.get('raw') if isinstance(existing_row.get('raw'), dict) else existing_row
    source_row = dict(raw_source) if isinstance(raw_source, dict) else {}
    normalized_legacy, _ = normalize_ticket_row(source_row)
    field_names = list(columns) if isinstance(columns, list) and columns else list(normalized_legacy.keys())

    ticket_id = _clean_text_value(normalized_legacy.get('ticket_id')) or _row_ticket_id(normalized_legacy, field_names)
    title = _resolve_ticket_title(normalized_legacy, field_names) or ticket_id or 'Untitled ticket'
    status = _resolve_ticket_status(normalized_legacy, field_names)
    assignee = _resolve_ticket_assignee(normalized_legacy, field_names)
    priority = _resolve_ticket_priority(normalized_legacy, field_names)
    opened_at = _resolve_ticket_opened_at(normalized_legacy)
    updated_at = _resolve_ticket_updated_at(normalized_legacy)
    combined_notes = _clean_ticket_text(normalized_legacy.get('combined_notes') or resolve_combined_notes(normalized_legacy))
    description = _resolve_ticket_description(normalized_legacy, title=title)

    enriched = {
        **existing_row,
        **normalized_legacy,
        'ticket_id': ticket_id,
        'title': title,
        'status': status,
        'assignee': assignee,
        'priority': priority,
        'opened_at': opened_at,
        'updated_at': updated_at,
        'description': description,
        'combined_notes': combined_notes,
        'raw': source_row,
    }

    # Backfill legacy fields for transition safety without removing any original keys.
    if ticket_id:
        enriched.setdefault('id', ticket_id)
        if not _clean_text_value(enriched.get('number')):
            enriched['number'] = ticket_id
    if title and not _clean_text_value(enriched.get('short_description')):
        enriched['short_description'] = title
    if assignee and not _clean_text_value(enriched.get('assigned_to')):
        enriched['assigned_to'] = assignee
    if priority and not _clean_text_value(enriched.get('Priority')):
        enriched['Priority'] = priority
    if status and not _clean_text_value(enriched.get('State')):
        enriched['State'] = status
    if description and not _clean_text_value(enriched.get('description')):
        enriched['description'] = description

    return enriched


def normalize_ticket_row(row):
    normalized = dict(row) if isinstance(row, dict) else {}
    fallback_used = False

    for canonical_key, keys in NOTE_FIELD_CANDIDATES.items():
        if clean_note_value(normalized.get(canonical_key)):
            continue
        resolved, source_key = _resolve_row_value(normalized, keys)
        if resolved:
            normalized[canonical_key] = resolved
            if source_key and source_key != canonical_key:
                fallback_used = True

    combined_notes = resolve_combined_notes(normalized)
    normalized['combined_notes'] = combined_notes
    return normalized, fallback_used


def _ensure_combined_notes(rows):
    if not isinstance(rows, list):
        return rows

    updated_rows = []
    for row in rows:
        if not isinstance(row, dict):
            updated_rows.append(row)
            continue
        if clean_note_value(row.get('combined_notes')):
            updated_rows.append(row)
            continue
        normalized, _ = normalize_ticket_row(row)
        updated_rows.append(normalized)
    return updated_rows


def _row_ticket_id(row, columns):
    for column in _find_ticket_id_columns(columns):
        value = str(row.get(column, '')).strip()
        if value:
            return value
    for value in (row.values() if isinstance(row, dict) else []):
        text = str(value or '').strip()
        if TICKET_NUMBER_VALUE_PATTERN.search(text):
            return text
    return ''


def _resolve_column(columns, patterns):
    return _find_first_column(columns, patterns)


def _resolve_ticket_title(row, columns):
    title_column = _resolve_column(columns, TITLE_PATTERNS)
    title = str(row.get(title_column, '')).strip() if title_column else ''
    if title:
        return title
    return str(row.get('short_description') or row.get('description') or '').strip()


def _resolve_ticket_priority(row, columns):
    priority_column = _resolve_column(columns, PRIORITY_PATTERNS)
    priority_value = row.get(priority_column, '') if priority_column else row.get('priority', '')
    return _normalize_priority(priority_value)


def normalize_ticket(ticket):
    row = ticket if isinstance(ticket, dict) else {}

    def _pick(*keys):
        for key in keys:
            value = row.get(key, '')
            if value is None:
                continue
            text = str(value).strip()
            if text:
                return text
        return ''

    ticket_id = _pick('ticket_id', 'number', 'Number', 'id')
    if not ticket_id and isinstance(row, dict):
        ticket_id = _row_ticket_id(row, list(row.keys()))

    title = _pick('title', 'short_description', 'Short description')
    if not title and ticket_id:
        title = ticket_id

    return {
        'id': ticket_id,
        'title': title,
        'assigned_to': _pick('assignee', 'assigned_to', 'Assigned to', 'Assignee'),
        'status': _pick('status', 'State'),
        'priority': _pick('priority', 'Priority'),
    }


def compute_ticket_metrics(tickets, columns):
    rows = tickets if isinstance(tickets, list) else []
    headers = columns if isinstance(columns, list) else []
    status_column = _resolve_column(headers, STATUS_PATTERNS)
    open_count = 0
    flagged_count = 0

    for row in rows:
        if status_column:
            if _is_active_status(row.get(status_column)):
                open_count += 1
        else:
            open_count += 1
        if _is_flagged_row(row):
            flagged_count += 1

    return {
        'total': len(rows),
        'flagged': flagged_count,
        'visible_columns': len(headers) if headers else 0,
        'open': open_count,
    }


def build_todo_from_tickets(tickets, assignee, columns, limit=10):
    rows = tickets if isinstance(tickets, list) else []
    max_items = max(1, min(10, int(limit or 10)))
    assignee_norm = str(assignee or '').strip().lower()

    if not assignee_norm:
        return []

    normalized_tickets = []
    for row in rows:
        normalized = normalize_ticket(row)
        if not normalized.get('id'):
            normalized['id'] = _row_ticket_id(row, columns if isinstance(columns, list) else []) or 'UNKNOWN'
        if not normalized.get('title'):
            normalized['title'] = str(row.get('description') or row.get('short_description') or f"Ticket {normalized['id']}").strip()
        if not normalized.get('priority'):
            normalized['priority'] = _normalize_priority(row.get('priority') or row.get('Priority') or '')
        normalized_tickets.append(normalized)

    items = []
    for ticket in normalized_tickets:
        assigned_to = str(ticket.get('assigned_to', '') or '').strip()
        status = str(ticket.get('status', '') or '').strip()

        if not assigned_to:
            continue
        if assignee_norm not in assigned_to.lower():
            continue
        if status and not _is_active_status(status):
            continue
        ticket_id = str(ticket.get('id', '') or '').strip() or 'UNKNOWN'
        title = str(ticket.get('title', '') or '').strip() or f'Ticket {ticket_id}'
        priority = _normalize_priority(ticket.get('priority', ''))

        items.append(
            {
                'id': ticket_id,
                'title': title,
                'priority': priority,
                'completed': False,
            }
        )
        if len(items) >= max_items:
            break

    return items


def load_active_ticket_dataset(force_reload=False):
    global _cached_dataset, _cached_metadata

    if _cached_dataset is not None and not force_reload:
        current_path = _resolve_active_ticket_dataset_path()
        current_name = current_path.name if current_path else None
        try:
            current_mtime = current_path.stat().st_mtime if current_path else None
        except OSError:
            current_mtime = None
        cached_name = (_cached_metadata or {}).get('file_name') if isinstance(_cached_metadata, dict) else None
        cached_mtime = (_cached_metadata or {}).get('file_mtime') if isinstance(_cached_metadata, dict) else None
        if current_name == cached_name and current_mtime == cached_mtime:
            _cached_dataset['rows'] = [canonicalize_ticket_row(row, _cached_dataset.get('columns', [])) for row in _ensure_combined_notes(_cached_dataset.get('rows', []))]
            return _cached_dataset

        if _cached_metadata is None:
            path = _resolve_active_ticket_dataset_path()
            try:
                file_mtime = path.stat().st_mtime if path and path.exists() else None
            except OSError:
                file_mtime = None
            _cached_metadata = {
                **_read_source_metadata(),
                'file_name': path.name if path else None,
                'file_mtime': file_mtime,
            }

    path = _resolve_active_ticket_dataset_path()

    source_rows = get_source('active_tickets')
    if isinstance(source_rows, list) and source_rows:
        _cached_dataset = _dataset_from_rows(source_rows)
        _cached_metadata = {
            **_read_source_metadata(),
            'source': 'data_source',
            'file_name': 'active_tickets',
            'file_mtime': None,
        }
        return _cached_dataset

    if path is None or not path.exists():
        _cached_dataset = {
            'columns': [],
            'rows': [],
        }
        _cached_metadata = {
            **_read_source_metadata(),
            'file_name': None,
            'file_mtime': None,
        }
        return _cached_dataset

    content = path.read_bytes()
    _cached_dataset = _parse_csv_bytes(content)
    try:
        file_mtime = path.stat().st_mtime
    except OSError:
        file_mtime = None
    _cached_metadata = {
        **_read_source_metadata(),
        'file_name': path.name,
        'file_mtime': file_mtime,
    }
    return _cached_dataset


def get_source_metadata(force_reload=False):
    global _cached_metadata

    if _cached_metadata is not None and not force_reload:
        return _cached_metadata

    path = _resolve_active_ticket_dataset_path()
    try:
        file_mtime = path.stat().st_mtime if path and path.exists() else None
    except OSError:
        file_mtime = None
    _cached_metadata = {
        **_read_source_metadata(),
        'file_name': path.name if path else None,
        'file_mtime': file_mtime,
    }
    return _cached_metadata


def cache_active_ticket_dataset(content, source):
    global _cached_dataset

    _ensure_storage_dir()
    dataset = _parse_csv_bytes(content)
    _write_csv(dataset)
    timestamp = _current_timestamp()
    _write_source_metadata(source, timestamp)
    _set_cached_metadata(source, timestamp)
    _cached_dataset = dataset
    return dataset


def load_latest_ticket_payload(force_reload=False):
    dataset = load_active_ticket_dataset(force_reload=force_reload)
    metadata = get_source_metadata(force_reload=force_reload)
    last_updated = metadata.get('last_updated') or _format_file_mtime(metadata.get('file_mtime'))

    return {
        'source': metadata.get('source'),
        'last_updated': last_updated,
        'fileName': metadata.get('file_name'),
        'tickets': dataset['rows'],
        'columns': dataset['columns'],
        'message': '' if dataset['rows'] else 'No CSV dataset has been loaded yet.',
    }


def get_ticket_by_id(ticket_id):
    dataset = load_active_ticket_dataset()
    ticket_id_norm = str(ticket_id or '').strip()
    for row in dataset['rows']:
        if str(row.get('ticket_id') or '').strip() == ticket_id_norm:
            return row
        if _row_ticket_id(row, dataset['columns']) == ticket_id_norm:
            return row

    return None


def update_ticket_assignee(ticket_id, assignee):
    global _cached_dataset

    dataset = load_active_ticket_dataset()
    path = _resolve_active_ticket_dataset_path()
    assignee_column = _find_assignee_column(dataset['columns'])

    if not assignee_column:
        raise ValueError('The latest dataset does not include an assignee column.')

    if path is None:
        raise ValueError('No active ticket dataset is available.')

    updated = False
    ticket_id_norm = str(ticket_id or '').strip()
    for row in dataset['rows']:
        row_ticket_id = str(row.get('ticket_id') or '').strip() or _row_ticket_id(row, dataset['columns'])
        if row_ticket_id != ticket_id_norm:
            continue

        row[assignee_column] = assignee
        if isinstance(row.get('raw'), dict):
            row['raw'][assignee_column] = assignee
        row['assignee'] = assignee
        if not _clean_text_value(row.get('assigned_to')):
            row['assigned_to'] = assignee
        updated = True
        break

    if not updated:
        return None

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=dataset['columns'], extrasaction='ignore')
    writer.writeheader()

    for row in dataset['rows']:
        writer.writerow({column: row.get(column, '') for column in dataset['columns']})

    path.write_bytes(output.getvalue().encode('utf-8'))
    metadata = get_source_metadata()
    last_updated = _current_timestamp()
    source = metadata.get('source') or SOURCE_MANUAL
    _write_source_metadata(source, last_updated)
    _set_cached_metadata(source, last_updated)
    _cached_dataset = dataset
    return get_ticket_by_id(ticket_id)


def get_active_tickets_for_assignee(assignee, limit=15):
    dataset = load_active_ticket_dataset()
    columns = dataset.get('columns') or []
    rows = dataset.get('rows') or []

    assignee_column = _find_assignee_column(columns)
    if not assignee_column:
        return []

    assignee_norm = str(assignee or '').strip().lower()
    if not assignee_norm:
        return []
    todo = build_todo_from_tickets(rows, assignee_norm, columns, limit=max(10, min(20, int(limit or 15))))
    return [
        {
            'id': item.get('id'),
            'title': item.get('title'),
            'description': item.get('summary'),
            'priority': item.get('priority'),
            'assigned_to': assignee,
        }
        for item in todo
    ]
