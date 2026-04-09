from collections import Counter


def normalize_headers(fieldnames):
    if not fieldnames:
        return []

    normalized = []

    for fieldname in fieldnames:
        value = (fieldname or '').strip()
        normalized.append(value or 'unnamed_column')

    return normalized


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
