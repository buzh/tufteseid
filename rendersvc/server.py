"""The render sidecar: one endpoint, one worker, one producer.

A job names an evidence row and nothing else. The row is read and claimed with
the caller's own token, so PocketBase decides who may start a render and the
parameters and the ground come out of the record rather than out of the request
— a job's cost is bounded by what is stored, not by what was posted.

Progress goes back into the row's `meta.job`, which the app is already
subscribed to, so a render survives a reload or a closed tab.
"""

import base64
import json
import logging
import os
import queue
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import dem
import pb
import sunloop

PORT = int(os.environ.get("PORT", "8080"))

QUEUE_MAX = 8
# Per caller, in flight or waiting. A reader who wants a second loop can have it
# when the first one lands.
PER_CALLER_MAX = 1

# `MAX_SIDE_M` in `src/map/bbox.ts`, plus room for the metre or two a square
# built in EPSG:25833 gains on the way out to lon/lat and back.
MAX_SIDE_M = 505

MAX_BODY_BYTES = 64 * 1024

# A whole request, headers and body, from a browser posting well under 64 kB of
# JSON: a second is generous and ten survives a stalled radio. `/render/*` is
# public through a Caddy `reverse_proxy`, which streams rather than buffers, so
# without this a client that announces a body and then dribbles parks a thread
# per connection until the container's 2 GB is gone.
REQUEST_TIMEOUT_S = 10

# Handed to a caller whose token carries no readable id. One bucket for all of
# them, because a bucket per unreadable token is no bucket at all.
UNKNOWN_CALLER = "?"

# `meta` is capped at 10 kB by the collection, and a failure detail is the one
# thing here that can run long.
MAX_DETAIL_CHARS = 300

log = logging.getLogger("rendersvc")

jobs = queue.Queue(maxsize=QUEUE_MAX)
# Evidence id -> the caller who asked, for both the duplicate guard and the
# per-caller count. Who asked and not whose row it is: an admin and a spot's
# author may both write somebody else's evidence, so the row's owner names
# neither the reader to hold to one at a time nor the one to refuse.
pending = {}
lock = threading.Lock()


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Refused(Exception):
    def __init__(self, status, reason):
        super().__init__(reason)
        self.status = status
        self.reason = reason


def caller_of(token):
    """The `id` claim out of the caller's PocketBase JWT, **unverified**. It is a
    fairness bucket and nothing else: `pb.claim` is still the only thing that
    decides whether this token may write the row, and a payload edited to name
    somebody else no longer verifies there. A token that cannot be read at all
    shares `UNKNOWN_CALLER` rather than escaping the count."""
    words = token.split()
    parts = words[-1].split(".") if words else []
    if len(parts) == 3:
        try:
            payload = base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4))
            claims = json.loads(payload)
        except (ValueError, TypeError):
            return UNKNOWN_CALLER
        if isinstance(claims, dict):
            claimed = claims.get("id")
            if isinstance(claimed, str) and claimed:
                return claimed[:64]
    return UNKNOWN_CALLER


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
    caller = caller_of(token)
    # A retry reads back the marker the failed attempt left. Every write below
    # is built from this, so drop it here or a successful second run lands a row
    # whose meta still says it failed.
    meta = {k: v for k, v in meta.items() if k != "job"}

    with lock:
        if record_id in pending:
            raise Refused(409, "already queued")
        if sum(1 for c in pending.values() if c == caller) >= PER_CALLER_MAX:
            raise Refused(429, "one render at a time")
        # `pending` and not `jobs.full()`: it counts the running job too, so the
        # queue can never be full when the put below happens and a request
        # thread can never block on it.
        if len(pending) >= QUEUE_MAX:
            raise Refused(429, "the queue is full")
        pending[record_id] = caller

    # Anything that goes wrong before the put has to give the slot back, or the
    # caller is refused 429 for the life of the container.
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
    # `StreamRequestHandler.setup` puts this on the connection, so it bounds the
    # request line and the headers too. HTTP/1.0 and no keep-alive — the default
    # `protocol_version` — is what makes it bound the whole connection: a
    # connection carries one request and is closed, so no thread can be held
    # open between requests.
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
            # The refusal still has to be written, and the last budget left on
            # the socket may be all but spent.
            self.connection.settimeout(self.timeout)
        return b"".join(chunks)

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
        raw = self.read_body(length)
        if raw is None:
            # Whatever the client is still dribbling is not a request, and the
            # bytes already sent are not the start of the next one.
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
