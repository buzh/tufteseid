"""The render sidecar: one worker, one route per producer.

A job names an evidence row and nothing else. The row is read and claimed with
the caller's own token, so PocketBase decides who may start a render and the
parameters and the ground come out of the record rather than out of the request
— a job's cost is bounded by what is stored, not by what was posted. The legend
is worded by the request and filled from the record, for the same reason: what a
burnt-in band asserts has to be true of the row it is burnt into.

Progress goes back into the row's `meta.job`, which the app is already
subscribed to, so a render survives a reload or a closed tab. The marker is
beaten for as long as the job is alive, so one nobody has refreshed means nobody
is working on the row.
"""

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
    """Whether this token may start a render at all, answering who is asking.
    PocketBase settles both: the row it hands back is the token's own, so
    `features` is the gate and the id is a fairness bucket nobody can pick.

    An administrator holds every feature. That is the one rule this side states
    rather than reads, and it is here so that a `features` entry nobody
    remembered to grant cannot lock an installation out of its own renders."""
    try:
        record = pb.whoami(token).get("record") or {}
    except pb.PbError as e:
        raise Refused(401 if e.status in (401, 403, 404) else 502, e.detail) from e

    features = record.get("features")
    held = isinstance(features, list) and RENDER_FEATURE in features
    if not held and record.get("role") != "admin":
        raise Refused(403, "renders are not part of this membership")

    return str(record.get("id") or "")


def _strings(value, count, chars):
    if not isinstance(value, list):
        return []
    return [v[:chars] for v in value[:count] if isinstance(v, str) and v]


