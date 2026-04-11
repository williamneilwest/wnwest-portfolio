from collections import Counter
import re

HEADER_MAPPING = {
    'u_task_1': 'Ticket',
}


def _normalize_header(fieldname):
    value = str(fieldname or '').strip().lower()

    if '.' in value:
        value = value.rsplit('.', 1)[-1]

    value = re.sub(r'\s+', '_', value)
    value = re.sub(r'[^a-z0-9_]+', '', value)
    value = value.strip('_')

    return value or 'unnamed_column'


def normalize_headers(fieldnames):
    if not fieldnames:
        return []

    normalized = [_normalize_header(fieldname) for fieldname in fieldnames]
    return [HEADER_MAPPING.get(header, header) for header in normalized]


def summarize_non_empty_values(rows, headers):
    non_empty_counts = Counter()

    for row in rows:
        for header in headers:
            value = str(row.get(header, '')).strip()

            if value:
                non_empty_counts[header] += 1

    return [
        {
            'column': header,
            'filled': non_empty_counts.get(header, 0),
            'empty': max(len(rows) - non_empty_counts.get(header, 0), 0),
        }
        for header in headers
    ]


def detect_category_column(headers):
    priority_names = [
        'category',
        'type',
        'status',
        'department',
        'team',
        'group',
        'owner',
    ]

    header_map = {header.lower(): header for header in headers}

    for name in priority_names:
        if name in header_map:
            return header_map[name]

    return headers[0] if headers else None
