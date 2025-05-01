from flask import Flask, render_template, send_file, abort, request, redirect, url_for, session
import os
import shutil
import mimetypes
from datetime import datetime

app = Flask(__name__)
app.secret_key = "123456"
BASE_DIR = os.path.abspath("shared")
LANGUAGES = {'en': 'English', 'ar': 'العربية'}

def safe_join(base, *paths):
    final_path = os.path.abspath(os.path.join(base, *paths))
    if not final_path.startswith(base):
        abort(403)
    return final_path

@app.route("/", methods=["GET", "POST"])
def index():
    if request.method == "POST":
        lang = request.form.get("lang", "en")
        session["lang"] = lang
        return redirect(url_for("browse"))
    return render_template("language.html", languages=LANGUAGES)

@app.route("/index", defaults={'subpath': ''})
@app.route("/index/<path:subpath>")
def browse(subpath=''):
    lang = session.get("lang", "en")
    search_query = request.args.get("search", "").lower()
    full_path = safe_join(BASE_DIR, subpath)

    if not os.path.exists(full_path):
        abort(404)

    items = os.listdir(full_path)
    if search_query:
        items = [item for item in items if search_query in item.lower()]

    contents = []
    for item in items:
        item_path = os.path.join(full_path, item)
        rel_path = os.path.join(subpath, item) if subpath else item
        contents.append({
            "name": item,
            "is_dir": os.path.isdir(item_path),
            "size": os.path.getsize(item_path) if os.path.isfile(item_path) else None,
            "modified": datetime.fromtimestamp(os.path.getmtime(item_path)).strftime('%Y-%m-%d %H:%M'),
            "type": mimetypes.guess_type(item)[0] or "unknown",
            "zip_url": url_for("download_zip", subpath=rel_path) if os.path.isdir(item_path) else None,
            "download_url": url_for("download", subpath=rel_path)
        })

    return render_template("index.html", contents=contents, current=subpath, lang=lang)

@app.route("/download/<path:subpath>")
def download(subpath):
    full_path = safe_join(BASE_DIR, subpath)
    if not os.path.exists(full_path):
        abort(404)

    if os.path.isfile(full_path):
        return send_file(full_path, as_attachment=True)

    abort(400)

@app.route("/download/zip/<path:subpath>")
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

@app.route("/view/<path:subpath>")
def view_file(subpath):
    full_path = safe_join(BASE_DIR, subpath)
    if not os.path.isfile(full_path):
        abort(404)

    mime_type = mimetypes.guess_type(full_path)[0] or "application/octet-stream"
    if mime_type.startswith("image") or mime_type == "application/pdf":
        return send_file(full_path)
    else:
        return redirect(url_for("download", subpath=subpath))

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
