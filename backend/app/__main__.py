from __future__ import annotations

import argparse
import sys

import uvicorn

from . import __version__
from .config import Settings
from .main import create_app
from .routers.system import lan_ip
from .tls import ensure_certificates


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="filepilot", description="Local-first file sharing")
    parser.add_argument("--host", default=None, help="bind address (default 127.0.0.1)")
    parser.add_argument("--port", type=int, default=None, help="port (default 6969)")
    parser.add_argument("--lan", action="store_true", help="listen on all interfaces")
    parser.add_argument("--tls", choices=["auto", "on", "off"], default=None)
    parser.add_argument("--no-tls", action="store_true", help="serve plain HTTP")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    settings = Settings()

    port = args.port or settings.port
    host = args.host or ("0.0.0.0" if args.lan else settings.host)
    tls_mode = "off" if args.no_tls else (args.tls or settings.tls)
    settings = Settings(host=host, port=port, lan=args.lan or settings.lan, tls=tls_mode)

    cert_file = key_file = None
    if tls_mode != "off":
        try:
            cert_file, key_file = ensure_certificates(settings, [lan_ip(), socket_hostname()])
        except Exception as exc:  # pragma: no cover - depends on local crypto
            if tls_mode == "on":
                print(f"Could not create TLS certificates: {exc}", file=sys.stderr)
                return 1
            print("TLS unavailable, continuing over HTTP.", file=sys.stderr)

    scheme = "https" if cert_file else "http"
    lan = lan_ip()
    print(f"\n  FilePilot {__version__}")
    print(f"  Local:  {scheme}://127.0.0.1:{port}")
    if host == "0.0.0.0":
        print(f"  LAN:    {scheme}://{lan}:{port}")
        if cert_file:
            print(f"  Trust:  {scheme}://{lan}:{port}/trust")
    else:
        print("  LAN access is off. Restart with --lan to share on your network.")

    app = create_app(settings)
    try:
        uvicorn.run(
            app,
            host=host,
            port=port,
            ssl_certfile=str(cert_file) if cert_file else None,
            ssl_keyfile=str(key_file) if key_file else None,
            log_level="info",
            access_log=False,
        )
    except OSError as exc:
        print(f"Cannot listen on {host}:{port} — {exc}", file=sys.stderr)
        return 1
    return 0


def socket_hostname() -> str:
    import socket

    return socket.gethostname()


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
