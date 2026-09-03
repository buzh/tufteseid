# Tufteseid — armchair archaeology on Norwegian public data

Map viewer tailored for reading Norwegian LiDAR terrain against the
Riksantikvaren heritage register (Kulturminner). Hard fork of
Kartverket's Norgeskart — not tracking upstream. Working branch:
`main`.

Not affiliated with Kartverket or Riksantikvaren; the app is
de-branded from upstream on purpose, so don't reintroduce Norgeskart
naming or Kartverket's visual identity in user-visible strings, page
titles, export filenames or assets. Attribution belongs in prose (the
"Om oss" text, README, LICENCE), not in the chrome.

Feature scope is deliberately narrow: keep what an amateur reading
relief-shaded terrain against the heritage record needs (Kulturminner
theme layers, LiDAR hillshade + per-project LiDAR backgrounds, LiDAR
tile extract, lokaliteter with their drawing and imagery,
place/property search), drop the rest. If you're tempted to re-add an
upstream Norgeskart feature, ask whether this specific use case needs
it before wiring it back in.

## Deploy

Runs as a Docker Compose stack. The user builds and runs on their host —
**do not run `npm run build` / `tsc` locally**; TypeScript errors surface in
the docker build output instead.

`README.md` is the third-party-facing install and admin guide (first-run
PocketBase setup, OAuth, TLS, backup, troubleshooting). Keep it accurate
when any of that changes; what follows here is the working detail, not a
substitute for it.

Standard rebuild on the server:

```
git pull
docker compose build --pull tufteseid
docker compose up -d
docker compose logs -f tufteseid wmscache
```

If `nginx/wms-cache.conf` or `nginx/wms-proxy-common.conf` changed, also
restart wmscache — the configs are bind-mounted, so the file on disk is
current, but nginx only reads config at startup and `docker compose up -d`
doesn't recreate wmscache (its image tag is unchanged):

```
docker compose restart wmscache
```

Symptom of forgetting this: same-origin proxy paths (e.g. `/wms/ra/...`)
return nginx's default 404 page even though the Caddyfile and layer configs
look correct.

Same class of gotcha for **pocketbase**: `pocketbase/pb_migrations/` is
bind-mounted, but PB only applies migrations at startup, and
`docker compose up -d` doesn't recreate the container (image unchanged).
After adding/changing a migration:

```
docker compose restart pocketbase
docker compose logs pocketbase   # confirm the migration applied
```

Symptom of forgetting this: API calls against the new/changed collection
404, which the SPA may surface only in the browser console (e.g. "Ny
lokalitet" appearing to do nothing).

Note on migration ordering: PocketBase applies **all** of its built-in Go
migrations during bootstrap and only then registers the JS ones from
`pb_migrations/`, whatever the timestamps say. A JS migration can
therefore never run before a core one, so anything that has to precede a
core migration has to happen out of band, against a stopped database.

Ports: Caddy inside the container listens on `:3000`; docker-compose maps host
`3030 → container 3000`.

## Services (docker-compose.yml)

- **tufteseid** — multi-stage Dockerfile: `node:24-alpine` builds the SPA,
  then `caddy:2.10.0-alpine` serves `/var/www` with the baked-in `Caddyfile`.
  `config.js` is bind-mounted at runtime.
- **pocketbase** — backend for lokaliteter (auth + user content). Small
  in-repo Dockerfile that pins a PocketBase release from GitHub. Serves the
  SPA's `/pb/*` API (auth, the `localities` / `finds` / `attachments`
  collections, file storage, realtime). SQLite state on the `pbdata`
  volume; schema versioned in `pocketbase/pb_migrations/`. First-run setup
  is in README.md. Pinned to 0.40.2 — migrations use the ≥0.23 App-based
  JSVM API (`$app.findCollectionByNameOrId` / `app.save`, flattened field
  classes), *not* the 0.22 `Dao` API.
