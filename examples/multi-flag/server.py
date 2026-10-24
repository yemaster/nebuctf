"""Platform integration example: each endpoint deliberately returns a different flag."""
import os
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        values = {
            '/health': 'ok',
            '/entry': os.environ['ENTRY_FLAG'],
            '/root': os.environ['ROOT_FLAG'],
        }
        value = values.get(self.path)
        self.send_response(200 if value is not None else 404)
        self.end_headers()
        self.wfile.write((value or 'not found').encode())

    def log_message(self, *_):
        pass


HTTPServer(('0.0.0.0', 8080), Handler).serve_forever()
