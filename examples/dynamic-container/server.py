"""Training-only flag endpoint for verifying dynamic instance isolation."""
import os
import base64
import hashlib
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def do_GET(self):
        # A deliberately small one-frame echo fixture for gateway integration checks.
        if self.path == '/ws' and self.headers.get('Upgrade', '').lower() == 'websocket':
            key = self.headers.get('Sec-WebSocket-Key', '')
            accept = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
            self.send_response(101)
            self.send_header('Upgrade', 'websocket')
            self.send_header('Connection', 'Upgrade')
            self.send_header('Sec-WebSocket-Accept', accept)
            self.end_headers()
            self.wfile.flush()
            self.connection.settimeout(5)
            head = self.rfile.read(2)
            if len(head) == 2 and head[0] == 0x81 and head[1] & 0x80 and (head[1] & 0x7f) < 126:
                size = head[1] & 0x7f
                mask, data = self.rfile.read(4), self.rfile.read(size)
                if len(mask) == 4 and len(data) == size:
                    plain = bytes(v ^ mask[n % 4] for n, v in enumerate(data))
                    self.wfile.write(bytes([0x81, size]) + plain)
                    self.wfile.flush()
            self.close_connection = True
            return
        if self.path == '/headers':
            payload = json.dumps(dict(self.headers)).encode()
        else:
            payload = (os.environ.get('FLAG', 'flag{public_container_example}') if self.path == '/flag' else 'NebuCTF example. Inspect /flag.').encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

ThreadingHTTPServer(('0.0.0.0', 8080), Handler).serve_forever()
