#!/usr/bin/env python3
"""Lightweight webhook listener for Gitea push events."""
import http.server
import subprocess
import json
import threading

PORT = 9876

class WebhookHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)

        try:
            payload = json.loads(body)
            ref = payload.get("ref", "")
            repo = payload.get("repository", {}).get("full_name", "unknown")
            pusher = payload.get("pusher", {}).get("login", "unknown")
            commits = len(payload.get("commits", []))

            print(f"Push to {repo} by {pusher} ({commits} commits, ref: {ref})")

            if ref in ("refs/heads/master", "refs/heads/main"):
                print("Triggering deploy...")
                threading.Thread(target=run_deploy, daemon=True).start()
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps({"status": "deploying"}).encode())
            else:
                print(f"Skipping deploy for ref: {ref}")
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps({"status": "skipped"}).encode())
        except Exception as e:
            print(f"Error: {e}")
            self.send_response(500)
            self.end_headers()
            self.wfile.write(str(e).encode())

    def log_message(self, format, *args):
        pass

def run_deploy():
    try:
        result = subprocess.run(
            ["/opt/stacks/plank/deploy.sh"],
            capture_output=True, text=True, timeout=300
        )
        print(result.stdout)
        if result.returncode != 0:
            print(f"Deploy failed: {result.stderr}")
    except Exception as e:
        print(f"Deploy error: {e}")

if __name__ == "__main__":
    server = http.server.HTTPServer(("0.0.0.0", PORT), WebhookHandler)
    print(f"Webhook listener on port {PORT}")
    server.serve_forever()
