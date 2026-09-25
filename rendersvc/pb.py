"""Every PocketBase call the service makes, each one carrying the caller's own
token. The collection rules decide what a job may read and write, so the service
holds no credentials and does not restate the permission model.
"""

import http.client
import json
import os
import urllib.error
import urllib.parse
import urllib.request
import uuid

BASE = os.environ.get("POCKETBASE_URL", "http://pocketbase:8090").rstrip("/")

READ_TIMEOUT_S = 30
# The field's ceiling is 50 MB, and the link to pocketbase is a loopback bridge,
# but the write lands behind an SQLite transaction.
WRITE_TIMEOUT_S = 300


class PbError(Exception):
    """A status worth forwarding: 404 is PocketBase's answer to both "gone" and
    "not yours", because a rule is applied before the lookup."""

    def __init__(self, status: int, detail: str = ""):
        super().__init__(f"pocketbase {status}: {detail}")
        self.status = status
        self.detail = detail


def _error_body(e):
    try:
        return e.read(2000).decode("utf-8", "replace")
    except Exception:
        return ""


def _call(method, path, token, body=None, content_type=None, timeout=READ_TIMEOUT_S):
    """Raises `PbError` and nothing else, so a caller that handles it handles
    every way the call can go wrong."""
    headers = {"Authorization": token}
    if content_type:
        headers["Content-Type"] = content_type
    request = urllib.request.Request(
        BASE + path, data=body, headers=headers, method=method
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as e:
        raise PbError(e.code, _error_body(e)) from e
    except OSError as e:
        raise PbError(502, str(e)) from e
    # A truncated or non-JSON body arrives as `http.client.IncompleteRead` or
    # `json.JSONDecodeError`, neither of which is an `OSError`.
    except (http.client.HTTPException, ValueError) as e:
        raise PbError(502, f"{type(e).__name__}: {e}") from e


def _record_path(record_id, expand=False):
    path = "/api/collections/evidence/records/" + urllib.parse.quote(record_id, "")
    return path + "?expand=spot" if expand else path


def get_evidence(record_id, token):
    """The row and the spot it belongs to. Readable does not imply writable —
    a public spot's evidence is readable with no account at all."""
    return _call("GET", _record_path(record_id, expand=True), token)


def claim(record_id, token, meta):
    """Write the job marker. This is also the write-permission gate: a caller
    who may not PATCH the row is refused here rather than after a render."""
    return _call(
        "PATCH",
        _record_path(record_id),
        token,
        json.dumps({"meta": meta}).encode(),
        "application/json",
    )


def _multipart(fields, file_field, filename, content_type, blob):
    boundary = "----tufteseid" + uuid.uuid4().hex
    marker = f"--{boundary}\r\n".encode()
    out = bytearray()
    for name, value in fields.items():
        out += marker
        out += f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode()
        out += value.encode() + b"\r\n"
    out += marker
    out += (
        f'Content-Disposition: form-data; name="{file_field}"; '
        f'filename="{filename}"\r\n'
    ).encode()
    out += f"Content-Type: {content_type}\r\n\r\n".encode()
    out += blob + b"\r\n"
    out += f"--{boundary}--\r\n".encode()
    return bytes(out), f"multipart/form-data; boundary={boundary}"


def attach(record_id, token, filename, content_type, blob, meta):
    """File and meta in one request, so a row can never hold pixels its meta
    does not describe. Mirrors `attachEvidenceFile` in `src/api/evidence.ts`."""
    body, header = _multipart(
        {"meta": json.dumps(meta)}, "file", filename, content_type, blob
    )
    return _call(
        "PATCH", _record_path(record_id), token, body, header, WRITE_TIMEOUT_S
    )
