from .ai import ai_bp
from .health import health_bp
from .settings import settings_bp
from .system import system_bp
from .work import work_bp


def register_routes(app):
    app.register_blueprint(ai_bp)
    app.register_blueprint(health_bp)
    app.register_blueprint(settings_bp)
    app.register_blueprint(system_bp)
    app.register_blueprint(work_bp)
