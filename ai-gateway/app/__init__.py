import os

from flask import Flask
from dotenv import load_dotenv

from .routes import register_routes
from .services.chat import warmup_chat_completion


def create_app():
    load_dotenv()
    app = Flask(__name__)
    app.config.from_mapping(
        APP_NAME=os.getenv('APP_NAME', 'westOS AI Gateway'),
        LITELLM_MODEL=os.getenv('LITELLM_MODEL', 'ollama/mistral'),
        LITELLM_TEMPERATURE=float(os.getenv('LITELLM_TEMPERATURE', '0.2')),
        # Increase default to avoid unintentional truncation; still overridable via env
        LITELLM_MAX_TOKENS=int(os.getenv('LITELLM_MAX_TOKENS', '1024')),
        OLLAMA_API_BASE=os.getenv('OLLAMA_API_BASE', 'http://host.docker.internal:11434'),
    )

    try:
        warmup_chat_completion(
            app.config['LITELLM_MODEL'],
            app.config['LITELLM_TEMPERATURE'],
            app.config['LITELLM_MAX_TOKENS'],
            app.config['OLLAMA_API_BASE'],
        )
    except Exception as error:
        app.logger.warning('LiteLLM warmup failed: %s', error)

    register_routes(app)

    return app