- **wmscache** — `nginx:1.27-alpine` sidecar. Reverse-proxies + caches
  every external WMS the SPA uses. Currently fronts four upstreams:
  - `wms.geonorge.no/skwms1/*` — Kartverket theme + LiDAR WMS.
  - `wfs.geonorge.no/skwms1/*` — Kartverket WFS (kulturminner readout,
    LiDAR project footprints). Proxied but **not** cached.
  - `kart.ra.no/wms/*` — Riksantikvaren Kulturminner WMS.
  - `testapi.norgeskart.no/v1/*` — matrikkel (cadastral) WMS.

  Caddy exposes each host under a same-origin prefix and rewrites into
  the upstream namespace before forwarding:

  ```
  /wms/geonorge/wms.foo    →  wms.geonorge.no/skwms1/wms.foo
  /wfs/geonorge/wfs.foo    →  wfs.geonorge.no/skwms1/wfs.foo
  /wms/ra/kulturminner2    →  kart.ra.no/wms/kulturminner2
  /wms/testapi/matrikkel   →  testapi.norgeskart.no/v1/matrikkel
  ```

  The WFS prefix goes through a distinct internal alias
  (`/wfs-skwms1/`) so it can't collide with the WMS host's `/skwms1/`
  in nginx.

  Cache config at `nginx/wms-cache.conf` (per-upstream `location` blocks)
  + `nginx/wms-proxy-common.conf` (shared cache/timeout/header defaults).
  Cache lives on the `wmscache` docker volume with a 25 GB LRU cap. Not
  exposed on the host — only reachable from `tufteseid` over the compose
  network.

  Because everything is same-origin from the browser's POV, none of these
  hosts need to appear in the Caddyfile CSP `img-src` / `connect-src`.

## Added map content

### Kulturminner (theme layers, Riksantikvaren)

Config: `src/map/layers/config/themeLayers/culturalHeritage.ts`. Registered
in `themeLayerConfigApi.ts` (added to `configs` array) and the layer id
union in `themeWMS.ts` (`CulturalHeritageLayerName`).

Five layers under the "Kulturminner" theme category (groupid 19), one per
Riksantikvaren WMS service. URLs are same-origin (`/wms/ra/<name>`) and
routed through `wmscache` to `kart.ra.no/wms/<name>`: `kulturminner2`
(sites + monuments), `kulturmiljoer`, `sefrak`, `freda_bygninger`,
`brukerminner`.

Feature-info: the category sets `infoFormat: 'application/vnd.ogc.gml'` so
the existing `parseXmlFeatureInfo` (which handles MapServer `msGMLOutput`)
kicks in and shows structured fields. If left unset, the WMS returns HTML,
which the parser wraps as `{ _html: ... }` and the UI shows an
unhelpful "HTML-respons mottatt" placeholder.

### LiDAR hillshade (background layer, Kartverket)

Sits in the "Kart" (bottom-right) menu, not "Temakart", because the intent is
to overlay Kulturminner objects on top of the terrain relief.

- Type registered in `src/map/layers/backgroundLayers.ts` (`lidarHillshade`
  in `WMSLayerName`).
- Config: `src/map/layers/config/backgroundLayers/elevation.ts`. Registered
  in `allConfiguredBackgroundLayers` (`atoms.ts`).
- Ordering: entry in `backgroundLayerOrder` in
  `src/map/backgroundLayer/utils.ts`.
- Thumbnail: currently falls back to `topograatone.png` via a case in
  `getBackgroundLayerImageName` in `src/map/atoms.ts`. Drop a real
  `lidarHillshade.png` in `public/backgroundlayerImages/` and remove that
  case when a proper thumbnail is available.
- Translations: `lidarHillshade` added to `backgroundMaps` in
  `src/locales/{nb,nn,en}/translation.json`.

Layer URL is **not** `wms.geonorge.no` directly — the client hits
`/wms/geonorge/wms.hoyde-dtm-nhm-topobathy-25833`, which Caddy proxies to
`wmscache`, which proxies to
`https://wms.geonorge.no/skwms1/wms.hoyde-dtm-nhm-topobathy-25833` and
caches. This same-origin path avoids CORS issues seen when calling
`wms.geonorge.no` from `fetch()` on the self-host origin. Same treatment
for the per-project LiDAR at `/wms/geonorge/wms.hoyde-dtm-prosjekt` (see
`lidarProjects.ts`).

### Why the LiDAR tile loader is custom

`retryBlankTileLoadFunction` in `src/map/layers/config/backgroundLayers/loadFunctions.ts`
handles a subtle failure mode of the Kartverket DTM WMS: the on-the-fly
renderer occasionally returns a valid HTTP 200 response with a tiny (~479
byte) transparent PNG instead of the real 5–50 KB hillshade. The default
OL error retry doesn't help because there's no error to retry on.

