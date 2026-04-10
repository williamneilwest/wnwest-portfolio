import os

from flask import Flask
from dotenv import load_dotenv

from .routes.email_upload import email_upload_bp
from .routes import register_routes


def create_app():
    load_dotenv()
    app = Flask(__name__)
    app.config.from_mapping(
        APP_NAME=os.getenv('APP_NAME', 'westOS API'),
        USE_AI_GATEWAY=os.getenv('USE_AI_GATEWAY', 'false').lower() == 'true',
        AI_GATEWAY_BASE_URL=os.getenv('AI_GATEWAY_BASE_URL', 'http://ai-gateway:5001'),
        OLLAMA_API_BASE=os.getenv('OLLAMA_API_BASE', 'http://ollama:11434'),
        OLLAMA_MODEL=os.getenv('OLLAMA_MODEL', 'llama3.2'),
        LITELLM_MODEL=os.getenv('LITELLM_MODEL', 'ollama/llama3.2'),
    )

    register_routes(app)
    app.register_blueprint(email_upload_bp)

    return app
