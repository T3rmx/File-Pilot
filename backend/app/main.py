from __future__ import annotations

import asyncio
import shutil
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import __version__
from .config import Settings, load_or_create_secret
from .db import Base, ensure_schema, make_engine, make_session_factory
from .deps import admin_user
from .models import User
from .routers import auth, files, public, shares, system, users
from .security import CSP, SECURITY_HEADERS, RateLimiter
from .services import cleanup_once
from .ws import ConnectionManager
from .ws import router as ws_router

REPO_ROOT = Path(__file__).resolve().parents[2]
WEB_DIST = REPO_ROOT / "web" / "dist"

TRUST_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Trust the FilePilot certificate</title>
<style>
 body{{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f6f7f8;color:#111315;margin:0;padding:32px}}
 main{{max-width:620px;margin:0 auto;background:#fff;border:1px solid #e3e5e8;border-radius:12px;padding:32px}}
 h1{{font-size:22px;margin:0 0 8px}} p{{line-height:1.6;color:#3d4348}}
 a.btn{{display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600;margin:8px 0 20px}}
 ol{{line-height:1.8}} code{{background:#f1f2f4;padding:2px 6px;border-radius:4px}}
 @media (prefers-color-scheme:dark){{body{{background:#090a0b;color:#f2f4f5}}main{{background:#141618;border-color:#2a2e33}}p{{color:#c3c9ce}}code{{background:#1b1e21}}}}
</style></head><body><main>
<h1>Trust this device's certificate</h1>
<p>FilePilot uses HTTPS with its own local certificate authority so files stay encrypted on your network. Install the certificate once on each phone or computer that scans a QR code.</p>
<a class="btn" href="/ca.crt" download="filepilot-ca.crt">Download certificate</a>
<ol>
 <li><b>Android:</b> Settings → Security → Encryption &amp; credentials → Install a certificate → CA certificate.</li>
 <li><b>iOS:</b> download the file, then Settings → Profile Downloaded → Install, and enable it under General → About → Certificate Trust Settings.</li>
 <li><b>Windows:</b> double-click the file → Install Certificate → Local Machine → Trusted Root Certification Authorities.</li>
 <li><b>Linux:</b> <code>sudo cp filepilot-ca.crt /usr/local/share/ca-certificates/ &amp;&amp; sudo update-ca-certificates</code></li>
</ol>
<p>Then reopen the share link. This page can be closed.</p>
</main></body></html>"""


async def _cleanup_loop(app: FastAPI) -> None:
    while True:
        await asyncio.sleep(600)
        try:
            await asyncio.to_thread(_cleanup_now, app)
        except Exception:  # pragma: no cover - background resilience
            pass


def _cleanup_now(app: FastAPI) -> None:
    db = app.state.session_factory()
    try:
        cleanup_once(app.state.settings, db)
        db.commit()
    finally:
        db.close()


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    settings.ensure_dirs()
    secret = load_or_create_secret(settings.data_dir)

    engine = make_engine(settings.db_path)
    Base.metadata.create_all(engine)
    ensure_schema(engine)
    session_factory = make_session_factory(engine)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        task = asyncio.create_task(_cleanup_loop(app))
        try:
            yield
        finally:
            task.cancel()
            engine.dispose()

    app = FastAPI(
        title="FilePilot",
        version=__version__,
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    app.state.settings = settings
    app.state.secret = secret
    app.state.engine = engine
    app.state.session_factory = session_factory
    app.state.limiter = RateLimiter()
    app.state.ws = ConnectionManager()
    app.state.tickets = {}

    @app.post("/api/system/reset", include_in_schema=False)
    def reset_server(request: Request, user: User = Depends(admin_user)) -> dict:
        """Wipe runtime data (db, uploads, tmp, logs, certs, secret) and drop to first-run state."""
        settings: Settings = request.app.state.settings
        engine = request.app.state.engine
        engine.dispose()
        targets = [
            settings.db_path,
            settings.data_dir / "secret.key",
            settings.data_dir / "runtime.json",
            settings.storage_dir,
            settings.tmp_dir,
            settings.logs_dir,
            settings.certs_dir,
        ]
        for path in targets:
            try:
                if path.is_dir():
                    shutil.rmtree(path, ignore_errors=True)
                elif path.exists():
                    path.unlink()
            except OSError:
                pass
        engine = make_engine(settings.db_path)
        Base.metadata.create_all(engine)
        ensure_schema(engine)
        request.app.state.engine = engine
        request.app.state.session_factory = make_session_factory(engine)
        return {"ok": True, "reset": True}

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        for key, value in SECURITY_HEADERS.items():
            response.headers.setdefault(key, value)
        if request.url.path.startswith("/api/") or response.headers.get("content-type", "").startswith("text/html"):
            response.headers.setdefault("Content-Security-Policy", CSP)
        if request.url.scheme == "https":
            response.headers.setdefault(
                "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
            )
        return response

    @app.exception_handler(StarletteHTTPException)
    async def api_errors(request: Request, exc: StarletteHTTPException):
        if request.url.path.startswith("/api/"):
            return JSONResponse(
                {"detail": exc.detail}, status_code=exc.status_code, headers=exc.headers
            )
        return JSONResponse(
            {"detail": exc.detail}, status_code=exc.status_code, headers=exc.headers
        )

    app.include_router(system.router)
    app.include_router(auth.setup_router)
    app.include_router(auth.router)
    app.include_router(users.router)
    app.include_router(files.router)
    app.include_router(shares.router)
    app.include_router(public.router)
    app.include_router(ws_router)

    @app.get("/ca.crt", include_in_schema=False)
    def ca_certificate():
        path = settings.certs_dir / "ca.crt"
        if not path.is_file():
            raise HTTPException(404, "TLS is not enabled")
        return FileResponse(path, media_type="application/x-x509-ca-cert", filename="filepilot-ca.crt")

    @app.get("/trust", include_in_schema=False)
    def trust_page() -> HTMLResponse:
        return HTMLResponse(TRUST_PAGE)

    if (WEB_DIST / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api/") or full_path == "ws":
            raise HTTPException(404, "Not found")
        if full_path:
            candidate = (WEB_DIST / full_path).resolve()
            try:
                candidate.relative_to(WEB_DIST.resolve())
            except ValueError:
                raise HTTPException(404, "Not found") from None
            if candidate.is_file():
                return FileResponse(candidate)
        index = WEB_DIST / "index.html"
        if index.is_file():
            return FileResponse(index, headers={"Cache-Control": "no-store"})
        return HTMLResponse(
            "<h1>FilePilot API is running</h1>"
            "<p>The web UI is not built yet. Run <code>cd web &amp;&amp; npm install &amp;&amp; npm run build</code>.</p>",
            status_code=200,
        )

    return app
