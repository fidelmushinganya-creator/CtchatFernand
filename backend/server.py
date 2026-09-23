"""
FernandAkasinga - Messagerie privée à deux
--------------------------------------------------
Backend Flask : authentification par session, messages texte/image/audio,
stockage local (SQLite + fichiers). Voir README.md pour le déploiement
en persistant (au-delà du simple test en local / même Wi-Fi).
"""

import os
import sqlite3
import hashlib
import secrets
from datetime import datetime
from functools import wraps

from flask import (
    Flask, request, session, redirect, jsonify, send_from_directory
)

# ---------- Chemins ----------

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(BASE_DIR)
FRONTEND_DIR = os.path.join(ROOT_DIR, "frontend")
IMAGES_DIR = os.path.join(ROOT_DIR, "images")
VOCAUX_DIR = os.path.join(ROOT_DIR, "vocaux")
DB_PATH = os.path.join(ROOT_DIR, "fernandakasinga.db")

os.makedirs(IMAGES_DIR, exist_ok=True)
os.makedirs(VOCAUX_DIR, exist_ok=True)

app = Flask(__name__)

app.secret_key = os.environ.get("SECRET_KEY") or secrets.token_hex(32)

MAX_CONTENT_LENGTH = 25 * 1024 * 1024
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH


# ---------- Comptes (uniquement 2, en dur) ----------

def hash_password(password, salt=None):
    if salt is None:
        salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000)
    return f"{salt}${digest.hex()}"


def verify_password(password, stored_hash):
    try:
        salt, _ = stored_hash.split("$", 1)
    except ValueError:
        return False
    return hash_password(password, salt) == stored_hash


USERS = {
    "fernand": {
        "display_name": "Fernand",
        "password_hash": "f90a6693ed82e391fbfad5f0fd58e9dd$94a8c7d9a24616a73f92018bd7790e77ddcfc9b447bc9f560add696d98b6e70c",
    },
    "akasinga": {
        "display_name": "Akasinga",
        "password_hash": "a12fa737d659c5a9fe5a7f26c37cd17a$3e5cef9ad7d3e66511e039b8f9cd857e87e98626d00e946ce8cbef444d6ac7b4",
    },
}


def other_username(username):
    return "akasinga" if username == "fernand" else "fernand"


# ---------- Base de données ----------

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            utilisateur TEXT NOT NULL,
            type TEXT NOT NULL,
            contenu TEXT,
            fichier TEXT,
            date TEXT NOT NULL,
            lu INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    conn.commit()
    conn.close()


init_db()


# ---------- Authentification ----------

def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if "username" not in session:
            if request.path.startswith("/api/") or request.path.startswith(
                ("/images/", "/vocaux/")
            ):
                return jsonify({"error": "non authentifié"}), 401
            return redirect("/")
        return view(*args, **kwargs)
    return wrapped


@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip().lower()
    password = data.get("password") or ""

    user = USERS.get(username)
    if user and verify_password(password, user["password_hash"]):
        session.clear()
        session["username"] = username
        session.permanent = True
        return jsonify({"ok": True, "display_name": user["display_name"]})

    return jsonify({"ok": False, "error": "Identifiant ou mot de passe incorrect"}), 401


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/me")
@login_required
def me():
    username = session["username"]
    other = other_username(username)
    return jsonify(
        {
            "username": username,
            "display_name": USERS[username]["display_name"],
            "other_display_name": USERS[other]["display_name"],
        }
    )


# ---------- Pages (protégées côté serveur) ----------

@app.get("/")
def page_login():
    if "username" in session:
        return redirect("/accueil")
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.get("/accueil")
@login_required
def page_accueil():
    return send_from_directory(FRONTEND_DIR, "accueil.html")


@app.get("/messagerie")
@login_required
def page_messagerie():
    return send_from_directory(FRONTEND_DIR, "messagerie.html")


@app.get("/profil")
@login_required
def page_profil():
    return send_from_directory(FRONTEND_DIR, "profil.html")


