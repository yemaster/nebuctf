"""Training frontend forwarding to a network-isolated flag backend."""
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, build_opener


ROLE = os.environ.get("ROLE", "frontend")
if ROLE not in ("frontend", "backend"):
    raise ValueError("ROLE must be frontend or backend")
FLAG = os.environ["FLAG"] if ROLE == "backend" else None
if ROLE == "backend" and not FLAG:
    raise ValueError("backend requires a nonempty FLAG")
# The backend name is the platform's Docker network alias, not a host port.
UPSTREAM = "http://backend:8080"
OPENER = build_opener(ProxyHandler({}))


class Handler(BaseHTTPRequestHandler):
    def respond(self, status, payload):
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path not in ("/", "/health", "/flag"):
            self.respond(404, b"not found\n")
            return
        if ROLE == "backend":
            payload = FLAG.encode() if self.path == "/flag" else b"ok\n"
            self.respond(200, payload)
            return
        if self.path == "/":
            self.respond(200, b"Frontend: visit /flag to request the isolated backend.\n")
            return
        try:
            # Readiness checks reach the actual backend, with a bounded timeout.
            with OPENER.open(UPSTREAM + self.path, timeout=0.5) as response:
                payload = response.read()
            if self.path == "/health" and payload != b"ok\n":
                self.respond(503, b"backend not ready\n")
                return
        except (HTTPError, URLError, TimeoutError, OSError):
            self.respond(503, b"backend unavailable\n")
            return
        self.respond(200, payload)

    def log_message(self, *_):
        pass


ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
