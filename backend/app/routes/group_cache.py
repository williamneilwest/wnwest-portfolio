from flask import Blueprint, jsonify, request

from ..models.reference import Group, SessionLocal, init_db
from ..services.group_lookup import lookup_groups, lookup_groups_via_flow, search_cached_groups


group_cache_bp = Blueprint('group_cache', __name__)


def _ensure_db():
    try:
        init_db()
    except Exception:
        # Do not fail import time if DB init has issues; operations will error later if needed
        pass


@group_cache_bp.post('/api/reference/groups/cache')
def cache_groups():
    """Accepts an external payload and upserts groups into the reference table.

    Expected payload shape:
    {
      "success": true,
      "count": 2,
      "data": [ {"id": "...", "name": "..."} ]
    }
    """

    _ensure_db()
    payload = request.get_json(silent=True) or {}
    items = payload.get('data') or []

    if not isinstance(items, list):
        return jsonify({'success': False, 'error': 'Invalid payload: "data" must be a list'}), 400

    created = 0
    updated = 0

    session = SessionLocal()
    try:
        for item in items:
            if not isinstance(item, dict):
                continue

            gid = str(item.get('id') or '').strip()
            if not gid:
                # Skip items without an id
                continue

            name = (item.get('name') or '').strip()

            existing = session.get(Group, gid)
            if existing:
                # Update name only if changed and provided
                if name and existing.name != name:
                    existing.name = name
                    updated += 1
            else:
                session.add(Group(id=gid, name=name or gid))
                created += 1

        session.commit()
        total = created + updated
        return jsonify({'success': True, 'created': created, 'updated': updated, 'total': total})
    finally:
        session.close()


# Optional simple search endpoint
@group_cache_bp.get('/api/reference/groups/search')
def search_groups():
    """Case-insensitive search on group name; returns top 20 matches.

    Query param: q
    Response: [{"id": "...", "name": "..."}]
    """

    _ensure_db()
    q = (request.args.get('q') or '').strip()
    if not q:
        return jsonify([])
    return jsonify(search_cached_groups(q))


@group_cache_bp.get('/api/reference/groups/lookup')
def lookup_groups_api():
    """Cache-first group lookup with optional Power Automate fallback."""

    q = (request.args.get('q') or '').strip()
    if not q:
        return jsonify({'success': True, 'source': 'cache', 'cacheHit': False, 'items': []})

    try:
        result = lookup_groups(q)
    except Exception as exc:
        return jsonify({'success': False, 'error': str(exc)}), 502

    return jsonify({'success': True, **result})


@group_cache_bp.get('/api/reference/groups/lookup-flow')
def lookup_groups_flow_api():
    """Flow-only group lookup that bypasses the cache and always calls Power Automate."""

    q = (request.args.get('q') or '').strip()
    if not q:
        return jsonify({'success': True, 'source': 'flow', 'cacheHit': False, 'items': []})

    try:
        result = lookup_groups_via_flow(q)
    except Exception as exc:
        return jsonify({'success': False, 'error': str(exc)}), 502

    return jsonify({'success': True, **result})
