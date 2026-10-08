# Minimal IMDSv1-style metadata service for the local demo stack.
from http.server import BaseHTTPRequestHandler, HTTPServer

ROLE = "cardiolink-clinician-portal"
CREDS = {
    "Code": "Success",
    "Type": "AWS-HMAC",
    "AccessKeyId": "minioadmin",
    "SecretAccessKey": "minioadmin",
    "Token": "local-demo-session-token",
}


class H(BaseHTTPRequestHandler):
    def _send(self, body: str, code: int = 200):
        self.send_response(code)
        self.end_headers()
        self.wfile.write(body.encode())

    def do_GET(self):
        import json

        base = "/latest/meta-data/iam/security-credentials/"
        if self.path == base:
            self._send(ROLE)
        elif self.path == base + ROLE:
            self._send(json.dumps(CREDS))
        elif self.path.startswith("/latest/meta-data/"):
            self._send("ok")
        else:
            self._send("not found", 404)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 80), H).serve_forever()
