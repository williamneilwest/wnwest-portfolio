from flask import Flask, request, jsonify
from openai import OpenAI
import os

app = Flask(__name__)

# Initialize OpenAI client (ONLY place API key is used)
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))


# --------------------------------------------------
# ROOT / HEALTH
# --------------------------------------------------

@app.route("/", methods=["GET"])
def home():
    return jsonify({"status": "AI Gateway Running"})


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "healthy"})


# --------------------------------------------------
# OPENAI-COMPATIBLE ROUTES
# --------------------------------------------------

@app.route("/v1/models", methods=["GET"])
def models():
    return jsonify({
        "object": "list",
        "data": [
            {"id": "gpt-4o-mini", "object": "model"},
            {"id": "gpt-4o", "object": "model"}
        ]
    })


@app.route("/v1/chat/completions", methods=["POST"])
def chat_completions():
    try:
        data = request.get_json()

        if not data or "messages" not in data:
            return jsonify({
                "error": "Invalid request. 'messages' required."
            }), 400

        response = client.chat.completions.create(
            model=data.get("model", os.getenv("OPENAI_MODEL", "gpt-4o-mini")),
            messages=data["messages"]
        )

        return jsonify(response.model_dump())

    except Exception as e:
        return jsonify({
            "error": str(e)
        }), 500


# --------------------------------------------------
# SIMPLE WRAPPER (FOR YOUR BACKEND)
# --------------------------------------------------

@app.route("/api/chat", methods=["POST"])
def simple_chat():
    try:
        data = request.get_json()
        message = data.get("message", "")

        if not message:
            return jsonify({
                "success": False,
                "error": "No message provided"
            }), 400

        response = client.chat.completions.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            messages=[
                {"role": "user", "content": message}
            ]
        )

        return jsonify({
            "success": True,
            "response": response.choices[0].message.content
        })

    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


# --------------------------------------------------
# RUN APP
# --------------------------------------------------

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
