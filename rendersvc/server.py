
import json
import logging
import os
import queue
import re
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import blends
import dem
import legend
import pb
import sunloop

PORT = int(os.environ.get("PORT", "8080"))

ROUTES = {"/sunloop": sunloop, "/rvt": blends}

SHARE_HOST = re.sub(
    r"^https?://", "", os.environ.get("PUBLIC_ORIGIN", "").strip()
).rstrip("/")

SPOT_CODE = re.compile(r"[0-9A-Za-z]{1,32}")

QUEUE_MAX = 8

PER_CALLER_MAX = 1

BEAT_S = 60

MAX_SIDE_M = 505

MAX_BODY_BYTES = 64 * 1024

REQUEST_TIMEOUT_S = 10

RENDER_FEATURE = "render"

MAX_DETAIL_CHARS = 300

MAX_RIGHTS_CHARS = 300

log = logging.getLogger("rendersvc")

jobs = queue.Queue(maxsize=QUEUE_MAX)

pending = {}
lock = threading.Lock()

def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")

class Refused(Exception):
    def __init__(self, status, reason):
        super().__init__(reason)
        self.status = status
        self.reason = reason

def admit(token):
    link burnt into the frames is a phishing primitive, and nothing downstream
    can tell it from the real one. A private spot's code resolves for nobody but
    its owner, so it prints none — the same rule `legendContentFor` follows."""
    code = spot.get("code")
    if not SHARE_HOST or spot.get("visibility") != "public":
        return ""
    if not isinstance(code, str) or not SPOT_CODE.fullmatch(code):
        return ""
    return f"{SHARE_HOST}/l/{code}"

def legend_of(body, spot):
    token its own caller handed over. Independent of the render, because the
    stretches with nothing to report are the ones that matter: `fetch_grid` can
    hold five 180 s attempts and the encode ladder three 900 s ones, and neither
    says a word meanwhile.

    It beats the queue as well as the running row. Nothing is queued unless
    something is running — the worker takes the next job the moment it is free —
    so one beat per job covers every marker the sidecar has written.

    The worker is the only other writer of these markers, and its own writes are
    all outside `start`/`stop`.
        socket timeout is per recv and `read` does not come back until it has
        every byte it asked for, so a client sending one byte at a time renews
        the timeout forever and parks the thread. One raw read at a time is what
        lets the deadline be checked."""
        deadline = time.monotonic() + self.timeout
        chunks = []
        remaining = length
        try:
            while remaining:
                left = deadline - time.monotonic()
                if left <= 0:
                    return None
                self.connection.settimeout(left)
                try:
                    chunk = self.rfile.read1(remaining)
                except OSError:
                    return None
                if not chunk:
                    return None
                chunks.append(chunk)
                remaining -= len(chunk)
        finally:

            self.connection.settimeout(self.timeout)
        return b"".join(chunks)

    def do_GET(self):
        if self.path != "/health":
            self.reply(404, {"error": "no such path"})
            return
        with lock:
            depth = len(pending)

        alive = worker_thread.is_alive()
        self.reply(
            200 if alive else 503,
            {"ok": alive, "pending": depth, "capacity": QUEUE_MAX},
        )

    def do_POST(self):
        producer = ROUTES.get(self.path)
        if producer is None:
            self.reply(404, {"error": "no such path"})
            return
        token = self.headers.get("Authorization", "")
        if not token:
            self.reply(401, {"error": "sign in to render"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES:
            self.reply(400, {"error": "no body, or too much of one"})
            return
        raw = self.read_body(length)
        if raw is None:

            self.close_connection = True
            self.reply(408, {"error": "the body did not arrive"})
            return
        try:
            body = json.loads(raw)
            if not isinstance(body, dict):
                raise ValueError("not an object")
        except ValueError:
            self.reply(400, {"error": "body is not JSON"})
            return
        try:
            self.reply(202, accept(producer, token, body))
        except Refused as e:
            self.reply(e.status, {"error": e.reason})
        except Exception as e:
            log.exception("accept failed")
            self.reply(502, {"error": str(e)[:MAX_DETAIL_CHARS]})

def main():
    logging.basicConfig(
        level=logging.INFO, format="[rendersvc] %(asctime)s %(message)s"
    )
    worker_thread.start()
    log.info(
        "listening on %s, routes %s, queue %s, pocketbase %s",
        PORT,
        " ".join(sorted(ROUTES)),
        QUEUE_MAX,
        pb.BASE,
    )
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()

if __name__ == "__main__":
    main()