The loader `fetch()`es each tile with `cache: 'no-store'`, checks blob
size, and if under 800 bytes retries up to 3 times with exponential
backoff. After the retry budget is spent, whatever came back is accepted
(legit no-coverage tiles — ocean, Sweden — return the same tiny response
and would loop forever otherwise).

Key CSP dependencies for this path: `img-src` must include `blob:`
(because the loader hands blob URLs to `<img>`).

### The background stack

`backgroundLayerAtomEffect` builds a stack, bottom-first, not a single
layer:

1. topo base (both LiDAR modes — the LiDAR WMS returns transparent PNGs
   outside coverage);
2. the national mosaic at `LIDAR_FALLBACK_OPACITY`, when a *per-project*
   dataset is active, so the area the project doesn't cover keeps its
   relief instead of dropping to plain topo;
3. the active dataset;
4. the topo overlay, in hybrid mode (see below).

`swapBackgroundLayers(under, over)` (`backgroundLayers/utils.ts`) then
swaps that stack in without ever showing a gap. The split matters: 1–2
go *under* the outgoing layers (they're context the fading dataset
should keep covering), 3–4 go *over* them, or the layer on its way out
would bury the one coming in.

- Outgoing layers are **not** removed up front — they're dimmed to
  `OUTGOING_OPACITY` immediately and removed on the next map
  `rendercomplete` (8 s timeout as a backstop). Tearing down first meant
  every step of a W/S or A/D cycle flashed topo while the new hillshade
  loaded; the instant dim is what makes the incoming dataset's coverage
  edge readable before its tiles are in.
- `buildOrReuseBackgroundLayer` keeps an existing layer whose signature
  (url + params + projection) matches what's being asked for, so cycling
  only rebuilds the layer that actually changed. Reused layers may still
  carry an earlier fade, so the effect sets opacity explicitly on every
  layer it passes in.

### Hybrid mode

Third mode button next to Standard and LiDAR: the same LiDAR stack with
Kartverket's roads/railways/place-names drawn transparently on top, for
working out *where* a feature is without leaving the terrain. State is
`hybridOverlayAtom` (a modifier on the background, not a background of
its own — the dataset, style and W/S + A/D cycling all keep working),
persisted as `?hybrid=true`.

Config: `backgroundLayers/topoOverlay.ts` — `/wms/geonorge/wms.topo`
with `LAYERS=kd_veger,kd_jernbane,kd_stedsnavn,fkb_samferdsel,`
`fkb_presentasjonsdata` and `TRANSPARENT=TRUE`. Asking that WMS for a
subset of its groups yields a real overlay: no terrain, no landcover,
no background fill. Both families are needed — the generalized `kd_*`
groups stop rendering around 1:25 000 and the `fkb_*` ones take over.

Deliberately **no** `retryBlankTileLoadFunction` on this layer: a blank
overlay tile is the normal case out in the woods, unlike a blank DTM
tile, and retrying each one three times buys nothing.

Notes for anyone changing this: `cache.kartverket.no`'s WMTS has no
transparent overlay layer (only the full basemaps), `wms.topo4` is dead,
and NiB needs an API token — `wms.topo` is the one that works.

### DTM vs DOM

Both the national mosaic and the per-project service exist in a terrain
(DTM, vegetation and buildings filtered out) and a surface (DOM,
everything the laser hit) flavour. `activeLidarModelAtom`
(`lidarProjects.ts`) picks between them; persisted as `?lidarModel=dom`,
absent means DTM. A `DTM | DOM` segment next to the style chip, bound to
`E`, switches it — like hybrid it's a modifier on the LiDAR background,
not a fourth mode, so the dataset picker and W/S cycling are unaffected.

The two URL pairs live in `LIDAR_PROJECT_WMS_URL` and `NATIONAL_WMS`
(`wms.hoyde-dom-prosjekt` / `wms.hoyde-dom-nhm-25833`, layer prefix
`NHM_DOM_25833`). Both go through `wmscache` like everything else.

Two things make this smaller than it looks:

- The DTM and DOM per-project catalogues are **identical** — same 1936
  project names, verified by diffing both GetCapabilities. So
  `fetchLidarProjects()` stays a single fetch and the footprint,
  relevance and picker machinery is model-independent.
- DOM publishes exactly one usable style, `skyggerelieff`, for every
  project. `DOM_STYLES` is therefore a hard-coded constant rather than
  another capabilities fetch, and `stylesForModel` / `effectiveLidarStyle`
  clamp to it.