@app.get("/parametres")
@login_required
def page_parametres():
    return send_from_directory(FRONTEND_DIR, "parametres.html")


@app.get("/style.css")
def style():
    return send_from_directory(FRONTEND_DIR, "style.css")


@app.get("/app.js")
def app_js():
    return send_from_directory(FRONTEND_DIR, "app.js")


# ---------- Messages ----------

ALLOWED_IMAGE_EXT = {"jpg", "jpeg", "png", "gif", "webp"}
ALLOWED_AUDIO_EXT = {"webm", "ogg", "mp3", "wav", "m4a", "aac"}


def extension_ok(filename, allowed):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in allowed


@app.get("/api/messages")
@login_required
def get_messages():
    username = session["username"]
    conn = get_db()
    rows = conn.execute("SELECT * FROM messages ORDER BY id ASC").fetchall()
    conn.execute(
        "UPDATE messages SET lu = 1 WHERE utilisateur != ? AND lu = 0",
        (username,),
    )
    conn.commit()
    conn.close()
    return jsonify([dict(row) for row in rows])


@app.get("/api/unread")
@login_required
def unread_count():
    username = session["username"]
    conn = get_db()
    count = conn.execute(
        "SELECT COUNT(*) AS c FROM messages WHERE utilisateur != ? AND lu = 0",
        (username,),
    ).fetchone()["c"]
    conn.close()
    return jsonify({"unread": count})


@app.post("/api/message")
@login_required
def send_text():
    username = session["username"]
    data = request.get_json(silent=True) or {}
    contenu = (data.get("contenu") or "").strip()
    if not contenu:
        return jsonify({"error": "message vide"}), 400
    if len(contenu) > 4000:
        return jsonify({"error": "message trop long"}), 400

    conn = get_db()
    conn.execute(
        "INSERT INTO messages (utilisateur, type, contenu, fichier, date, lu) "
        "VALUES (?, 'texte', ?, NULL, ?, 0)",
        (username, contenu, datetime.utcnow().isoformat()),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.post("/api/image")
@login_required
def send_image():
    username = session["username"]
    file = request.files.get("image")
    if not file or file.filename == "":
        return jsonify({"error": "aucune image reçue"}), 400
    if not extension_ok(file.filename, ALLOWED_IMAGE_EXT):
        return jsonify({"error": "format d'image non autorisé"}), 400

    ext = file.filename.rsplit(".", 1)[1].lower()
    filename = f"{secrets.token_hex(16)}.{ext}"
    file.save(os.path.join(IMAGES_DIR, filename))

    conn = get_db()
    conn.execute(
        "INSERT INTO messages (utilisateur, type, contenu, fichier, date, lu) "
        "VALUES (?, 'image', NULL, ?, ?, 0)",
        (username, filename, datetime.utcnow().isoformat()),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "fichier": filename})


@app.post("/api/vocal")
@login_required
def send_vocal():
    username = session["username"]
    file = request.files.get("vocal")
    if not file or file.filename == "":
        return jsonify({"error": "aucun vocal reçu"}), 400
    if not extension_ok(file.filename, ALLOWED_AUDIO_EXT):
        return jsonify({"error": "format audio non autorisé"}), 400

    ext = file.filename.rsplit(".", 1)[1].lower()
    filename = f"{secrets.token_hex(16)}.{ext}"
    file.save(os.path.join(VOCAUX_DIR, filename))

    conn = get_db()
    conn.execute(
        "INSERT INTO messages (utilisateur, type, contenu, fichier, date, lu) "
        "VALUES (?, 'audio', NULL, ?, ?, 0)",
        (username, filename, datetime.utcnow().isoformat()),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "fichier": filename})


@app.get("/images/<path:filename>")
@login_required
def serve_image(filename):
    return send_from_directory(IMAGES_DIR, filename)


@app.get("/vocaux/<path:filename>")
@login_required
def serve_vocal(filename):
    return send_from_directory(VOCAUX_DIR, filename)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=False)
