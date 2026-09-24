# Tufteseid — armchair archaeology on Norwegian public data

Map viewer for reading Norwegian LiDAR terrain against the Riksantikvaren
heritage register (Kulturminner). React + Mantine + OpenLayers SPA, a Caddy
static server, and a handful of caching sidecars in front of Kartverket,
Geonorge, Riksantikvaren and Norge i bilder.

Hard fork of Kartverket's Norgeskart, not tracking upstream. The pre-rebuild
app is on the `legacy` branch.

**Scope**: Kulturminner theme layers, LiDAR hillshade and per-project LiDAR
backgrounds, LiDAR tile extract, client-side terrain analysis, place/property
search, and a record of the reader's own (`spots`).

**De-branded on purpose**: no Norgeskart naming or Kartverket visual identity in
user-visible strings, page titles, export filenames or assets. Attribution
belongs in prose (README, LICENCE), not in the app.

Surfaces are Mantine primitives styled from `src/ui/theme.ts`: anthracite
ground, papaya accent, **dark only**. There is no light scheme, so CSS that
hard-codes a light surface will look wrong. Reach for `--mantine-*` custom
properties rather than literals.

## Docs

Each owns its subject; this file keeps only what is true across all of them.

| Doc | Subject | Read before touching |
| --- | --- | --- |
| `docs/architecture.md` | Module map, the Jotai atoms, the two-ground `halves` mechanism, URL parameters, the ribbon's contracts, known gaps | anything under `src/`, especially before building a surface |
| `docs/map-layers.md` | Background grounds, theme layers, and the recipes for adding another | `src/map/layers/`, any new map source |
| `docs/wms-proxy-and-tiles.md` | Caddy → wmscache → upstream and Caddy → mapproxy → upstream, nib-proxy, cache rules, CSP hosts, tile-loading limits | `Caddyfile`, `nginx/`, `mapproxy/`, `nib-proxy/`, tile grids, anything that multiplies request counts |
| `docs/terrain-analysis.md` | Float elevation from hoydedata.no, the endpoint's quirks, the visualizations | `src/terrain/` |
| `docs/monitoring.md` | The access logs, the usage report, the cron health check, retention | `scripts/usage-report.sh`, `scripts/health-check.sh`, any log format or `logging:` cap |
| `vat-cache/README.md` | The out-of-band Python pipeline that precomputes the cached VAT ground | `vat-cache/`, `cvat-tiles/` |
| `README.md` | Third-party install and admin guide | any change to install, first-run or licensing |

## Working here

- **No local build.** The workstation has no node toolchain and no docker
  daemon. Do not run `npm install`, `tsc`, `npm run build`, `npm test`,
  `docker compose`, or `curl localhost:3030`. Print the commands for the user to
  run on the server. TypeScript errors surface in the docker build output.
- **No new dependencies without a server round trip.** `package-lock.json`
  cannot be regenerated here, so adding or removing one is an `npm install` the
  user runs on the server and pastes back. That is a cost, not a ban.
- **Three checks run locally**: `npx oxlint@1.83.0` with no arguments, a JSON
  parse of the three locale files, and grep. Bare is what `npm run lint` runs
  and it covers the sidecars, the scripts and `pocketbase/pb_migrations/` as
  well as `src`; scoping it to a path hides findings elsewhere. The repo is
  currently clean — a new finding is yours.
- **The app's own proxy paths are unreachable from here** (`/wms/…`,
  `/arcgis/…`). Public upstreams are reachable directly. NiB anonymous tokens
  are bound to the IP that minted them, so mint a fresh one wherever the call is
  made.
- **`icon="…"` props** are typed against the `MaterialSymbol` union from
  `material-symbols`, re-exported by `src/ui/Icon.tsx`. A plausible name that
  isn't in the union fails the docker build; the comment on that re-export has
  the procedure for checking one without local `node_modules`.
- **`t()` from day one, `nb` only.** User-visible strings go through `t()` into
  `src/locales/nb/translation.json`. `nn` and `en` are stubs — do not hold work
  up for them, and do not add English or Nynorsk guesses to make the files
  match.
- **Keep unused code out.** A helper with no live caller after a change gets
  deleted, not kept "for later". One exception is deliberate and recorded in
  `docs/architecture.md`: `src/search/`.
- **Minimal comments.** The code is the documentation. A comment earns its place
  by recording something the code cannot say — an upstream's quirk, a CRS or
  axis-order fact, a unit not in the identifier, a required call ordering, where
  a magic number came from, or a constraint a maintainer would otherwise "fix"
  into a bug. Not what the next line does, and not why a decision was taken.
- **Commits**: short imperative subject; body explains the *why* when the diff
  doesn't. Write the `Co-Authored-By` trailer yourself — nothing adds it.
- **Docs state the present tense.** A change that reverses an earlier decision
  rewrites the paragraph that stated it rather than appending a correction. The
  record of the reversal is the commit.

## Deploy

Docker Compose stack **on a separate server**. Caddy listens on `:3000` inside
the container; compose maps host `127.0.0.1:3030 → 3000`.

```
git pull
docker compose build --pull tufteseid cvat-tiles
docker compose up -d
docker compose logs -f tufteseid wmscache mapproxy
scripts/live-check.sh https://<host> [spot-code]
```