The style clamp isn't cosmetic: asking a DOM layer for a DTM-only style
(`helning_prosent`, say) hits the same silent failure as a blank tile —
HTTP 200, `Content-Type: image/png`, a ~100-byte JSON error body that
`retryBlankTileLoadFunction` eventually accepts — i.e. a blank map with
nothing in the console. `activeLidarStyleAtom` keeps holding the user's
DTM pick while in DOM mode so it comes back on the way out, which is
also why A/D is a deliberate no-op there instead of walking a one-entry
ring over the top of it.

The LiDAR *extract* tool stays DTM-only (`lidarExtract/sources.ts`
pins `LIDAR_PROJECT_WMS_URL.dtm`): an extract is meant to be read as
terrain.

### Keyboard cycling of the LiDAR pulldowns

`TopBar.tsx` binds A/D to the style pulldown and W/S to the dataset
pulldown, top-tier entries only (i.e. not what's behind "flere
stiler"/"mindre relevante"), wrapping at both ends, plus E for the
DTM/DOM segment. None of them open a pulldown — cycling should leave
the terrain unobstructed, which also means no footprint polygons.

That splits what used to be one flag in two:
`lidarPickerOpenAtom` decides whether footprints are *drawn*, while
`lidarCyclingAtom` (armed by W/S, expires 90 s after the last press or
on leaving LiDAR mode) keeps the viewport list *fetched*. The project
ring is that list, so the first W/S press after a pause only starts the
WFS fetch — the dataset chip shows a spinner meanwhile — and the next
press walks it.

## nginx cache behavior (wmscache)

Split across two files:

- `nginx/wms-cache.conf` — shared cache zone, `$skip_cache` map, one
  `upstream` block per host, and one `location` per host with the
  per-host bits (`proxy_pass`, `Host`, `proxy_ssl_name`).
- `nginx/wms-proxy-common.conf` — everything host-independent: cache
  directives, timeouts, TLS 1.2/1.3, header scrubbing. Included from
  each `location`.

Notes on shared behavior:

- Single 25 GB LRU on `/var/cache/nginx/wms`, `inactive=180d`, shared
  across all three upstreams. The cache key is the full request URI,
  which starts with a unique per-upstream prefix (`/skwms1/`, `/wms/`,
  `/v1/`) so there's no risk of collision.
- Static upstream blocks (`server host:443; keepalive 8;`) — resolved
  once at startup, so no `resolver` directive needed. Variable-based
  `proxy_pass` previously caused HTTP 426 responses to leak back to the
  browser; the static form fixes it.
- Per-host `Host` + `proxy_ssl_name` set inline in each `location`, plus
  explicit TLS 1.2/1.3 in the common include, so the handshake with each
  upstream (Kartverket istio-envoy, RA MapServer, etc.) is unambiguous.
- Skips caching for responses under 1000 bytes (`map` on
  `$upstream_http_content_length`) so blank responses never poison the
  cache. Legit no-coverage tiles are also small and bypass the cache too —
  cheap because they're 479 bytes.
- `proxy_ignore_headers Set-Cookie Cache-Control Expires` — upstreams
  frequently set session cookies which would otherwise disable caching
  entirely.
- **Retry: repeated `server` lines, `max_fails=0`, `proxy_next_upstream`.**
  Kartverket's edge sheds load instead of queueing — under a burst of
  uncached tiles some fraction comes back 502/504, and the
  Prosjektavgrensning WFS hangs on roughly one request in five (both
  verified against the origins directly, with this proxy out of the
  picture). Nothing retried, so every shed response reached the browser
  as a hole in the map.

  The part that bites when editing this: **each host is listed three
  times in its `upstream` block on purpose.** nginx sets a request's
  retry budget from the peer count and `proxy_next_upstream_tries` can
  only lower it, so a one-server group gets exactly one attempt and
  `proxy_next_upstream` does nothing at all — no warning, no log, it
  just never fires. Collapsing those duplicates back into a single line
  silently disables every retry here. `max_fails=0` then keeps a burst
  of upstream errors from marking all three peers down at once and
  turning a hiccup into 10s of blanket 502s (`no live upstreams` in the
  error log).

  `timeout` is in the WFS location's `proxy_next_upstream` list but
  deliberately not in the shared one. The WFS either answers in ~0.25s
  or hangs forever, so cutting it at `proxy_read_timeout 8s` and
  retrying is free — measured 20/20 successes where the unretried config
  gave 8 failures in 25. The WMS renders on the fly and is bimodal:
  ~80ms from Kartverket's own cache, or 5-14s cold with a long tail. A
  read timeout there means a render still in progress, so retrying would
  abandon it and queue a second one for the same tile, multiplying load
  on an origin already slow enough to have hit the timeout.

  Worth knowing before chasing a "performance regression": cold LiDAR
  tiles are slow at the origin, not here. Measured direct against
  wms.geonorge.no with this proxy out of the path — median 0.08s but
  11 of 30 tiles over 5s. A cache HIT through wmscache serves the same
  tile in ~80ms, so the second visit to an area is fast and the first
  is at Kartverket's mercy.

  Verify what nginx actually loaded, not what the file says:
  `docker compose exec wmscache nginx -T | grep 'read_timeout\|max_fails\|next_upstream'`.
- Adds `X-Cache-Status: HIT|MISS|BYPASS` to responses for debugging.
- `proxy_cache_lock on` — one upstream request in flight per cold key.

Sanity check after a rebuild (LiDAR hillshade):

```
curl -sI "http://localhost:3030/wms/geonorge/wms.hoyde-dtm-nhm-topobathy-25833?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=NHM_DTM_TOPOBATHY_25833:skyggerelieff&CRS=EPSG:25833&BBOX=200000,6500000,300000,6600000&WIDTH=256&HEIGHT=256&FORMAT=image/png" | grep -i x-cache
```

First call: `MISS`. Repeat: `HIT`. Inspect on-disk size:
`docker run --rm -v tufteseid_wmscache:/c alpine du -sh /c`.

## Adding another theme layer

1. Create a config file in `src/map/layers/config/themeLayers/`. Export a
   `ThemeLayerConfig` with `categories[]` and `layers[]`. Category holds
   shared defaults (`wmsUrl`, `infoFormat`, `featureInfoFields`, etc.) that
   cascade to layers via `getEffectiveWmsUrl` and the fallback chain in
   `themeWMS.ts`.
2. Import + append to the `configs` array in
   `src/map/layers/themeLayerConfigApi.ts` inside `getThemeLayerConfig()`.
3. Add the layer id(s) to a union in `src/map/layers/themeWMS.ts` and
   into `ThemeLayerName`.
4. Route requests through `wmscache` instead of hitting the origin from
   the browser. Add a `handle_path /wms/<host-slug>/*` block in
   `Caddyfile` that rewrites to the upstream's WMS path prefix, plus an
   `upstream` + `location` pair in `nginx/wms-cache.conf`, and use
   `/wms/<host-slug>/...` as `wmsUrl` in the config. This gives you the
   25 GB LRU disk cache and same-origin browser requests for free (no
   CSP entry needed).
5. If the WMS's GetFeatureInfo doesn't offer JSON, set `infoFormat` on the
   category or layer to a format the parser can handle
   (`application/vnd.ogc.gml` works for MapServer via
   `parseXmlFeatureInfo`).

## Lokaliteter (user content)

The top-level user object is **an area to explore**, not a claim that
something is there — mirroring Riksantikvaren's lokalitet →
enkeltminne hierarchy. A lokalitet is an authored rectangle (created
with one box-drag, resizable afterwards) holding *funn* (individually
named and addressable drawn features) and *bilder* (kept LiDAR
extracts, map screenshots, uploads).

Consequences worth remembering before changing anything here:

- Drawing and LiDAR extract exist **only** inside a lokalitet
  workspace. The route to those tools is creating a lokalitet; there
  are no standalone `draw` / `lidarExtract` / `newFind` map tools any
  more. Measure stays global because it's ephemeral.
- The bbox is authored, never derived from content. If a drawn funn
  escapes the rectangle the workspace offers to grow it.
- All lokalitet content is behind sign-in, including `public` ones —
  the read rules require `@request.auth.id != ""`. The map itself
  stays publicly browsable.
- `limited` visibility is a placeholder that behaves as `private`
  until groups exist.

Key files:

- `src/api/pocketbase.ts` — singleton PB client (`pocketbaseUrl` from env,
  defaults `/pb`).
- `src/api/localities.ts`, `localityFinds.ts`, `attachments.ts` — CRUD
  + realtime per collection. Attachment files are `protected`, so the
  client fetches short-lived file tokens for thumbnails.
- `src/api/kulturminnerWfs.ts` — the "kjente kulturminner her" readout.
  kart.ra.no has WFS disabled, so this goes to GeoNorge's
  redistribution (`wfs.kulturminner`, feature type `app:Lokalitet`,
  GML 3.2 only, DOM-parsed).
- `src/auth/` — atoms (currentUserAtom, roleAtom, isAdminAtom), hooks
  (useOAuthProviders, useSignIn, useSignOut), AuthButton + AuthDialog.
- `src/localities/` — `LocalityWorkspace` (the docked panel: header,
  Funn, Bilder, Verktøy), `LocalitiesPanel` (the `localities` map
  tool), `localityLayer` / `funnLayer`, `useLocalityCreate`,
  `useLocalityAdjust`, `screenshot.ts`, `serializeDrawLayer.ts`.
- `pocketbase/pb_migrations/1700000200_localities.js` — current schema.
  `1700000000` adds `users.role`, `1700000100` relaxes it. Leave the
  filenames alone — they're recorded in `_migrations`, so renaming one
  makes PB re-run it. Collection ids must not equal any collection name
  (0.23+ rejects that), hence `pbc_localities` / `finds2` /
  `pbc_attachments`.

The workspace is driven by `activeLocalityAtom`, deliberately *not* by
the `MapTool` union (`'layers' | 'measure' | 'localities' | null`), so
a map tool and an open workspace can't fight over the same slot.

Data model:

- **`localities`** — `owner` (relation → users, cascade), `name`,
  `description`, `visibility` (private | limited | public), `bbox`
  (json, `[minLon, minLat, maxLon, maxLat]` EPSG:4326).
- **`finds`** — `locality` (relation, cascade), `owner`
  (denormalized so rules stay cheap), `title`, `note`, `status`
  (mulig | sannsynlig | avkreftet | rapportert), `geometry` (json
  GeoJSON FeatureCollection, EPSG:4326 — Circles round-trip as 64-gons).
- **`attachments`** — `locality`, `owner`, `kind` (extract | screenshot
  | upload), `file` (protected, ≤20 MB, png/jpeg/webp, thumbs),
  `caption`, `meta` (json: source key/label, style, metresPerPx, bbox).

Rules (server-enforced by PB), same shape on all three:

- read: signed in **and** (own it, or its lokalitet is public, or
  `@request.auth.role = "admin"`)
- create: signed in, owns the record, and owns the parent lokalitet
- update/delete: owner or admin

Adding an OAuth provider: PB admin UI → Collections → `users` → Edit
collection → Options → OAuth2 (since 0.23 the providers live on the auth
collection, not in global settings). No code change needed — the SPA's
AuthDialog lists whatever is enabled via
`pb.collection('users').listAuthMethods()`, reading `oauth2.providers`.

## Adding another background layer

1. Add id to the appropriate name union in
   `src/map/layers/backgroundLayers.ts`.
2. Create/extend a config in `src/map/layers/config/backgroundLayers/` and
   spread it into `allConfiguredBackgroundLayers` in `atoms.ts`.
3. Add priority in `backgroundLayerOrder` in
   `src/map/backgroundLayer/utils.ts` (controls display order in the
   "Kart" panel).
4. Handle the thumbnail in `getBackgroundLayerImageName` in
   `src/map/atoms.ts` — either add a `public/backgroundlayerImages/<id>.png`
   asset or map to an existing image as a placeholder.
5. Add translations under `map.settings.layers.mapNames.backgroundMaps.<id>`
   in `src/locales/{nb,nn,en}/translation.json`.

## Conventions specific to this fork

- Server-only rebuilds. Do not `npm install` / `tsc` / `npm run build`
  locally; the user's host doesn't carry the build toolchain. Print the
  `docker compose ...` commands they should run.
- Keep unused code out. If a helper (retry function, config field) has no
  live caller after a change, delete it — don't leave it in "for later".
- Commits use short imperative subject lines. Body explains the *why* when
  the reasoning isn't obvious from the diff. The `Co-Authored-By` trailer
  is added by the commit workflow.

## Removed upstream machinery — don't re-add

Deleted deliberately; if one of these reappears, something regressed.

- **The service-message banner** (`src/messages/`, `src/api/messageApi.ts`).
  It fetched Markdown from
  `raw.githubusercontent.com/kartverket/nk3config/…/messages/{env}.{lang}.md`
  and rendered it, i.e. it put *Norgeskart's* operational announcements in
  Tufteseid's chrome and pinged GitHub on every page load. It was the only
  consumer of `react-markdown` and of `getEnvName()`, both now gone.
- **Hostname-based environment detection** in `src/env.ts`. It matched
  Kartverket's own domains (`*.kartverket-intern.cloud`, `norgeskart.no`,
  …), so *every* Tufteseid deployment fell through to
  `console.error('Unknown domain')` and silently ran the DEV table. There
  is now one `DEFAULT_ENV` plus the `window.__NK_CONFIG__` override from
  the bind-mounted `config.js`, which was always the real mechanism. The
  `envName` and `layerProviderParameters.geoNorgeWMS` keys went with it —
  `geoNorgeWMS` had no consumers at all despite being documented.
