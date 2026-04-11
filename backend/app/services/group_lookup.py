import json
import os

import requests
from sqlalchemy import func

from ..models.reference import Group, SessionLocal, init_db


DEFAULT_SCRIPT_NAME = 'Search Groups'
DEFAULT_TIMEOUT_SECONDS = 20


def _ensure_db():
    try:
        init_db()
    except Exception:
        pass


def _normalize_group(item):
    if not isinstance(item, dict):
        return None

    group_id = str(
        item.get('id')
        or item.get('groupId')
        or item.get('group_id')
        or item.get('aadGroupId')
        or ''
    ).strip()
    name = str(
        item.get('name')
        or item.get('groupName')
        or item.get('group_name')
        or item.get('displayName')
        or ''
    ).strip()

    if not group_id and not name:
        return None

    if not group_id:
        group_id = name
    if not name:
        name = group_id

    return {'id': group_id, 'name': name}


def _extract_groups(value):
    if isinstance(value, list):
        groups = []
        for item in value:
            normalized = _normalize_group(item)
            if normalized:
                groups.append(normalized)
                continue

            groups.extend(_extract_groups(item))
        return groups

    if isinstance(value, dict):
        normalized = _normalize_group(value)
        if normalized:
            return [normalized]

        groups = []
        for nested in value.values():
            groups.extend(_extract_groups(nested))
        return groups

    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []

        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return []
        return _extract_groups(parsed)

    return []


def search_cached_groups(search_text, limit=20):
    _ensure_db()
    query = (search_text or '').strip()
    if not query:
        return []

    session = SessionLocal()
    try:
        lowered = query.lower()
        results = (
            session.query(Group)
            .filter(func.lower(Group.name).like(f'%{lowered}%'))
            .order_by(Group.name.asc())
            .limit(limit)
            .all()
        )
        return [{'id': group.id, 'name': group.name} for group in results]
    finally:
        session.close()


def upsert_groups(groups):
    _ensure_db()
    created = 0
    updated = 0
    unique_groups = {}

    for group in groups:
        normalized = _normalize_group(group)
        if normalized:
            unique_groups[normalized['id']] = normalized

    session = SessionLocal()
    try:
        for group in unique_groups.values():
            existing = session.get(Group, group['id'])
            if existing:
                if group['name'] and existing.name != group['name']:
                    existing.name = group['name']
                    updated += 1
            else:
                session.add(Group(id=group['id'], name=group['name']))
                created += 1

        session.commit()
        return {
            'created': created,
            'updated': updated,
            'total': created + updated,
            'items': list(unique_groups.values()),
        }
    finally:
        session.close()


def lookup_groups_via_flow(search_text):
    query = (search_text or '').strip()
    if not query:
        return {'source': 'flow', 'items': [], 'cacheHit': False, 'upserted': {'created': 0, 'updated': 0, 'total': 0}}

    flow_url = os.getenv('POWER_AUTOMATE_GROUP_SEARCH_URL', '').strip()
    script_name = os.getenv('POWER_AUTOMATE_GROUP_SCRIPT_NAME', DEFAULT_SCRIPT_NAME).strip() or DEFAULT_SCRIPT_NAME
    timeout = int(os.getenv('POWER_AUTOMATE_GROUP_TIMEOUT_SECONDS', str(DEFAULT_TIMEOUT_SECONDS)))

    if not flow_url:
        raise RuntimeError('POWER_AUTOMATE_GROUP_SEARCH_URL is not configured')

    payload = {
        'scriptName': script_name,
        'variables': {
            'searchText': query,
        },
    }

    response = requests.post(
        flow_url,
        json=payload,
        headers={'Content-Type': 'application/json'},
        timeout=timeout,
    )
    response.raise_for_status()

    raw_text = response.text or ''
    parsed_body = None
    try:
        parsed_body = response.json()
    except ValueError:
        parsed_body = raw_text

    groups = _extract_groups(parsed_body)
    upserted = upsert_groups(groups)

    return {
        'source': 'flow',
        'items': upserted['items'],
        'cacheHit': False,
        'upserted': {
            'created': upserted['created'],
            'updated': upserted['updated'],
            'total': upserted['total'],
        },
        'raw': raw_text,
    }


def lookup_groups(search_text):
    query = (search_text or '').strip()
    if not query:
        return {'source': 'cache', 'items': [], 'cacheHit': False, 'upserted': {'created': 0, 'updated': 0, 'total': 0}}

    cached = search_cached_groups(query)
    if cached:
        return {
            'source': 'cache',
            'items': cached,
            'cacheHit': True,
            'upserted': {'created': 0, 'updated': 0, 'total': 0},
        }

    return lookup_groups_via_flow(query)
