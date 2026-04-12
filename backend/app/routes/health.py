from flask import Blueprint, current_app, jsonify

from ..services.system import build_health_payload

health_bp = Blueprint('health', __name__)


@health_bp.get('/health')
@health_bp.get('/api/health')
def health():
    return jsonify(build_health_payload(current_app.config['APP_NAME']))

@health_bp.get('/api/hot-reload-test')
def hot_reload_test():
    # Simple endpoint to verify backend hot-reload during development
    return jsonify({"message": "Hello from backend v3"})