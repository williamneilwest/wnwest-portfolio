import os
from pathlib import Path

from flask import Flask, send_from_directory
from dotenv import load_dotenv

from .routes.email_upload import email_upload_bp
from .routes import register_routes


SPA_EXCLUDED_PREFIXES = (
    '/api/',
    '/flows/',
    '/uploads',
    '/auth/',
    '/plaid/',
    '/health',
)


def _resolve_frontend_build_dir():
    configured = os.getenv('FRONTEND_BUILD_DIR', '').strip()
    candidates = []

    if configured:
        candidates.append(Path(configured))

    app_root = Path(__file__).resolve().parents[2]
    candidates.extend(
        [
            app_root / 'frontend' / 'dist',
            app_root.parent / 'frontend' / 'dist',
            Path('/app/frontend/dist'),
        ]
    )

    for candidate in candidates:
        if candidate.exists() and (candidate / 'index.html').exists():
            return candidate

    return None


def create_app():
    load_dotenv()
    frontend_build_dir = _resolve_frontend_build_dir()
    app = Flask(
        __name__,
        static_folder=str(frontend_build_dir) if frontend_build_dir else None,
        static_url_path='',
    )
    app.config.from_mapping(
        APP_NAME=os.getenv('APP_NAME', 'westOS API'),
        USE_AI_GATEWAY=os.getenv('USE_AI_GATEWAY', 'false').lower() == 'true',
        AI_GATEWAY_BASE_URL=os.getenv('AI_GATEWAY_BASE_URL', 'http://ai-gateway:5001'),
        OLLAMA_API_BASE=os.getenv('OLLAMA_API_BASE', 'http://ollama:11434'),
        OLLAMA_MODEL=os.getenv('OLLAMA_MODEL', 'llama3.2'),
        LITELLM_MODEL=os.getenv('LITELLM_MODEL', 'ollama/llama3.2'),
        AVAILABLE_AI_MODELS=os.getenv('AVAILABLE_AI_MODELS', 'llama3.2,mistral,qwen2.5-coder'),
        OPENAI_API_KEY=os.getenv('OPENAI_API_KEY', ''),
        PREVIEW_MAX_ROWS=int(os.getenv('PREVIEW_MAX_ROWS', '10')),
        FOCUSED_MAX_ROWS=int(os.getenv('FOCUSED_MAX_ROWS', '5')),
        ENABLE_CHUNKING=os.getenv('ENABLE_CHUNKING', 'true').lower() == 'true',
        FRONTEND_BUILD_DIR=str(frontend_build_dir) if frontend_build_dir else '',
    )

    register_routes(app)
    app.register_blueprint(email_upload_bp)

    if frontend_build_dir:
        @app.get('/')
        @app.get('/<path:path>')
        def serve_frontend(path='index.html'):
            request_path = f'/{path}'.rstrip('/')

            if any(request_path == prefix.rstrip('/') or request_path.startswith(prefix) for prefix in SPA_EXCLUDED_PREFIXES):
                return ('Not Found', 404)

            requested_file = frontend_build_dir / path
            if path and requested_file.exists() and requested_file.is_file():
                return send_from_directory(frontend_build_dir, path)

            return send_from_directory(frontend_build_dir, 'index.html')

    return app
