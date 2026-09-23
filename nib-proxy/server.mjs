// NiB's token is minted anonymously (Referer only) and bound to the requesting
// IP + referer, so it can only be minted and used server-side.

import http from 'node:http';
import { Readable } from 'node:stream';

const PORT = Number(process.env.PORT || 8080);
const TOKEN_URL =
  process.env.NIB_TOKEN_URL ||
  'https://backend-api.klienter-prod-k8s2.norgeibilder.no/token/nib';
const REFERER = process.env.NIB_REFERER || 'https://norgeibilder.no/';
// The WMS namespace, not the bare host: the prefix rewrites ahead of this
// sidecar leave a bare service name, e.g. /ortofoto.
const UPSTREAM = (
  process.env.NIB_UPSTREAM || 'https://services.norgeibilder.no/wms'
).replace(/\/$/, '');

// Per-project ortofoto has no WMS endpoint: one acquisition is selected through
// ortofoto_prosjekter/ImageServer's mosaicRule, and listed from
// prosjekter/MapServer/4. Same token, different namespace.
const REST_UPSTREAM = (
  process.env.NIB_REST_UPSTREAM ||
  'https://services.norgeibilder.no/arcgis/rest/services'
).replace(/\/$/, '');
// Set by wmscache (nginx/wms-cache.conf); a WMS path is a bare service name by
// the time it arrives, so nothing else distinguishes the two namespaces.
const REST_PREFIX = '/arcgis/';

// The mint endpoint names no expiry; a JWT `exp` overrides this when present.
const FALLBACK_TTL_MS = 20 * 60 * 1000;
const REFRESH_SKEW_MS = 60 * 1000;

// ArcGIS answers an auth failure with HTTP 200 + a JSON error body as often as
// with a 4xx; both paths re-mint.
const AUTH_STATUS = new Set([401, 403, 498, 499]);

let tokenState = null;
let minting = null;

function decodeJwtExp(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    );
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function mintToken() {
  const res = await fetch(TOKEN_URL, {
    method: 'GET',
    headers: { Referer: REFERER, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`token mint HTTP ${res.status}`);
  const body = await res.json();
  const token = body?.token;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('token mint: no token in response');
  }
  const exp = decodeJwtExp(token);
  return { token, expiresAt: exp ?? Date.now() + FALLBACK_TTL_MS };
}

async function getToken(forceRefresh) {
  const now = Date.now();
  if (
    !forceRefresh &&
    tokenState &&
    now < tokenState.expiresAt - REFRESH_SKEW_MS
  ) {
    return tokenState.token;
  }
  if (!minting) {
    minting = mintToken()
      .then((state) => {
        tokenState = state;
        return state.token;
      })
      .finally(() => {
        minting = null;
      });
  }
  return minting;
}

function upstreamUrl(pathWithQuery) {
  if (pathWithQuery.startsWith(REST_PREFIX)) {
    // -1 keeps the leading slash, so REST_UPSTREAM stays a clean base.
    return REST_UPSTREAM + pathWithQuery.slice(REST_PREFIX.length - 1);
  }
  return UPSTREAM + pathWithQuery;
}

function proxyOnce(pathWithQuery, token) {
  return fetch(upstreamUrl(pathWithQuery), {
    method: 'GET',
    headers: {
      Referer: REFERER,
      // Header rather than ?token=, to keep the token out of the cached URL.
      'X-Esri-Authorization': `Bearer ${token}`,
      Accept: 'image/png,image/jpeg,application/json,*/*',
      // Uncompressed, so Content-Length is accurate for nginx's cache.
      'Accept-Encoding': 'identity',
    },
  });
}

function isAuthErrorJson(text) {
  try {
    return typeof JSON.parse(text)?.error?.code !== 'undefined';
  } catch {
    return false;
  }
}

function copyHeaders(upstream) {
  const headers = {};
  const ct = upstream.headers.get('content-type');
  if (ct) headers['Content-Type'] = ct;
  const cl = upstream.headers.get('content-length');
  if (cl) headers['Content-Length'] = cl;
  return headers;
}

function relayStream(upstream, res) {
  if (!upstream.body) {
    res.writeHead(upstream.status, copyHeaders(upstream));
    res.end();
    return;
  }
  res.writeHead(upstream.status, copyHeaders(upstream));
  Readable.fromWeb(upstream.body).pipe(res);
}

function relayBuffer(upstream, contentType, buf, res) {
  res.writeHead(upstream.status, {
    'Content-Type': contentType || 'application/octet-stream',
    'Content-Length': String(buf.length),
  });
  res.end(buf);
}

// The ImageServer answers `format=jpgpng` as `application/octet-stream`. Caddy
// sends nosniff, so the type has to be corrected here, upstream of the cache.
const IMAGE_MAGIC = [
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
];

function sniffImageType(buf) {
  for (const { type, bytes } of IMAGE_MAGIC) {
    if (bytes.every((b, i) => buf[i] === b)) return type;
  }
  return null;
}

function authFailed(upstream, contentType, text) {
  return (
    AUTH_STATUS.has(upstream.status) ||
    (contentType.includes('json') && isAuthErrorJson(text))
  );
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }

    const pathWithQuery = req.url;

    // An auth failure re-mints the token and retries once.
    for (let attempt = 0; attempt < 2; attempt++) {
      const upstream = await proxyOnce(
        pathWithQuery,
        await getToken(attempt > 0),
      );
      const ct = upstream.headers.get('content-type') || '';

      if (ct.startsWith('image/')) {
        relayStream(upstream, res);
        return;
      }

      // Bytes rather than text(): an unnamed image has to reach sniffImageType
      // intact.
      const buf = Buffer.from(await upstream.arrayBuffer());
      const sniffed = sniffImageType(buf);
      if (sniffed) {
        relayBuffer(upstream, sniffed, buf, res);
        return;
      }

      const text = buf.toString('utf8');
      if (!authFailed(upstream, ct, text)) {
        relayBuffer(upstream, ct, buf, res);
        return;
      }
    }

    // 502 so nginx does not cache the failure as a tile.
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('nib upstream auth failed');
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`nib proxy error: ${err?.message ?? err}`);
  }
});

server.listen(PORT, () => {
  console.log(`nib-proxy listening on :${PORT} → ${UPSTREAM}`);
});
