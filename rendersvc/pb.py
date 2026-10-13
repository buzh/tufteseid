
import http.client
import json
import os
import urllib.error
import urllib.parse
import urllib.request
import uuid

BASE = os.environ.get("POCKETBASE_URL", "http://pocketbase:8090").rstrip("/")

READ_TIMEOUT_S = 30

WRITE_TIMEOUT_S = 300

class PbError(Exception):
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

    except (http.client.HTTPException, ValueError) as e:
        raise PbError(502, f"{type(e).__name__}: {e}") from e

def whoami(token):
    a public spot's evidence is readable with no account at all."""
    return _call("GET", _record_path(record_id, expand=True), token)

def claim(record_id, token, meta):
    does not describe. Mirrors `attachEvidenceFile` in `src/api/evidence.ts`."""
    body, header = _multipart(
        {"meta": json.dumps(meta)}, "file", filename, content_type, blob
    )
    return _call(
        "PATCH", _record_path(record_id), token, body, header, WRITE_TIMEOUT_S
    )
