"""The render sidecar: one endpoint, one worker, one producer.

A job names an evidence row and nothing else. The row is read and claimed with
the caller's own token, so PocketBase decides who may start a render and the
parameters and the ground come out of the record rather than out of the request
— a job's cost is bounded by what is stored, not by what was posted.

Progress goes back into the row's `meta.job`, which the app is already
subscribed to, so a render survives a reload or a closed tab.
"""

import json
import logging
import os
import queue
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import dem
import pb
import sunloop

PORT = int(os.environ.get("PORT", "8080"))

QUEUE_MAX = 8
# Per owner, in flight or waiting. A reader who wants a second loop can have it
# when the first one lands.
PER_OWNER_MAX = 1

# `MAX_SIDE_M` in `src/map/bbox.ts`, plus room for the metre or two a square
# built in EPSG:25833 gains on the way out to lon/lat and back.
MAX_SIDE_M = 505

MAX_BODY_BYTES = 64 * 1024

# `meta` is capped at 10 kB by the collection, and a failure detail is the one
# thing here that can run long.
MAX_DETAIL_CHARS = 300

log = logging.getLogger("rendersvc")

jobs = queue.Queue(maxsize=QUEUE_MAX)
# Evidence id -> owner id, for both the duplicate guard and the per-owner count.
pending = {}
lock = threading.Lock()


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Refused(Exception):
    def __init__(self, status, reason):
        super().__init__(reason)
        self.status = status
        self.reason = reason


def _number(value, low, high):
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    return float(value) if low <= value <= high else None


def spec_of(meta):
    """The stored parameters, read back rather than trusted. Mirrors `specOf`
    for the `sunloop` arm in `src/evidence/spec.ts`."""
    if not isinstance(meta, dict):
        raise Refused(422, "meta is not an object")
    model = meta.get("model")
    altitude = _number(meta.get("altitude"), 1, 89)
    z_factor = _number(meta.get("zFactor"), 0.1, 10)
    step = meta.get("stepDeg", sunloop.STEP_DEG_DEFAULT)
    fps = meta.get("fps", sunloop.FPS_DEFAULT)
    if model not in ("dtm", "dom"):
        raise Refused(422, "model is neither dtm nor dom")
    if altitude is None or z_factor is None:
        raise Refused(422, "altitude or zFactor out of range")
    # A step that does not divide the circle leaves a jump between the last
    # frame and the first, which is the one thing a loop must not have.
    if not isinstance(step, int) or step < 1 or step > 45 or 360 % step:
        raise Refused(422, "stepDeg does not divide 360")
    if not isinstance(fps, int) or not 1 <= fps <= 60:
        raise Refused(422, "fps out of range")
    return {
        "model": model,
        "altitude": altitude,
        "zFactor": z_factor,
        "stepDeg": step,
        "fps": fps,
    }


def _strings(value, count, chars):
    if not isinstance(value, list):
        return []
    return [v[:chars] for v in value[:count] if isinstance(v, str) and v]


def legend_of(body):
    """What the band will say. The client composes it, because which facts a
    visualization answered to is its rule and belongs in one place."""
    raw = body.get("legend")
    if not isinstance(raw, dict):
        return {}
    return {
        "title": str(raw.get("title") or "")[:200],
        "facts": _strings(raw.get("facts"), 12, 200),
        "rights": _strings(raw.get("rights"), 6, 300),
        "link": str(raw.get("link") or "")[:200],
        "resolutionFormat": str(raw.get("resolutionFormat") or "")[:80],
        "decimal": str(raw.get("decimal") or ".")[:1],
    }


def bbox_of(record):
    spot = (record.get("expand") or {}).get("spot")
    if not isinstance(spot, dict):
        raise Refused(422, "the row names no spot")
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


def accept(token, body):
    record_id = body.get("evidence")
    if not isinstance(record_id, str) or not record_id:
        raise Refused(400, "no evidence id")

    try:
        record = pb.get_evidence(record_id, token)
    except pb.PbError as e:
        raise Refused(404 if e.status == 404 else 502, e.detail) from e

    if record.get("kind") != "sunloop":
        raise Refused(422, "the row is not a sunloop")
    meta = record.get("meta")
    spec = spec_of(meta)
    bbox = bbox_of(record)
    owner = record.get("owner") or ""
    # A retry reads back the marker the failed attempt left. Every write below
    # is built from this, so drop it here or a successful second run lands a row
    # whose meta still says it failed.
    meta = {k: v for k, v in meta.items() if k != "job"}

    with lock:
        if record_id in pending:
            raise Refused(409, "already queued")
        if sum(1 for o in pending.values() if o == owner) >= PER_OWNER_MAX:
            raise Refused(429, "one render at a time")
        # `pending` and not `jobs.full()`: it counts the running job too, so the
        # queue can never be full when the put below happens and a request
        # thread can never block on it.
        if len(pending) >= QUEUE_MAX:
            raise Refused(429, "the queue is full")
        pending[record_id] = owner

    # Anything that goes wrong before the put has to give the slot back, or the
    # owner is refused 429 for the life of the container.
    queued = False
    try:
        try:
            # The claim is the write-permission gate: the view rule lets a guest
            # read a public spot's evidence, so reading it proved nothing.
            pb.claim(
                record_id, token, {**meta, "job": {"state": "queued", "at": now()}}
            )
        except pb.PbError as e:
            raise Refused(403 if e.status in (401, 403, 404) else 502, e.detail) from e
        jobs.put((record_id, token, spec, bbox, meta, legend_of(body)))
        queued = True
    finally:
        if not queued:
            with lock:
                pending.pop(record_id, None)

    log.info("queued %s (%s, %s m)", record_id, spec["model"], round(bbox[2] - bbox[0]))
    return {"state": "queued", "pending": len(pending)}


def run_job(record_id, token, spec, bbox, meta, legend_content):
    def trace(message):
        log.info("%s %s", record_id, message)

    pb.claim(record_id, token, {**meta, "job": {"state": "running", "at": now()}})
    produced = sunloop.render(spec, bbox, legend_content, trace)
    if produced is None:
        # No laser data over this ground: not a failure, and nothing a retry
        # would change.
        pb.claim(record_id, token, {**meta, "job": {"state": "empty", "at": now()}})
        trace("no coverage")
        return
    blob, filename, content_type, achieved = produced
    pb.attach(record_id, token, filename, content_type, blob, {**meta, **achieved})
    trace(f"attached {filename} ({len(blob) / 1e6:.1f} MB)")


def worker():
    while True:
        record_id, token, spec, bbox, meta, legend_content = jobs.get()
        try:
            run_job(record_id, token, spec, bbox, meta, legend_content)
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
            # Anything at all: an exception out of here unwinds past `while True`
            # and there is no second worker to take the next job.
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

    def log_message(self, fmt, *args):
        log.info("%s %s", self.address_string(), fmt % args)

    def reply(self, status, payload):
        body = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path != "/health":
            self.reply(404, {"error": "no such path"})
            return
        with lock:
            depth = len(pending)
        # A dead worker leaves the service answering every other request
        # normally while nothing renders, so it is what `ok` means.
        alive = worker_thread.is_alive()
        self.reply(
            200 if alive else 503,
            {"ok": alive, "pending": depth, "capacity": QUEUE_MAX},
        )

    def do_POST(self):
        if self.path != "/sunloop":
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
        try:
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError("not an object")
        except ValueError:
            self.reply(400, {"error": "body is not JSON"})
            return
        try:
            self.reply(202, accept(token, body))
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
    log.info("listening on %s, queue %s, pocketbase %s", PORT, QUEUE_MAX, pb.BASE)
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
