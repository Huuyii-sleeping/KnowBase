"""Loopback HTTP adapter. One inference at a time, no inference queue."""

import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .contract import MAX_BYTES, MODEL_ID, serialize_scores, validate_request


class RerankServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, model):
        self.model = model
        self.inference = threading.Lock()
        self.connections = threading.BoundedSemaphore(16)
        super().__init__(address, Handler)

    def process_request(self, request, address):
        if not self.connections.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except Exception:
            self.connections.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.connections.release()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, *_):
        # Requests contain private knowledge; do not emit query text or bodies.
        pass

    def respond(self, code, value):
        body = json.dumps(value, allow_nan=False).encode()
        try:
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, socket.timeout):
            pass

    def do_GET(self):
        if self.path != "/health":
            self.respond(404, {"error": "not found"})
            return
        self.respond(200, {"ready": True, "model": MODEL_ID})

    def do_POST(self):
        if self.path != "/rerank":
            self.respond(404, {"error": "not found"})
            return
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            self.respond(415, {"error": "expected application/json"})
            return
        try:
            if self.headers.get("Transfer-Encoding"):
                raise ValueError("transfer encoding unsupported")
            length = int(self.headers.get("Content-Length", "0"))
            if not 1 <= length <= MAX_BYTES:
                self.respond(413, {"error": "invalid body size"})
                return
            data = self.rfile.read(length)
            if len(data) != length:
                raise ValueError("incomplete body")
            request_id, query, candidates = validate_request(json.loads(data))
        except (ValueError, TypeError, UnicodeError, socket.timeout):
            self.respond(400, {"error": "invalid request"})
            return
        if not self.server.inference.acquire(blocking=False):
            self.respond(503, {"error": "model busy"})
            return
        try:
            result = self.server.model.score(query, candidates)
            self.respond(200, serialize_scores(request_id, candidates, result))
        except Exception:
            self.respond(503, {"error": "model failed"})
        finally:
            self.server.inference.release()
