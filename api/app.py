import os
import json
import base64
import requests
from flask import Flask, jsonify, request
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://127.0.0.1:5500")
CORS(app, origins=FRONTEND_URL)

MASTER_PASSWORD = os.environ.get("MASTER_PASSWORD")

GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN")
GITHUB_REPO = os.environ.get("GITHUB_REPO")
FILE_PATH = os.environ.get("GITHUB_FILE_PATH")

API_URL = f"https://api.github.com/repos/{GITHUB_REPO}/contents/{FILE_PATH}"
HEADERS = {
    "Authorization": f"Bearer {GITHUB_TOKEN}",
    "Accept": "application/vnd.github+json"
}

def read_data():
    if not GITHUB_TOKEN or not GITHUB_REPO:
        return {"error": "Server configuration missing GitHub credentials"}
    
    try:
        response = requests.get(API_URL, headers=HEADERS)
        if response.status_code == 200:
            file_info = response.json()
            # GitHub stores data in base64 encoding; decode it back to JSON
            file_content = base64.b64decode(file_info["content"]).decode("utf-8")
            return json.loads(file_content)
        elif response.status_code == 404:
            return {}  # Return an empty dict if the file isn't on GitHub yet
        return {"error": f"Failed fetching data from GitHub: {response.status_code}"}
    except Exception as e:
        return {"error": str(e)}

def write_data(data):
    try:
        # Step 1: We must fetch the current file configuration to get its unique "sha" version tag
        get_res = requests.get(API_URL, headers=HEADERS)
        sha = None
        if get_res.status_code == 200:
            sha = get_res.json()["sha"]

        # Step 2: Convert the dictionary payload to text and encode it to base64
        json_string = json.dumps(data, indent=2)
        encoded_content = base64.b64encode(json_string.encode("utf-8")).decode("utf-8")

        # Step 3: Prepare the payload structure for the GitHub API commit mutation
        payload = {
            "message": "database auto-update via Flask app application dashboard",
            "content": encoded_content
        }
        if sha:
            payload["sha"] = sha  # Including the latest SHA confirms we aren't creating a write race conflict

        put_res = requests.put(API_URL, json=payload, headers=HEADERS)
        return put_res.status_code in [200, 201]
    except Exception:
        return False


@app.route("/api/data", methods=["GET"])
def get_data():
    return jsonify(read_data())


@app.route("/api/data", methods=["POST"])
def save_data():
    client_password = request.headers.get("X-Admin-Password")

    if not MASTER_PASSWORD or client_password != MASTER_PASSWORD:
        return jsonify({"error": "Unauthorized: Invalid or missing password"}), 401
        
    payload = request.get_json(silent=True)
    if payload is None:
        return jsonify({"error": "Body must be valid JSON"}), 400
        
    if write_data(payload):
        return jsonify({"status": "ok"})
    return jsonify({"error": "Failed writing dataset directly onto the GitHub storage pipeline"}), 500


@app.route("/api/login", methods=["POST"])
def login():
    payload = request.get_json(silent=True) or {}
    password = payload.get("password", "")
    if password == MASTER_PASSWORD:
        return jsonify({"status": "ok"}), 200
    return jsonify({"error": "Incorrect password"}), 401


if __name__ == "__main__":
    app.run(port=5000)