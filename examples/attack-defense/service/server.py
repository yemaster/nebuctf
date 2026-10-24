"""Local competition example. Intentionally exposes a flag until patched."""
import hashlib
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from settings import VULNERABLE


def flag():
    path = Path('/run/nebuctf/flag')
    return path.read_text() if path.exists() else os.environ.get('FLAG', '')


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        status, body = 404, b'not found'
        if self.path == '/health':
            status, body = 200, b'ok'
        elif self.path == '/checksum':
            status, body = 200, hashlib.sha256(flag().encode()).hexdigest().encode()
        elif self.path == '/leak':
            status, body = (200, flag().encode()) if VULNERABLE else (403, b'forbidden')
        self.send_response(status)
        self.send_header('Content-Type', 'text/plain')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


ThreadingHTTPServer(('0.0.0.0', 8080), Handler).serve_forever()
