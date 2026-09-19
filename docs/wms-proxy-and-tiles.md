# WMS proxying, caching and tile loading

How map requests leave the browser, how they are cached, and how few of them we
may spend. Read before touching `Caddyfile`, `nginx/`, `nib-proxy/`,
`src/map/layers/wmsTileGrid.ts`, or before adding an external map source. What
is drawn with them is `docs/map-layers.md`.

## Topology

Browser → Caddy (`tufteseid` container, `:3000`; host `3030`) → wmscache
(`nginx:1.27-alpine`, 25 GB disk cache, not exposed on the host) → upstream.
Caddy puts each upstream under a same-origin prefix and rewrites it into an
internal namespace; wmscache rewrites that into the upstream's own path and
caches the answer. `nib-proxy` (`node:24-alpine`, zero deps) is a
token-injecting sidecar for Norge i bilder, reachable only from wmscache on the
compose network — the only internal upstream, and the only one resolved at
request time (Docker DNS `127.0.0.11`), since a compose service's IP changes.

## Prefixes

| Same-origin prefix | Internal (nginx) | Upstream |
|---|---|---|
| `/wms/geonorge/wms.foo` | `/skwms1/` | `wms.geonorge.no/skwms1/wms.foo` |
| `/wfs/geonorge/wfs.foo` | `/wfs-skwms1/` | `wfs.geonorge.no/skwms1/wfs.foo` |
| `/wms/ra/kulturminner2` | `/wms/` | `kart.ra.no/wms/kulturminner2` |
| `/kms/api/v2/search/123` | `/kms-api/` | `kms-api.kulturminnesok.no/api/v2/search/123` |
| `/wms/nib/ortofoto` | `/nib-wms/` | nib-proxy → `services.norgeibilder.no/wms/ortofoto` |
| `/arcgis/nib/*` | `/nib-arcgis/` | nib-proxy → `services.norgeibilder.no/arcgis/rest/services/*` |
| `/arcgis/hoydedata/*` | `/hoydedata-arcgis/` | `hoydedata.no/arcgis/rest/services/*` |

The internal aliases differ so the namespaces cannot collide inside nginx: WFS
would want the WMS host's `/skwms1/`, and both ArcGIS upstreams `/arcgis/`.
`/pb/*` → `pocketbase:8090` is not a map route, nor is `/l/<code>`, a `redir`
to `/?lok=<code>`; `file_server` has no SPA fallback, so any other unknown path
still 404s.

`/cvat/<z>/<x>/<y>.webp` is not in the table because nothing proxies it: the
tile store is bind-mounted read-only at `/var/www/cvat`, under Caddy's root, so
`file_server` serves it with no route, no wmscache entry and no CSP host. The
404 on a tile that was never written is load-bearing — it is the coverage mask
(`docs/map-layers.md`). `/cvat/manifest.json` beside the tiles is served the
same way and fetched once per page load; `connect-src 'self'` already covers
it, and its own 404 on an install without a store reads as an empty store.

## Cache rules (wmscache)

`nginx/wms-cache.conf` holds the cache zone, the `$skip_cache` map and one
`upstream` plus one `location` per host; `nginx/wms-proxy-common.conf` holds
the host-independent half and is `include`d from each location.

| Location | `proxy_cache_valid 200` | `proxy_read_timeout` | Notes |
|---|---|---|---|
| `/skwms1/` (Kartverket WMS) | 180d | 30s (shared) | shared include |
| `/wfs-skwms1/wfs.hoyde-hoydedata-metadata-prosjekt` | 180d | 8s | LiDAR footprints |
| `/wfs-skwms1/` (rest of WFS) | not cached | 8s | register data should be fresh |
| `/wms/` (Riksantikvaren) | 180d | 30s (shared) | slowest origin in the stack |
| `/kms-api/` | 7d | 8s | a missing record is one RA reindex from existing |
| `/hoydedata-arcgis/` | 180d | 30s (shared) | DEM for a fixed bbox never changes |
| `/nib-arcgis/prosjekter/` | 7d | 15s | the acquisition catalogue *grows* |
| `/nib-arcgis/` | 180d | 30s (shared) | a completed acquisition's pixels do not |
| `/nib-wms/` | 180d | 30s (shared) | shared include |