- **Google Fonts** (Raleway + Work Sans) in `index.html`. Nothing set
  `font-family`, so they were downloaded on every load and never applied;
  kvib's theme supplies Mulish, self-hosted. `font-src 'self'` is now
  enough.
- **Dead dependencies**: `maplibre-gl` and `@geoblocks/ol-maplibre-layer`
  (zero references — OpenLayers is the map engine, and it's the right one
  for WMS + EPSG:25833; MapLibre is vector-tile-first and weak on
  non-Mercator projections), and `fast-xml-parser` (all XML goes through
  native `DOMParser`).

The Caddyfile CSP was narrowed to what the browser actually contacts:
`cache.kartverket.no` (WMTS tiles *and* its GetCapabilities fetch),
`*.geonorge.no`, `*.norgeskart.no` and `hoydedata.no` (the ArcGIS
identify call in `searchApi.ts`). Nine dead hosts came out. Note
`hoydedata.no` is both an `<a href>` in the help page *and* a real fetch —
only the latter needs the directive. `style-src 'unsafe-inline'` has to
stay while the UI is on kvib/Chakra: emotion injects styles at runtime.

## Lint and dev tooling

**oxlint, not ESLint.** Config is `.oxlintrc.json`; `eslint.config.js` is
gone along with `eslint`, `typescript-eslint` and the four eslint plugins.