def share_link(spot):
    """The short link to the spot, composed here rather than accepted: a forged
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
    """What the band will say. The client words it, because which facts a
    visualization answered to is its rule and belongs in one place — but the
    band ends up in pixels no one can edit, so everything it asserts about the
    record comes from the record: the author's name replaces `CREDIT_TOKEN` and
    the link is composed above. A `link` in the body is ignored.

    `title`, `facts` and the two format fields stay the client's: they describe
    the parameters it already stored and are bounded, not trusted."""
    raw = body.get("legend")
    if not isinstance(raw, dict):
        raw = {}
    credit = spot.get("credit")
    credit = credit.strip() if isinstance(credit, str) else ""
    return {
        "title": str(raw.get("title") or "")[:200],
        "facts": _strings(raw.get("facts"), 12, 200),
        "rights": [
            line.replace(legend.CREDIT_TOKEN, credit)[:MAX_RIGHTS_CHARS]
            for line in _strings(raw.get("rights"), 6, MAX_RIGHTS_CHARS)
        ],
        "link": share_link(spot),
        "resolutionFormat": str(raw.get("resolutionFormat") or "")[:80],
        "decimal": str(raw.get("decimal") or ".")[:1],
    }


def spot_of(record):
    spot = (record.get("expand") or {}).get("spot")
    if not isinstance(spot, dict):
        raise Refused(422, "the row names no spot")
    return spot


def bbox_of(spot):
    footprint = spot.get("footprint")
    if not (isinstance(footprint, list) and len(footprint) == 4):
        raise Refused(422, "the spot has no footprint")
    try:
        bbox = dem.to_metric([float(v) for v in footprint])
    except (TypeError, ValueError) as e:
        raise Refused(422, "the footprint is not four numbers") from e
    side = max(bbox[2] - bbox[0], bbox[3] - bbox[1])
    if not 1 < side <= MAX_SIDE_M:
        raise Refused(422, f"the footprint is {side:.0f} m on a side")
    return [round(v, 3) for v in bbox]


def accept(producer, token, body):
    record_id = body.get("evidence")
    if not isinstance(record_id, str) or not record_id:
        raise Refused(400, "no evidence id")

    caller = admit(token)

    try:
        record = pb.get_evidence(record_id, token)
    except pb.PbError as e:
        raise Refused(404 if e.status == 404 else 502, e.detail) from e

    if record.get("kind") != producer.KIND:
        raise Refused(422, f"the row is not a {producer.KIND}")
    meta = record.get("meta")
    try:
        spec = producer.spec_of(meta)
    except ValueError as e:
        raise Refused(422, str(e)) from e
    spot = spot_of(record)
    bbox = bbox_of(spot)
    meta = {k: v for k, v in meta.items() if k != "job"}

    with lock:
        if record_id in pending:
            raise Refused(409, "already queued")
        if sum(1 for p in pending.values() if p["caller"] == caller) >= PER_CALLER_MAX:
            raise Refused(429, "one render at a time")
        if len(pending) >= QUEUE_MAX:
            raise Refused(429, "the queue is full")
        pending[record_id] = {"caller": caller, "token": token, "meta": meta}

    queued = False
    try:
        try:
            pb.claim(
                record_id, token, {**meta, "job": {"state": "queued", "at": now()}}
            )
        except pb.PbError as e:
            raise Refused(403 if e.status in (401, 403, 404) else 502, e.detail) from e
        content = legend_of(body, spot) if producer.WANTS_LEGEND else None
        jobs.put((producer, record_id, token, spec, bbox, meta, content))
        queued = True
    finally:
        if not queued:
            with lock:
                pending.pop(record_id, None)

    log.info(
        "queued %s (%s, %s m)", record_id, producer.KIND, round(bbox[2] - bbox[0])
    )
    return {"state": "queued", "pending": len(pending)}


class Heartbeat:
    """Rewrites `job.at` on every pending row while a job runs, each with the
    token its own caller handed over. Independent of the render, because the
    stretches with nothing to report are the ones that matter: `fetch_grid` can
    hold five 180 s attempts and the encode ladder three 900 s ones, and neither
    says a word meanwhile.

    It beats the queue as well as the running row. Nothing is queued unless
    something is running — the worker takes the next job the moment it is free —
    so one beat per job covers every marker the sidecar has written.

    The worker is the only other writer of these markers, and its own writes are
    all outside `start`/`stop`.
    """

    def __init__(self, record_id):
        self.record_id = record_id
        self.done = threading.Event()
        self.thread = threading.Thread(target=self._run, daemon=True)

    def start(self):
        self.thread.start()

    def stop(self):
        self.done.set()
        self.thread.join()

    def _run(self):
        while not self.done.wait(BEAT_S):
            with lock:
                rows = [(k, v["token"], v["meta"]) for k, v in pending.items()]
            for record_id, token, meta in rows:
                if self.done.is_set():
                    return
                state = "running" if record_id == self.record_id else "queued"
                try:
                    pb.claim(
                        record_id, token, {**meta, "job": {"state": state, "at": now()}}
                    )
                except Exception as e:
                    log.info("%s heartbeat failed: %s", record_id, e)


def run_job(producer, record_id, token, spec, bbox, meta, legend_content):
    def trace(message):
        log.info("%s %s", record_id, message)

    pb.claim(record_id, token, {**meta, "job": {"state": "running", "at": now()}})
    beat = Heartbeat(record_id)
    beat.start()
    try:
        produced = producer.render(spec, bbox, legend_content, trace)
    finally:
        beat.stop()
    if produced is None:
        pb.claim(record_id, token, {**meta, "job": {"state": "empty", "at": now()}})
        trace("no coverage")
        return
    blob, filename, content_type, achieved = produced
    pb.attach(record_id, token, filename, content_type, blob, {**meta, **achieved})
    trace(f"attached {filename} ({len(blob) / 1e6:.1f} MB)")


def worker():
    while True:
        producer, record_id, token, spec, bbox, meta, legend_content = jobs.get()
        try:
            run_job(producer, record_id, token, spec, bbox, meta, legend_content)
        except Exception as e:
            log.warning("%s failed: %s", record_id, e)
            try:
                pb.claim(
                    record_id,
                    token,
                    {
                        **meta,
                        "job": {
                            "state": "failed",
                            "at": now(),
                            "detail": str(e)[:MAX_DETAIL_CHARS],
                        },
                    },
                )
            except Exception as write_failed:
                log.warning("%s could not record the failure: %s", record_id, write_failed)
        finally:
            with lock:
                pending.pop(record_id, None)
            jobs.task_done()


worker_thread = threading.Thread(target=worker, daemon=True)


class Handler(BaseHTTPRequestHandler):
    server_version = "rendersvc"
    sys_version = ""
    timeout = REQUEST_TIMEOUT_S

    def log_message(self, fmt, *args):
        log.info("%s %s", self.address_string(), fmt % args)

    def reply(self, status, payload):
        body = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self, length):
        """The body under one deadline, or `None`. `read1` and not `read`: the
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
