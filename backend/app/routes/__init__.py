from .health import health_bp
from .system import system_bp
from .work import work_bp


def register_routes(app):
    app.register_blueprint(health_bp)
    app.register_blueprint(system_bp)
    app.register_blueprint(work_bp)
