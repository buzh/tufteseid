// Token-injecting sidecar for Norge i bilder (NiB) ortofoto.
//
// Why this exists: NiB's WMS at services.norgeibilder.no requires an
// access token even for the imagery norgeibilder.no shows to anonymous
// visitors. That token is minted *anonymously* by the site's public
// OAuth client — no user login — with only a Referer header, and it is
// bound to the requesting IP + referer. So a browser on a self-host
// origin cannot mint one that works for it, but a server can: this
// sidecar mints the token (Referer: https://norgeibilder.no/) and
// fetches tiles from the same IP with the same Referer, satisfying both
// bindings.
//
// Placement in the stack:
//   browser → Caddy /wms/nib/* → wmscache (nginx, caches) → THIS → NiB
//
// The token is injected here, in the request to NiB, not in the URL the
// browser or nginx sees — so nginx cache keys stay stable as the token
// rotates, and the token never reaches the client.
//
// Zero dependencies: Node 24 has global fetch and Buffer.base64url.

import http from 'node:http';
import { Readable } from 'node:stream';

const PORT = Number(process.env.PORT || 8080);
const TOKEN_URL =
  process.env.NIB_TOKEN_URL ||
  'https://backend-api.klienter-prod-k8s2.norgeibilder.no/token/nib';
const REFERER = process.env.NIB_REFERER || 'https://norgeibilder.no/';
// Base is the NiB WMS namespace, not the bare host: by the time a request
// reaches this sidecar the chain of prefix rewrites (Caddy /wms/nib/* →
// nginx /nib-wms/) has stripped everything down to the service name, e.g.
// /ortofoto. Prepending /wms here rebuilds services.norgeibilder.no/wms/
// ortofoto — and generalizes to /prosjekter, /mosaikk the same way.
const UPSTREAM = (
  process.env.NIB_UPSTREAM || 'https://services.norgeibilder.no/wms'
).replace(/\/$/, '');

// Second namespace: NiB's ArcGIS REST services, behind the same token.
// Needed because per-project ortofoto is not reachable over WMS at all —
// /wms/ortofoto publishes only the single seamless `ortofoto` mosaic, and
// /wms/ortofoto_prosjekter 403s (that service has no WMS endpoint). One
// acquisition is selected instead through the ImageServer's mosaic rule:
//   ortofoto_prosjekter/ImageServer/exportImage
//     ?mosaicRule={"mosaicMethod":"esriMosaicNone","where":"prosjektnavn='…'"}
// and the list of acquisitions covering an area comes from
//   prosjekter/MapServer/4/query  (layer 4 = "Prosjektomriss prosessert").
// Both live under /arcgis/rest/services, both need the token, neither is
// a WMS — hence a base of its own rather than widening UPSTREAM.
const REST_UPSTREAM = (
  process.env.NIB_REST_UPSTREAM ||
  'https://services.norgeibilder.no/arcgis/rest/services'
).replace(/\/$/, '');
// wmscache hands REST requests over under this marker (see the
// /nib-arcgis/ location in nginx/wms-cache.conf). It is what disambiguates
// the two namespaces: after the prefix rewrites a WMS request is a bare
// service name like /ortofoto, which is otherwise indistinguishable from
// the head of a REST path.
const REST_PREFIX = '/arcgis/';

// The mint endpoint returns {"token":"..."} with no expiry field, so the
// common path is this fallback TTL. If the token is a JWT we honour its
// own exp instead (see decodeJwtExp).
const FALLBACK_TTL_MS = 20 * 60 * 1000;
// Re-mint this far ahead of expiry so a token can't lapse mid-render.
const REFRESH_SKEW_MS = 60 * 1000;

// ArcGIS token services answer an auth failure with HTTP 200 + a JSON
// error body as often as with a real 4xx, so we treat both as "re-mint
// and retry once".
const AUTH_STATUS = new Set([401, 403, 498, 499]);

let tokenState = null; // { token, expiresAt }
let minting = null; // in-flight mint, so concurrent misses share one fetch

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

// Pick the namespace from the path. Keeping the leading slash of the
// remainder (slice to the prefix's trailing slash) means REST_UPSTREAM
// stays a clean base with no trailing slash, like UPSTREAM.
function upstreamUrl(pathWithQuery) {
  if (pathWithQuery.startsWith(REST_PREFIX)) {
    return REST_UPSTREAM + pathWithQuery.slice(REST_PREFIX.length - 1);
  }
  return UPSTREAM + pathWithQuery;
}

function proxyOnce(pathWithQuery, token) {
  return fetch(upstreamUrl(pathWithQuery), {
    method: 'GET',
    headers: {
      Referer: REFERER,
      // NiB accepts the token either as ?token= or as this header; the
      // header keeps it out of the (nginx-cached, browser-visible) URL.
      'X-Esri-Authorization': `Bearer ${token}`,
      Accept: 'image/png,image/jpeg,application/json,*/*',
      // Ask NiB for uncompressed bytes so Content-Length is accurate for
      // nginx's cache (it keys caching off body length).
      'Accept-Encoding': 'identity',
    },
  });
}

function isAuthErrorJson(text) {
  try {
    // Any ArcGIS { error: {...} } envelope. Capping retries at one means
    // a non-auth error at worst costs a single extra request.
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

function relayBuffered(upstream, contentType, text, res) {
  const buf = Buffer.from(text, 'utf8');
  res.writeHead(upstream.status, {
    'Content-Type': contentType || 'application/octet-stream',
    'Content-Length': String(buf.length),
  });
  res.end(buf);
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

    const pathWithQuery = req.url; // e.g. /wms/ortofoto?SERVICE=WMS&...
    let upstream = await proxyOnce(pathWithQuery, await getToken(false));
    let ct = upstream.headers.get('content-type') || '';

    // A successful GetMap is an image — stream it straight through.
    if (ct.startsWith('image/')) {
      relayStream(upstream, res);
      return;
    }

    // Non-image: small enough to buffer and inspect. It's either an auth
    // error (re-mint + retry once) or a legitimate non-image response
    // (GetCapabilities XML, GetFeatureInfo JSON) — pass those through.
    let text = await upstream.text();
    if (authFailed(upstream, ct, text)) {
      upstream = await proxyOnce(pathWithQuery, await getToken(true));
      ct = upstream.headers.get('content-type') || '';
      if (ct.startsWith('image/')) {
        relayStream(upstream, res);
        return;
      }
      text = await upstream.text();
      if (authFailed(upstream, ct, text)) {
        // Persistent failure: 502 so nginx won't cache it as a tile and
        // won't stamp a week of browser freshness on it.
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('nib upstream auth failed');
        return;
      }
    }
    relayBuffered(upstream, ct, text, res);
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`nib proxy error: ${err?.message ?? err}`);
  }
});

server.listen(PORT, () => {
  console.log(`nib-proxy listening on :${PORT} → ${UPSTREAM}`);
});
