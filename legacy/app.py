from flask import Flask, render_template, send_file, abort, request, redirect, url_for, session
import os
import shutil
import mimetypes
from datetime import datetime
from functools import wraps

app = Flask(__name__)
app.secret_key = os.getenv("FILEPILOT_SECRET", os.urandom(24).hex())
BASE_DIR = os.path.abspath("shared")
PASSWORD = os.getenv("FILEPILOT_PASSWORD")
LANGUAGES = {'en': 'English', 'ar': 'العربية'}

FILE_ICONS = {
    '.pdf': '📕', '.jpg': '🖼️', '.jpeg': '🖼️', '.png': '🖼️',
    '.gif': '🖼️', '.svg': '🖼️', '.zip': '📦', '.tar': '📦',
    '.gz': '📦', '.py': '🐍', '.js': '📜', '.html': '🌐',
    '.css': '🎨', '.txt': '📄', '.md': '📝',
}

def get_file_icon(filename):
    ext = os.path.splitext(filename)[1].lower()
    return FILE_ICONS.get(ext, '📄')

def safe_join(base, *paths):
    final_path = os.path.abspath(os.path.join(base, *paths))
    if not final_path.startswith(base):
        abort(403)
    return final_path

def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if PASSWORD and not session.get("auth"):
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return decorated

@app.route("/", methods=["GET", "POST"])
def index():
    if request.method == "POST":
        lang = request.form.get("lang", "en")
        session["lang"] = lang
        return redirect(url_for("browse"))
    return render_template("language.html", languages=LANGUAGES)

@app.route("/login", methods=["GET", "POST"])
def login():
    if not PASSWORD:
        return redirect(url_for("browse"))
    lang = session.get("lang", "en")
    if request.method == "POST":
        if request.form.get("password") == PASSWORD:
            session["auth"] = True
            return redirect(url_for("browse"))
        return render_template("login.html", error=True, lang=lang)
    return render_template("login.html", error=False, lang=lang)

@app.route("/index", defaults={'subpath': ''})
@app.route("/index/<path:subpath>")
@require_auth
def browse(subpath=''):
    lang = session.get("lang", "en")
    search_query = request.args.get("search", "").lower()
    full_path = safe_join(BASE_DIR, subpath)

    if not os.path.exists(full_path):
        abort(404)

    items = os.listdir(full_path)
    if search_query:
        items = [item for item in items if search_query in item.lower()]

    items.sort(key=lambda x: (not os.path.isdir(os.path.join(full_path, x)), x.lower()))

    contents = []
    for item in items:
        item_path = os.path.join(full_path, item)
        rel_path = os.path.join(subpath, item) if subpath else item
        is_dir = os.path.isdir(item_path)
        contents.append({
            "name": item,
            "is_dir": is_dir,
            "size": os.path.getsize(item_path) if os.path.isfile(item_path) else None,
            "modified": datetime.fromtimestamp(os.path.getmtime(item_path)).strftime('%Y-%m-%d %H:%M'),
            "type": mimetypes.guess_type(item)[0] or "unknown",
            "icon": "📁" if is_dir else get_file_icon(item),
            "zip_url": url_for("download_zip", subpath=rel_path) if is_dir else None,
            "download_url": url_for("download", subpath=rel_path)
        })

    return render_template("index.html", contents=contents, current=subpath, lang=lang, search=request.args.get("search", ""))

@app.route("/download/<path:subpath>")
@require_auth
def download(subpath):
    full_path = safe_join(BASE_DIR, subpath)
    if not os.path.exists(full_path):
        abort(404)

    if os.path.isfile(full_path):
        return send_file(full_path, as_attachment=True)

    abort(400)

@app.route("/download/zip/<path:subpath>")
@require_auth
def download_zip(subpath):
    full_path = safe_join(BASE_DIR, subpath)
    if not os.path.isdir(full_path):
        abort(404)

    zip_name = os.path.basename(subpath.rstrip("/")) or "folder"
    zip_base = os.path.join("/tmp", zip_name)
    zip_path = f"{zip_base}.zip"

    if os.path.exists(zip_path):
        os.remove(zip_path)

    shutil.make_archive(zip_base, 'zip', full_path)

    return send_file(zip_path, as_attachment=True)

@app.route("/logout")
def logout():
    session.pop("auth", None)
    return redirect(url_for("index"))

@app.route("/view/<path:subpath>")
@require_auth
def view_file(subpath):
    full_path = safe_join(BASE_DIR, subpath)
    if not os.path.isfile(full_path):
        abort(404)

    mime_type = mimetypes.guess_type(full_path)[0] or "application/octet-stream"
    if mime_type.startswith("image") or mime_type == "application/pdf":
        return send_file(full_path)
    else:
        return redirect(url_for("download", subpath=subpath))

@app.errorhandler(404)
def not_found(e):
    lang = session.get("lang", "en")
    return render_template("error.html", code=404, lang=lang), 404

@app.errorhandler(403)
def forbidden(e):
    lang = session.get("lang", "en")
    return render_template("error.html", code=403, lang=lang), 403

@app.errorhandler(400)
def bad_request(e):
    lang = session.get("lang", "en")
    return render_template("error.html", code=400, lang=lang), 400

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