Longest prefix wins, so the carve-outs take precedence whatever the file order.
They spell their directives out rather than `include` the common file because
nginx rejects a duplicate `proxy_cache_valid`, `proxy_read_timeout` or
`proxy_next_upstream` outright, and a config error stops the whole server.

- 25 GB LRU on `/var/cache/nginx/wms`, `inactive=180d`, `keys_zone=wms:100m`,
  shared; the key is the request URI, whose prefix keeps upstreams apart.
- Static `upstream` blocks, no `resolver` — a variable-based `proxy_pass` leaks
  HTTP 426 to the browser. NiB is the exception, for Docker DNS.
- Each host is listed three times: nginx takes the retry budget from the peer
  count and `proxy_next_upstream_tries` can only lower it, so a one-server
  group never retries, silently. `max_fails=0` on every peer, or a burst of
  502s marks all three down (`no live upstreams`, a blank viewport).
  `keepalive_timeout 20s`, under nginx's 60s default: a socket the far end
  closed first 502s in ~60 ms, and every peer draws on one pool.
- `timeout` goes in the WFS and `/kms-api/` `proxy_next_upstream` lists only.
  Those answer in ~0.25 s or hang forever; a WMS can take 5–14 s cold, where a
  read timeout means a live render and a retry queues a second for one tile.
- `$skip_cache` (a map on `$upstream_http_content_length`) refuses to store
  under 300 bytes, keeping the ~100-byte JSON error and the 238-byte rate-limit
  notice out of a 180-day entry. Do not raise the floor to exclude no-coverage
  tiles: deterministic per bbox, 0.3–6 s each at the origin, and most of a
  zoomed-out screen.
- `Accept-Encoding ""` — Kartverket's per-project WMS otherwise answers gzipped
  and chunked with no `Content-Length`, and `$skip_cache` cannot decide.
- `proxy_ignore_headers Set-Cookie Cache-Control Expires`, or session cookies
  disable caching; `proxy_cache_lock on`, one request per cold key; not
  `proxy_cache_bypass $skip_cache`, evaluated before the length exists.
- `Cache-Control` to the browser is rewritten to `$tile_cache_control`
  (`public, max-age=604800`; `no-store` on `$skip_cache`), since no upstream
  sends a usable one or a validator. Hide the upstream's own header rather than
  ignoring it — with two on the wire the browser takes the stricter — and leave
  `always` off the `add_header`, so a 502/504 carries no freshness; the rate
  limit arrives as a 200 and is caught on length instead.
- `X-Cache-Status: HIT|MISS|BYPASS` is added for debugging.

## The NiB token

- Anonymous: NiB's WMS wants a token even for imagery norgeibilder.no serves to
  anonymous visitors, and the sidecar mints one from the site's public OAuth
  client with a `Referer` header and no login. Re-minted on auth failure,
  including the HTTP-200-with-JSON-error case.
- Bound to the requesting IP and referer, so it must be minted and used in the
  same place. A token never travels between workstation and server — mint a
  fresh one wherever the call is made.
- Injected as a header (`X-Esri-Authorization: Bearer`), never in the URL, so
  cache keys stay stable as it rotates and it never reaches the browser. NiB
  also accepts `&token=`.
- Inside the sidecar, `/arcgis/` routes to the REST upstream and everything
  else to the WMS base; after the rewrites a WMS request is a bare service name
  like `/ortofoto`, so that marker is the only disambiguator.
- The sidecar also fixes NiB's Content-Type.
  `ortofoto_prosjekter/ImageServer` answers `format=jpgpng` — JPEG over
  coverage, a ~1097-byte transparent PNG outside it — labelled
  `application/octet-stream`, which an `<img>` refuses under Caddy's global
  `X-Content-Type-Options: nosniff`, so the handler sniffs magic bytes and
  re-labels ahead of wmscache. One format is not an option: `jpg` paints the
  gaps opaque black, `png32` costs eight times the bytes (68 kB vs 555 kB on a
  512 px tile over Oslo).