`scripts/live-check.sh` runs from the workstation too — the live origin is
public.

First run on a new host wants `sudo mkdir -p /site/tufteseid/data/{logs,stats}`
alongside the cVAT and MapProxy store directories (`README.md`,
`docs/monitoring.md`).

- Changed anything under `nginx/`? Also `docker compose restart wmscache`. The
  configs are bind-mounted but nginx only reads them at startup, and
  `docker compose up -d` does not recreate the container. Same for `mapproxy/`
  and `docker compose restart mapproxy`.
- Added or changed a migration in `pocketbase/pb_migrations/`? Also
  `docker compose restart pocketbase`, then check its logs. Symptom of
  forgetting: API calls against the collection 404, which the SPA may surface
  only in the browser console.

### Services

| Service | What it is |
| --- | --- |
| `tufteseid` | `node:24-alpine` builds the SPA, `caddy:2.10.0-alpine` serves `/var/www`, plus the GoAccess report at `/stats/` out of a read-only mount. `config.js` bind-mounted at runtime. |
| `pocketbase` | Backend for spots (OAuth2 + user content), pinned to 0.40.2. Serves `/pb/*`. SQLite on the `pbdata` volume. |
| `nib-proxy` | Token-injecting sidecar for Norge i bilder ortofoto. Reachable only from wmscache and mapproxy. |
| `cvat-tiles` | `node:24-alpine`, zero deps. Serves `/cvat/*` out of one MBTiles database per LiDAR acquisition in the bind-mounted store. Built out of band by `vat-cache/`. |
| `mapproxy` | `mapproxy:7.0.0-alpine-nginx`. Serves `/cache/*`: the six upstream layers whose parameters never change, meta-tiled onto the app's own grid and held in MBTiles. Config in `mapproxy/`, store bind-mounted. |
| `wmscache` | `nginx:1.27-alpine` reverse proxy + 25 GB disk cache in front of every external WMS/WFS/ArcGIS service whose parameters are chosen at request time, plus Kulturminnesøk's record API. |

## PocketBase

Migrations are versioned in `pocketbase/pb_migrations/` and use the ≥0.23
App-based JSVM API (`$app.findCollectionByNameOrId` / `app.save`, flattened
field classes), **not** the 0.22 `Dao` API.

- **Leave migration filenames alone** — they are recorded in `_migrations`, so
  renaming one makes PocketBase re-run it.
- **Collection ids must not equal any collection name** (0.23+ rejects that),
  hence `pbc_localities` / `finds2` / `pbc_attachments`.
- **Ordering**: PocketBase applies all of its built-in Go migrations during
  bootstrap and only then registers the JS ones, whatever the timestamps say. A
  JS migration can never run before a core one; anything that must precede a
  core migration happens out of band against a stopped database.
- **Adding an OAuth provider** is admin-UI only: Collections → `users` → Edit
  collection → Options → OAuth2. No code change; the SPA's AuthDialog lists
  whatever `listAuthMethods()` reports.

### Collections

Two collections carry the reader's records:

- **`spots`** (id `pbc_spots`) — `owner` (→ users, cascade), `code` (six
  characters of Crockford base32, unique, generated client-side and retried on
  the unique-index 400), `name`, `description`, `credit` (the author's name,
  denormalized because `users` is closed to guests), `visibility`
  (private | public), `point` (json, `[lon, lat]` EPSG:4326), `footprint` (json,
  `[west, south, east, north]` EPSG:4326 or null — the square every piece of
  evidence is rendered over, ≤500 m on a side), `sketch` (json ≤5 MB: an
  Excalidraw scene plus the frame that georeferences it, or null).
- **`evidence`** (id `pbc_evidence`) — `spot` (→ spots, cascade), `owner`
  (→ users, cascade), `kind` (lidar | terrain | flyfoto), `file` (≤50 MB image,
  **empty until the render lands** — test it rather than assuming a row has a
  picture), `caption`, `meta` (json ≤10 kB: the parameters asked for, the
  rectangle covered, the resolution achieved and `renderedAt`), `sort` (epoch
  milliseconds at creation).

A row is parameters first and pixels second: the client creates it, then a
serial queue renders and PATCHes the file on. A render is not a cache — nothing
re-renders a row by itself, and `meta.renderedAt` says when the picture was
made.

`localities`, `finds` and `attachments` are still on disk from the old model and
are read by nothing. Leave them alone rather than adding a migration to drop
them.

Client side: `src/api/pocketbase.ts` (singleton, `pocketbaseUrl` defaults `/pb`),
`src/api/spots.ts` and `src/api/evidence.ts`.

### Permissions

Server-enforced on `spots`:

- **read** — the record is public, *no account needed*; or signed in and (owns
  it, or `@request.auth.role = "admin"`)
- **create** — signed in and owns the record
- **update/delete** — owner or admin

So the UI carries one permission, `mayEdit` (owner *or* admin): an admin can
rename, reshape and delete anybody's spot.

`evidence` follows its spot and adds the spot's owner to every write rule, so an
admin may keep a render against somebody else's spot and that spot's author can
still caption and delete it. Its `file` field is **unprotected**: public spots
are readable with no account and a guest can hold no file token, so the trade is
that a file URL under a private spot works if it leaks. Same trade the old model
recorded in `1700000900_public_guest_reads.js`.
