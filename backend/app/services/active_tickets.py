import csv
import io
import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from .data_processing import normalize_headers


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
ACTIVE_BLOCKLIST = ('closed', 'resolved', 'complete', 'completed', 'done', 'cancelled', 'canceled')


def _storage_root():
    return Path(os.getenv('BACKEND_DATA_DIR', '/app/data'))


def _latest_csv_path():
    return _storage_root() / 'latest.csv'


def _source_metadata_path():
    return _storage_root() / 'source.json'


def _ensure_storage_dir():
    _storage_root().mkdir(parents=True, exist_ok=True)


def _current_timestamp():
    return datetime.now(timezone.utc).isoformat()


def _resolve_active_ticket_dataset_path():
    fixed_path = _storage_root() / 'work' / 'live' / 'ActiveTicketsLAH.csv'
    if not fixed_path.exists():
        return None
    return fixed_path


def _parse_csv_bytes(content):
    decoded = content.decode('utf-8-sig', errors='replace')
    reader = csv.DictReader(io.StringIO(decoded))
    headers = normalize_headers(reader.fieldnames)
    reader.fieldnames = headers
    rows = [dict(row) for row in reader]

    LOGGER.info('Active ticket dataset loaded with %s records.', len(rows))

    return {
        'columns': headers,
        'rows': rows,
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
    _cached_metadata = {
        'source': source,
        'last_updated': last_updated,
        'file_name': path.name if path else None,
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


def _row_ticket_id(row, columns):
    for column in _find_ticket_id_columns(columns):
        value = str(row.get(column, '')).strip()
        if value:
            return value
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

    return {
        'id': _pick('number', 'Number'),
        'title': _pick('short_description', 'Short description'),
        'assigned_to': _pick('assigned_to', 'Assigned to', 'Assignee'),
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
    filtered_count = 0
    for ticket in normalized_tickets:
        assigned_to = str(ticket.get('assigned_to', '') or '').strip()
        status = str(ticket.get('status', '') or '').strip()

        if not assigned_to:
            continue
        if assignee_norm not in assigned_to.lower():
            continue
        if status and not _is_active_status(status):
            continue
        filtered_count += 1

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

    print('ASSIGNEE FILTER:', assignee)
    print('MATCHES FOUND:', filtered_count)

    return items


def load_active_ticket_dataset(force_reload=False):
    global _cached_dataset, _cached_metadata

    if _cached_dataset is not None and not force_reload:
        if _cached_metadata is None:
            path = _resolve_active_ticket_dataset_path()
            _cached_metadata = {
                **_read_source_metadata(),
                'file_name': path.name if path else None,
            }
        return _cached_dataset

    path = _resolve_active_ticket_dataset_path()

    if path is None or not path.exists():
        _cached_dataset = {
            'columns': [],
            'rows': [],
        }
        _cached_metadata = {
            **_read_source_metadata(),
            'file_name': None,
        }
        return _cached_dataset

    content = path.read_bytes()
    _cached_dataset = _parse_csv_bytes(content)
    _cached_metadata = {
        **_read_source_metadata(),
        'file_name': path.name,
    }
    return _cached_dataset


def get_source_metadata(force_reload=False):
    global _cached_metadata

    if _cached_metadata is not None and not force_reload:
        return _cached_metadata

    path = _resolve_active_ticket_dataset_path()
    _cached_metadata = {
        **_read_source_metadata(),
        'file_name': path.name if path else None,
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

    return {
        'source': metadata.get('source'),
        'last_updated': metadata.get('last_updated'),
        'fileName': metadata.get('file_name'),
        'tickets': dataset['rows'],
        'columns': dataset['columns'],
        'message': '' if dataset['rows'] else 'No CSV dataset has been loaded yet.',
    }


def get_ticket_by_id(ticket_id):
    dataset = load_active_ticket_dataset()
    ticket_id_norm = str(ticket_id or '').strip()
    for row in dataset['rows']:
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
        if _row_ticket_id(row, dataset['columns']) != ticket_id_norm:
            continue

        row[assignee_column] = assignee
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
