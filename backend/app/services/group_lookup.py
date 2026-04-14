import json
import os

import requests
from sqlalchemy import func

from ..models.reference import Group, SessionLocal, init_db
from .group_metadata import merge_group_tags, normalize_tags
from .flow_runs import track_flow_run


DEFAULT_SCRIPT_NAME = 'Search Groups'
DEFAULT_USER_GROUPS_SCRIPT_NAME = 'Get User Groups'
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
    description = str(
        item.get('description')
        or item.get('groupDescription')
        or item.get('group_description')
        or ''
    ).strip()
    tags = item.get('tags') or item.get('groupTags') or item.get('group_tags') or ''

    if not group_id and not name:
        return None

    if not group_id:
        group_id = name
    if not name:
        name = group_id

    return {
        'id': group_id,
        'name': name,
        'description': description,
        'tags': normalize_tags(tags),
    }


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


def _extract_group_ids(value):
    if isinstance(value, list):
        group_ids = []
        for item in value:
          group_ids.extend(_extract_group_ids(item))
        return group_ids

    if isinstance(value, dict):
        group_ids = []
        for nested in value.values():
            group_ids.extend(_extract_group_ids(nested))
        return group_ids

    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []

        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return [text]
        return _extract_group_ids(parsed)

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
        return [
            {
                'id': group.id,
                'name': group.name,
                'description': group.description or '',
                'tags': group.tags or '',
            }
            for group in results
        ]
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
                if group['name'] and not (existing.name or '').strip():
                    existing.name = group['name']
                    updated += 1
                if group['description'] and not (existing.description or '').strip():
                    existing.description = group['description']
                    updated += 1
                merged_tags = ', '.join(merge_group_tags(existing.tags, group['tags'], existing.name or group['name'] or group['id']))
                if merged_tags != (existing.tags or ''):
                    existing.tags = merged_tags or None
                    updated += 1
            else:
                session.add(
                    Group(
                        id=group['id'],
                        name=group['name'],
                        description=group['description'] or None,
                        tags=', '.join(merge_group_tags('', group['tags'], group['name'] or group['id'])) or None,
                    )
                )
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


def resolve_groups_by_ids(group_ids):
    _ensure_db()
    ordered_ids = []
    seen_ids = set()

    for raw_id in group_ids:
        normalized_id = str(raw_id or '').strip().strip('"').strip("'").strip(',')
        if not normalized_id or normalized_id in seen_ids:
            continue
        ordered_ids.append(normalized_id)
        seen_ids.add(normalized_id)

    if not ordered_ids:
        return {
            'items': [],
            'identifiedCount': 0,
            'totalCount': 0,
            'created': 0,
        }

    session = SessionLocal()
    try:
        existing_groups = {
            group.id: group
            for group in session.query(Group).filter(Group.id.in_(ordered_ids)).all()
        }

        created = 0
        items = []
        identified_count = 0

        for group_id in ordered_ids:
            existing = existing_groups.get(group_id)
            if existing:
                name = existing.name or group_id
                known = bool(existing.name and existing.name != group_id)
                if known:
                    identified_count += 1
            else:
                session.add(Group(id=group_id, name=group_id))
                created += 1
                name = group_id
                known = False

            items.append({
                'id': group_id,
                'name': name,
                'description': existing.description if existing else '',
                'tags': existing.tags if existing else '',
                'identified': known,
            })

        if created:
            session.commit()

        return {
            'items': items,
            'identifiedCount': identified_count,
            'totalCount': len(items),
            'created': created,
        }
    finally:
        session.close()


def lookup_groups_via_flow(search_text, user_id=None):
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

    def _execute():
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

    return track_flow_run(
        'Search Groups',
        user_id,
        {'scriptName': script_name, 'variables': {'searchText': query}},
        _execute,
    )


def lookup_groups(search_text, user_id=None):
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

    return lookup_groups_via_flow(query, user_id=user_id)


def get_user_groups_via_flow(user_opid, user_id=None):
    normalized_user_opid = str(user_opid or '').strip()
    if not normalized_user_opid:
        raise RuntimeError('user_opid is required')

    flow_url = os.getenv('POWER_AUTOMATE_GROUP_SEARCH_URL', '').strip()
    script_name = os.getenv('POWER_AUTOMATE_USER_GROUPS_SCRIPT_NAME', DEFAULT_USER_GROUPS_SCRIPT_NAME).strip() or DEFAULT_USER_GROUPS_SCRIPT_NAME
    timeout = int(os.getenv('POWER_AUTOMATE_GROUP_TIMEOUT_SECONDS', str(DEFAULT_TIMEOUT_SECONDS)))

    if not flow_url:
        raise RuntimeError('POWER_AUTOMATE_GROUP_SEARCH_URL is not configured')

    payload = {
        'scriptName': script_name,
        'variables': {
            'user_opid': normalized_user_opid,
        },
    }

    def _execute():
        response = requests.post(
            flow_url,
            json=payload,
            headers={'Content-Type': 'application/json'},
            timeout=timeout,
        )
        response.raise_for_status()

        raw_text = response.text or ''
        try:
            parsed_body = response.json()
        except ValueError:
            parsed_body = raw_text

        resolved = resolve_groups_by_ids(_extract_group_ids(parsed_body))

        return {
            'source': 'flow',
            'userOpid': normalized_user_opid,
            'items': resolved['items'],
            'identifiedCount': resolved['identifiedCount'],
            'totalCount': resolved['totalCount'],
            'created': resolved['created'],
            'raw': raw_text,
        }

    return track_flow_run(
        'Get User Groups',
        user_id,
        {'scriptName': script_name, 'variables': {'user_opid': normalized_user_opid}},
        _execute,
    )
