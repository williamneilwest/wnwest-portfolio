import json
import os
import logging
from time import perf_counter

import requests
from sqlalchemy import func, or_

from ..models.reference import Group, SessionLocal, init_db
from .group_metadata import merge_group_tags, normalize_tags
from .flow_runs import track_flow_run
from .entity_cache_service import (
    get_cached_user_membership,
    replace_user_groups,
    upsert_user,
)
from .flow_ingest_service import ingest_flow_response


DEFAULT_SCRIPT_NAME = 'Search Groups'
DEFAULT_USER_GROUPS_SCRIPT_NAME = 'Get User Groups'
DEFAULT_TIMEOUT_SECONDS = 20
LOGGER = logging.getLogger(__name__)


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
        'group_id': group_id,
        'name': name,
        'description': description,
        'tags': normalize_tags(tags),
        'raw_json': item if isinstance(item, dict) else {},
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
            .filter(
                or_(
                    func.lower(Group.name).like(f'%{lowered}%'),
                    func.lower(Group.id).like(f'%{lowered}%'),
                )
            )
            .order_by(Group.name.asc(), Group.id.asc())
            .limit(limit)
            .all()
        )
        return [
            {
                'group_id': group.id,
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
    updated_count = 0
    unique_groups = {}

    for group in groups:
        normalized = _normalize_group(group)
        if normalized:
            unique_groups[normalized['group_id']] = normalized

    session = SessionLocal()
    try:
        for group in unique_groups.values():
            existing = session.get(Group, group['group_id'])
            if existing is None:
                existing = Group(id=group['group_id'])
                session.add(existing)

            new_name = str(group.get('name') or group['group_id']).strip() or group['group_id']
            new_description = str(group.get('description') or '').strip() or None
            new_tags = ', '.join(normalize_tags(group.get('tags'))) or None
            new_raw = group.get('raw_json') if isinstance(group.get('raw_json'), dict) else {}

            changed = (
                (existing.name or '') != new_name
                or (existing.description or None) != new_description
                or (existing.tags or None) != new_tags
                or (getattr(existing, 'raw_json', None) or {}) != new_raw
            )

            if not changed:
                continue

            existing.name = new_name
            existing.description = new_description
            existing.tags = new_tags
            if hasattr(existing, 'raw_json'):
                existing.raw_json = new_raw
            if hasattr(existing, 'updated_at'):
                existing.updated_at = _utc_now()
            updated_count += 1

        session.commit()
        print(f"[GROUP UPSERT] Updated {updated_count} records")
        return {
            'created': 0,
            'updated': updated_count,
            'total': updated_count,
            'items': list(unique_groups.values()),
        }
    finally:
        session.close()


def call_search_groups_flow(query):
    flow_url = os.getenv('POWER_AUTOMATE_GROUP_SEARCH_URL', '').strip()
    if not flow_url:
        raise RuntimeError('POWER_AUTOMATE_GROUP_SEARCH_URL is not configured')

    script_name = os.getenv('POWER_AUTOMATE_GROUP_SCRIPT_NAME', 'SearchGroups').strip() or 'SearchGroups'
    timeout = int(os.getenv('POWER_AUTOMATE_GROUP_TIMEOUT_SECONDS', str(DEFAULT_TIMEOUT_SECONDS)))
    payload = {
        'scriptName': script_name,
        'variables': {
            'query': query,
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

    try:
        data = response.json()
    except ValueError:
        data = {}

    if isinstance(data, dict):
        value = data.get('value')
        if isinstance(value, list):
            return value
        groups = data.get('groups')
        if isinstance(groups, list):
            return groups

    extracted = _extract_groups(data)
    return [item.get('raw_json') or item for item in extracted if isinstance(item, dict)]


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
                'group_id': group_id,
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
        flow_groups = call_search_groups_flow(query)
        ingest_flow_response({'groups': flow_groups})
        groups = _extract_groups(flow_groups)
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

    started = perf_counter()
    cached = search_cached_groups(query)
    if cached:
        LOGGER.info(
            'cache_hit flow=Search Groups query=%s groups=%s duration_ms=%s',
            query,
            len(cached),
            int((perf_counter() - started) * 1000),
        )
        return {
            'source': 'cache',
            'items': cached,
            'cacheHit': True,
            'upserted': {'created': 0, 'updated': 0, 'total': 0},
        }

    result = lookup_groups_via_flow(query, user_id=user_id)
    LOGGER.info(
        'flow_called flow=Search Groups query=%s groups=%s duration_ms=%s',
        query,
        len(result.get('items') or []),
        int((perf_counter() - started) * 1000),
    )
    return result


def get_user_groups_via_flow(user_opid, user_id=None):
    _ensure_db()
    normalized_user_opid = str(user_opid or '').strip()
    if not normalized_user_opid:
        raise RuntimeError('user_opid is required')

    ttl_minutes = int(os.getenv('CACHE_TTL_MINUTES', '15'))
    started = perf_counter()
    cache_session = SessionLocal()
    try:
        cached = get_cached_user_membership(cache_session, normalized_user_opid, ttl_minutes=ttl_minutes)
        if cached is not None:
            items = cached.get('groups') if isinstance(cached, dict) else []
            cached_user = cached.get('user') if isinstance(cached, dict) else None
            identified_count = len([item for item in items if bool(item.get('identified'))])
            LOGGER.info(
                'cache_hit flow=Get User Groups user=%s groups=%s ttl_minutes=%s duration_ms=%s',
                normalized_user_opid,
                len(items),
                ttl_minutes,
                int((perf_counter() - started) * 1000),
            )
            return {
                'source': 'cache',
                'user': {
                    'user_id': normalized_user_opid,
                    'name': str(getattr(cached_user, 'name', '') or '').strip(),
                    'email': str(getattr(cached_user, 'email', '') or '').strip(),
                },
                'userOpid': normalized_user_opid,
                'groups': [
                    {'group_id': str(group.get('group_id') or '').strip()}
                    for group in items
                    if str(group.get('group_id') or '').strip()
                ],
                'items': items,
                'identifiedCount': identified_count,
                'totalCount': len(items),
                'created': 0,
            }
    finally:
        cache_session.close()

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

        ingest_flow_response(parsed_body)
        resolved = resolve_groups_by_ids(_extract_group_ids(parsed_body))
        session = SessionLocal()
        try:
            upsert_user(
                session,
                {
                    'id': normalized_user_opid,
                    'name': normalized_user_opid,
                    'email': '',
                    'source': 'flow',
                },
            )
            replace_user_groups(session, normalized_user_opid, resolved['items'], source='flow')
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

        LOGGER.info(
            'flow_called flow=Get User Groups user=%s groups=%s duration_ms=%s',
            normalized_user_opid,
            len(resolved['items']),
            int((perf_counter() - started) * 1000),
        )

        return {
            'source': 'flow',
            'user': {
                'user_id': normalized_user_opid,
                'name': normalized_user_opid,
                'email': '',
            },
            'userOpid': normalized_user_opid,
            'groups': [{'group_id': str(group.get('group_id') or '').strip()} for group in resolved['items'] if str(group.get('group_id') or '').strip()],
            'items': resolved['items'],
            'identifiedCount': resolved['identifiedCount'],
            'totalCount': resolved['totalCount'],
            'created': resolved['created'],
        }

    return track_flow_run(
        'Get User Groups',
        user_id,
        {'scriptName': script_name, 'variables': {'user_opid': normalized_user_opid}},
        _execute,
    )


def user_group_id_set(user_groups):
    groups = user_groups if isinstance(user_groups, list) else []
    return {
        str(group.get('group_id') or '').strip()
        for group in groups
        if isinstance(group, dict) and str(group.get('group_id') or '').strip()
    }


def has_group(user_group_ids, group_id):
    expected = str(group_id or '').strip()
    return bool(expected and expected in (user_group_ids or set()))


def user_has_group(user_groups, group_id):
    return has_group(user_group_id_set(user_groups), group_id)
