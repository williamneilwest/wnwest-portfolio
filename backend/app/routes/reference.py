from flask import Blueprint, jsonify, request

from ..models.reference import Group, SessionLocal, User, init_db


reference_bp = Blueprint('reference', __name__)


def _ensure_db():
    try:
        init_db()
    except Exception:
        # If DB init fails, handlers will still raise on use; we avoid failing import time
        pass


@reference_bp.get('/api/reference/groups')
def list_groups():
    _ensure_db()
    session = SessionLocal()
    try:
        groups = session.query(Group).all()
        return jsonify([{'id': g.id, 'name': g.name} for g in groups])
    finally:
        session.close()


@reference_bp.post('/api/reference/groups')
def upsert_groups():
    _ensure_db()
    payload = request.get_json(silent=True) or {}
    items = payload.get('groups') or []

    if not isinstance(items, list):
        return jsonify({'error': 'Invalid payload: "groups" must be a list'}), 400

    session = SessionLocal()
    try:
        for item in items:
            if not isinstance(item, dict):
                continue

            gid = str(item.get('id') or '').strip()
            name = (item.get('name') or '').strip()
            if not gid:
                continue

            existing = session.get(Group, gid)
            if existing:
                if name:
                    existing.name = name
            else:
                session.add(Group(id=gid, name=name or gid))

        session.commit()
        return jsonify({'success': True})
    finally:
        session.close()


@reference_bp.get('/api/reference/users')
def list_users():
    _ensure_db()
    session = SessionLocal()
    try:
        users = session.query(User).all()
        return jsonify([{'id': u.id, 'name': u.name, 'email': u.email} for u in users])
    finally:
        session.close()


@reference_bp.post('/api/reference/users')
def upsert_users():
    _ensure_db()
    payload = request.get_json(silent=True) or {}
    items = payload.get('users') or []

    if not isinstance(items, list):
        return jsonify({'error': 'Invalid payload: "users" must be a list'}), 400

    session = SessionLocal()
    try:
        for item in items:
            if not isinstance(item, dict):
                continue

            uid = str(item.get('id') or '').strip()
            name = (item.get('name') or '').strip() or None
            email = (item.get('email') or '').strip() or None
            if not uid:
                continue

            existing = session.get(User, uid)
            if existing:
                existing.name = name
                existing.email = email
            else:
                session.add(User(id=uid, name=name, email=email))

        session.commit()
        return jsonify({'success': True})
    finally:
        session.close()
