from flask import Blueprint, jsonify, request

from ..services.chat import build_placeholder_response

chat_bp = Blueprint('chat', __name__)


@chat_bp.post('/ai/chat')
def chat():
    payload = request.get_json(silent=True) or {}
    return jsonify(build_placeholder_response(payload))