## Kulturminnesøk link checking

`/kms/*` is the one upstream here that is not a map source: one JSON lookup per
heritage card. Records in `kulturminner2` and `freda_bygninger` carry a
`linkkulturminnesok` to `kulturminnesok.no/ra/lokalitet/<id>`, resolving an
Askeladden id to a Kulturminnesøk uuid, and a large minority of the register is
not in that index. A miss is a 200 echoing the raw number back, and the record
API then answers 200 with an all-null shell;
`src/map/featureInfo/kulturminnesok.ts` reads a null `externalid` as the miss
and marks the link rather than hiding it. Proxied because the API sends no CORS
headers at all.

## CSP

Everything above is same-origin, so none of those hosts appears in the
Caddyfile CSP. It covers only what the browser contacts itself:

- `img-src 'self' data: blob: cache.kartverket.no` — the WMTS tiles are the
  only images not fetched same-origin.
- `connect-src 'self' data: blob: *.geonorge.no *.norgeskart.no
  cache.kartverket.no hoydedata.no` — `cache.kartverket.no` for its
  GetCapabilities `fetch()`, `*.geonorge.no` for the `ws.geonorge.no` point
  registers, `*.norgeskart.no` for the matrikkel search API, `hoydedata.no` for
  the ArcGIS identify in `src/search/searchApi.ts`.

Routing a new upstream through wmscache is never a CSP change; calling one
directly from the browser always is.

## Tile-loading constraints

Kartverket rate-limits with an HTTP 200. `wms.geonorge.no` meters GetMap by
source IP — the server's, so every visitor shares one budget — over a short
window, roughly 120 GetMaps, not a concurrency limit. Over it the reply is a
200, `application/vnd.ogc.se_xml`, 238 bytes ("Overforbruk på kort tid"), which
the browser cannot decode as a PNG, so OpenLayers marks the tile `ERROR` and
never retries it: a hole until something rebuilds the layer. nginx cannot catch
it either, since `proxy_next_upstream` sees only status codes. The one defence
is fewer requests.

- One tile queue per `Map`, shared by every layer: `maxTilesLoading: 48`
  (`src/map/atoms.ts`) against OL's default 16, capped to 8 while animating. A
  cold LiDAR WMS tile takes 3–12 s; the topo WMTS base answers in ~130 ms.
- `preload: 2` on the WMTS base and on the cached cVAT ground, `preload: 0` on
  WMS, ArcGISImage and theme layers — free on a pre-rendered base or on files
  off our own disk, ruinous on an on-the-fly renderer.
- 512 px tiles for every `TileWMS`, background and theme, from an explicit
  `TileGrid` on the View's own resolution ladder
  (`src/map/layers/wmsTileGrid.ts`), so tiles never resample. `getWMSTileGrid`
  takes an optional level range for a store holding only some levels — the
  cached ground passes z12–z15 — and still hands over the whole resolution
  array, indexed by absolute z, fenced by `minZoom` and the array's end. At 256 px a
  1600×1000 viewport is ~35 tiles per layer per level, and LiDAR project mode
  stacks two WMS layers: 70 requests a zoom step, two steps to the limiter.
  Bytes are a wash, 146 060 for one 512 px hillshade tile against 4 × ~36 800.
  It stays 512×512 on HiDPI: `TileWMS` pins its pixel ratio to 1 unless
  `serverType` is set, and none of these sources sets one.
- `WMS_TILE_CACHE_SIZE = 128`, ~10 screenfuls at 512 px, or OL has nothing to
  borrow while a new level loads; `WMS_Z_DIRECTION = 1`, the coarser of two
  bracketing levels, so the 250 ms zoom animation does not fetch a second ring.
