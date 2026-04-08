from flask import Flask, request, jsonify
import requests

app = Flask(__name__)

AI_URL = "http://ai-gateway:5000/v1/chat/completions"


@app.route("/")
def health():
    return {"status": "Kitchen AI running"}


@app.route("/cook", methods=["GET"])
def cook_test():
    return {
        "usage": "POST JSON to this endpoint",
        "example": {
            "ingredients": "chicken rice onion"
        }
    }


@app.route("/cook", methods=["POST"])
def cook():

    data = request.json
    ingredients = data.get("ingredients")

    prompt = f"""
Suggest a recipe using these ingredients:

{ingredients}

Return:
Recipe name
Ingredients
Instructions
"""

    payload = {
        "model": "gpt-4.1-mini",
        "messages": [
            {"role": "user", "content": prompt}
        ]
    }

    r = requests.post(AI_URL, json=payload)

    return jsonify(r.json())


app.run(host="0.0.0.0", port=5000)