The trigger was TypeScript 7. It's the native Go port, and
typescript-eslint 8.x (through 8.69.0, canary included) still declares
peer `typescript ">=4.8.4 <6.1.0"` — so TS 7 made `npm ci` fail with
ERESOLVE and the docker build never reached `npm run build`. That's
fixable with an `overrides` entry, but oxlint parses TypeScript natively
and has no `typescript` peer at all, so the coupling is gone rather than
suppressed. Every remaining `typescript` peer in the tree
(`prettier-plugin-organize-imports` `>=2.9`, i18next / react-i18next
`^5 || ^6 || ^7`) accepts 7 on its own. **Don't reintroduce an
`overrides` block for this** — if it seems necessary again, something
pulled a typescript-eslint dependency back in.

Two things to know before editing `.oxlintrc.json`:

- **No plugins are enabled by default** — they must be listed in
  `plugins`. And rules only fire if their *category* is enabled.
  `react/hooks` (rules-of-hooks) is `suspicious` and
  `react/only-export-components` is `restriction`, neither of which is
  on, so both are listed explicitly under `rules`. Enabling only
  `correctness` would silently drop rules-of-hooks across ~400 hook call
  sites.
- `react/exhaustive-deps` is deliberately `warn`, matching what
  eslint-plugin-react-hooks' recommended preset did.

Two capabilities were dropped in the move, on purpose:

- `eslint-plugin-compat` (browserslist API checking) has no oxlint
  equivalent. `browserslist` in `package.json` still drives the build.
- `eslint-plugin-prettier` — formatting is `npm run format` /
  `format-check`, not a lint rule.

`npm run lint` is not enforced anywhere: it's absent from the Dockerfile,
there are no git hooks, and there is no CI. The build is
`npm ci && tsc -b && vite build`, so type errors block a deploy and lint
findings don't.

Also note `prettier-plugin-organize-imports` drives the TypeScript
*language service*, which is the part of the API the native port trims
hardest. If `npm run format` starts failing under TS 7, that plugin is
the first suspect.