- Every WMS and ArcGISImage background layer needs a `coverageExtent`
  (`{ extent, crs }`, transformed in `getWMSLayer` into the layer's `extent`);
  without one OL spans the whole EPSG:25833 projection extent and orders
  on-the-fly renders over the Atlantic. Values are each service's
  GetCapabilities `<BoundingBox>`:

  | Source | EPSG:25833 extent |
  |---|---|
  | LiDAR national mosaic + DOM (`LIDAR_COVERAGE_EXTENT_25833`) | `-100275, 6399725, 1150255, 8000275` |
  | `wms.topo` overlay, and `amtskart` | `-127998, 6377920, 1145510, 7976800` |
  | NiB ortofoto mosaic | `-250025, 6299985, 1211155, 8985010` |
  | one LiDAR project, one ortofoto acquisition | its own `bboxLonLat` (EPSG:4326) |

  The per-project cases must use their own box; the services advertise the
  union of everything they hold, which culls almost nothing. The transform
  samples 8 stops per edge — corners only clips the bulge a Norway-sized box
  grows when reprojected out of UTM33.
- `hidpi: false` on `TileArcGISRest`; the default scales `SIZE` and `DPI` by
  pixel ratio, quadrupling resampled pixels and doubling the cache keys.
- Ortofoto backgrounds ask for JPEG — 68 kB against 528 kB per 512 px tile over
  Oslo, and the mosaic has no transparency to lose. A single acquisition needs
  transparent gaps and uses `jpgpng`.
- Tile loading stays OpenLayers' default. A former `retryBlankTileLoadFunction`
  retried anything under 800 bytes, but the no-data PNG is deterministic, so it
  only ever refetched real no-coverage tiles at 4 origin requests each. Fix a
  blank-where-there-is-data tile at wmscache, which can see the upstream.

The compare curtain (`src/map/compare/`) is the deliberate exception: a second
full background stack out of the same queue, so a screenful costs about twice
what it normally does. Hence it is a mode you enter and leave, the B stack is
torn down on exit, and it is not persisted to the URL — a shared link must not
put every recipient into double spend on a shared budget.

## Recipe: add an external map source

1. In `Caddyfile`, a `handle_path /wms/<host-slug>/*` block that rewrites to a
   unique internal prefix and `reverse_proxy http://wmscache`.
2. In `nginx/wms-cache.conf`, an `upstream` block — the host three times,
   `max_fails=0`, `keepalive`, `keepalive_timeout 20s`.
3. A `location` for that prefix which rewrites into the upstream's own path,
   sets `proxy_pass`, `Host` and `proxy_ssl_name`, and `include`s
   `/etc/nginx/wms-proxy-common.conf` — directives spelled out instead only if
   this upstream needs a different lifetime or timeout.
4. `/wms/<host-slug>/…` as `wmsUrl` in the layer config. No CSP entry.
5. For a background layer, `coverageExtent` from its GetCapabilities.
6. The layer-config half — name union, config file, ribbon control,
   `infoFormat` — is `docs/map-layers.md`.

## Verifying

On the server; the workstation has no docker daemon and cannot reach these
paths.

```
docker compose exec wmscache nginx -T | grep 'read_timeout\|max_fails\|next_upstream'
curl -sI "http://localhost:3030/wms/geonorge/wms.hoyde-dtm-nhm-topobathy-25833?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=NHM_DTM_TOPOBATHY_25833:skyggerelieff&CRS=EPSG:25833&BBOX=200000,6500000,300000,6600000&WIDTH=512&HEIGHT=512&FORMAT=image/png" | grep -i 'x-cache\|cache-control'
docker run --rm -v tufteseid_wmscache:/c alpine du -sh /c
```

The first prints what nginx loaded rather than what the file says; the second
is MISS then HIT, both `max-age=604800`; the third is the cache on disk. After
changing either file under `nginx/`, `docker compose up -d` is not enough — the
configs are bind-mounted but read only at startup, and the container is not
recreated. Run `docker compose restart wmscache`.
