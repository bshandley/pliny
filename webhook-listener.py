#!/usr/bin/env python3
"""Lightweight webhook listener for Gitea push events with Telegram notifications."""
import http.server
import subprocess
import json
import threading
import time
import urllib.request

PORT = 9876
TELEGRAM_BOT_TOKEN = "8144323877:AAFTY5XsK-V9h7cj5s0cH99VKyKlkX_-OPM"
TELEGRAM_CHAT_ID = "8468503088"

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
            commit_msgs = [c.get("message", "").split("\n")[0] for c in payload.get("commits", [])[:5]]

            print(f"Push to {repo} by {pusher} ({commits} commits, ref: {ref})")

            if ref in ("refs/heads/master", "refs/heads/main"):
                print("Triggering deploy...")
                ctx = {"repo": repo, "pusher": pusher, "commits": commits, "messages": commit_msgs}
                threading.Thread(target=run_deploy, args=(ctx,), daemon=True).start()
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

def send_telegram(message):
    """Send a message via Telegram Bot API."""
    try:
        data = json.dumps({
            "chat_id": TELEGRAM_CHAT_ID,
            "text": message,
            "parse_mode": "HTML"
        }).encode()
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        urllib.request.urlopen(req, timeout=10)
        print("Telegram notification sent")
    except Exception as e:
        print(f"Telegram notification failed: {e}")

def run_deploy(ctx):
    start = time.time()
    try:
        result = subprocess.run(
            ["/opt/stacks/pliny/deploy.sh"],
            capture_output=True, text=True, timeout=300
        )
        elapsed = int(time.time() - start)
        print(result.stdout)

        if result.returncode == 0:
            msgs = "\n".join(f"  • {m}" for m in ctx["messages"]) if ctx["messages"] else ""
            send_telegram(
                f"🚀 <b>Pliny deployed</b>\n"
                f"By {ctx['pusher']} · {ctx['commits']} commit(s) · {elapsed}s\n"
                f"{msgs}"
            )
        else:
            print(f"Deploy failed: {result.stderr}")
            error_tail = (result.stderr or "unknown error")[-200:]
            send_telegram(
                f"❌ <b>Pliny deploy FAILED</b>\n"
                f"By {ctx['pusher']} · {ctx['commits']} commit(s)\n"
                f"<code>{error_tail}</code>"
            )
    except Exception as e:
        print(f"Deploy error: {e}")
        send_telegram(f"❌ <b>Pliny deploy ERROR</b>\n<code>{e}</code>")

if __name__ == "__main__":
    server = http.server.HTTPServer(("0.0.0.0", PORT), WebhookHandler)
    print(f"Webhook listener on port {PORT} (with Telegram notifications)")
    server.serve_forever()
