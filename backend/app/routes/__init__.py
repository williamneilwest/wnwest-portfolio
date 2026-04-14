from .ai import ai_bp
from .health import health_bp
from .settings import settings_bp
from .system import system_bp
from .reference import reference_bp
from .group_cache import group_cache_bp
from .endpoints_registry import endpoints_registry_bp
from .documents import documents_bp
from .work import work_bp
from .kb import kb_bp
from .kb_processed import kb_processed_bp
from .logs import logs_bp
from .assistant import assistant_bp
from .services import services_bp
from .data_tools import data_tools_bp
from .auth import auth_bp
from .agents import agents_bp
from .profile import profile_bp
from .flows import flows_bp
from .admin import admin_bp
from .software import software_bp


def register_routes(app):
    app.register_blueprint(ai_bp)
    app.register_blueprint(health_bp)
    app.register_blueprint(settings_bp)
    app.register_blueprint(system_bp)
    app.register_blueprint(work_bp)
    app.register_blueprint(reference_bp)
    app.register_blueprint(group_cache_bp)
    app.register_blueprint(endpoints_registry_bp)
    app.register_blueprint(documents_bp)
    app.register_blueprint(kb_bp)
    app.register_blueprint(kb_processed_bp)
    app.register_blueprint(logs_bp)
    app.register_blueprint(assistant_bp)
    app.register_blueprint(services_bp)
    app.register_blueprint(data_tools_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(agents_bp)
    app.register_blueprint(profile_bp)
    app.register_blueprint(flows_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(software_bp)
