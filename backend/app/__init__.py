import os

from flask import Flask
from dotenv import load_dotenv

from .routes import register_routes


def create_app():
    load_dotenv()
    app = Flask(__name__)
    app.config.from_mapping(APP_NAME=os.getenv('APP_NAME', 'westOS API'))

    register_routes(app)

    return app
