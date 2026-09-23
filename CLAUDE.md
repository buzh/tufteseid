# Tufteseid — armchair archaeology on Norwegian public data

Map viewer for reading Norwegian LiDAR terrain against the Riksantikvaren
heritage register (Kulturminner). Hard fork of Kartverket's Norgeskart, not
tracking upstream. Working branch: `new-ui`.

**The interface is being rebuilt from nothing, on Mantine.** This branch kept
OpenLayers, the WMS/cache path and the headless computation behind them, and
deleted every surface on top — ribbon, lokaliteter, funn, drawing, search UI,
the UI kit. What has been built back is the background — a ground switch
(`src/grounds/`) and one arm per ground — in a top band that hosts them
(`src/ribbon/`), the Kulturminner overlay and its card, the terrain analysis,
and the reader's own lokaliteter: a pin, a box, a drawing over the ground, an
account, a short link and an index of them in the band (`src/spots/`,
`src/spotControls/`, `src/sketch/`, `src/auth/`). There is still no search box.
Read `docs/state-of-the-branch.md` before adding the next control: it lists what
survived, what the atoms are called, and what is deliberately still broken.
`main` holds the old app and is still deployable.

Surfaces are Mantine primitives styled from the theme in `src/ui/theme.ts`:
anthracite ground, papaya accent, **dark only** — there is no light scheme to
keep in step, and CSS that hard-codes a light surface will look wrong. Reach
for `--mantine-*` custom properties rather than literals; the old
`src/ui/tokens.css` is gone.

## Scope

Keep what an amateur reading relief-shaded terrain against the heritage record
needs: Kulturminner theme layers, LiDAR hillshade and per-project LiDAR
backgrounds, LiDAR tile extract, client-side terrain analysis, place/property
search, and a record of the reader's own. That last one is deliberately small on
this branch: the old lokalitet/funn/bilde model was deleted rather than ported,
and what replaced it is one `spots` row — a pin, a name, a description and an
optional drawing. Pictures and scenes are out until something asks for them.

Not affiliated with Kartverket or Riksantikvaren. The app is de-branded on
purpose: no Norgeskart naming or Kartverket visual identity in user-visible
strings, page titles, export filenames or assets. Attribution belongs in prose
(README, LICENCE), not in the app.

## Docs

Each owns its subject; this file keeps only what is true across all of them.

| Doc | Subject | Read before touching |
| --- | --- | --- |
| `docs/state-of-the-branch.md` | What the strip kept and deleted, the atoms a new interface writes to, and the loose ends left open | anything under `src/`, and especially before building a surface |
| `docs/map-layers.md` | What is drawn on the map: background grounds, theme layers, and the recipes for adding another | `src/map/layers/`, any new map source |
| `docs/wms-proxy-and-tiles.md` | Caddy → wmscache → upstream and Caddy → mapproxy → upstream, nib-proxy, cache rules, CSP hosts, tile-loading limits | `Caddyfile`, `nginx/`, `mapproxy/`, `nib-proxy/`, tile grids, anything that multiplies request counts |
| `docs/terrain-analysis.md` | Float elevation from hoydedata.no, the endpoint's quirks, the visualizations | `src/terrain/` |
| `docs/monitoring.md` | What the access logs record and what reads them back: the usage report, the cron health check, retention, why there is no scraper | `scripts/usage-report.sh`, `scripts/health-check.sh`, any log format or `logging:` cap |
| `README.md` | Third-party install and admin guide | any change to install, first-run or licensing |

## Working here

- **No local build.** The workstation has no node toolchain and no docker
  daemon. Do not run `npm install`, `tsc`, `npm run build`, `npm test`,
  `docker compose`, or `curl localhost:3030`. Print the commands for the user to
  run on the server. TypeScript errors surface in the docker build output.
- **No new dependencies without a server round trip.** `package-lock.json`
  cannot be regenerated here, so adding or removing one is an `npm install`
  the user runs on the server and pastes back. That is a cost, not a ban — the
  new interface is allowed to take a dependency if it earns one.
- **Three checks run locally**: `npx oxlint@1.83.0 <paths>` (scope it to the
  files you touched; `src` carries pre-existing findings — name them as
  pre-existing), a JSON parse of the three locale files, and grep.
- **The app's own proxy paths are unreachable from here** (`/wms/…`,
  `/arcgis/…`). Public upstreams are reachable directly. NiB anonymous tokens
  are bound to the IP that minted them, so a token never travels between
  workstation and server — mint a fresh one wherever the call is made.
- **`icon="…"` props** are typed against the `MaterialSymbol` union from
  `material-symbols`, re-exported by `src/ui/Icon.tsx`. A plausible name that
  isn't in the union fails the docker build; the comment on that re-export has
  the procedure for checking one without local `node_modules`.
- **`t()` from day one, `nb` only.** User-visible strings go through `t()` into
  `src/locales/nb/translation.json` so the retrofit stays free. `nn` and `en`
  are stubs while the interface moves — do not hold work up for them, and do
  not add English or Nynorsk guesses to make the files match.
- **Keep unused code out.** A helper with no live caller after a change gets
  deleted, not kept "for later".
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
scripts/live-check.sh https://<host> <lokalitet-code>
```

- `scripts/live-check.sh` runs from the workstation too — the live origin is
  public. Its raster half still holds; its PocketBase half probes `localities`
  and wants rewriting against `spots` and a spot code.

- First run on a new host wants `sudo mkdir -p /site/tufteseid/data/logs`
  alongside the cVAT and MapProxy store directories — Caddy's access log is a
  bind mount, and `scripts/usage-report.sh` and `scripts/health-check.sh` both
  read it (`docs/monitoring.md`).

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
| `tufteseid` | `node:24-alpine` builds the SPA, `caddy:2.10.0-alpine` serves `/var/www`. `config.js` bind-mounted at runtime. |
| `pocketbase` | Backend for lokaliteter (OAuth2 + user content), pinned to 0.40.2. Serves `/pb/*`. SQLite on the `pbdata` volume. |
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

One collection carries the reader's records:

- **`spots`** (id `pbc_spots`) — `owner` (→ users, cascade), `code` (six
  characters of Crockford base32, unique from the first migration, generated
  client-side and retried on the unique-index 400), `name`, `description`,
  `credit` (the author's name, denormalized off the account because `users` is
  closed to guests), `visibility` (private | public), `point` (json,
  `[lon, lat]` EPSG:4326), `sketch` (json ≤5 MB: an Excalidraw scene plus the
  frame that georeferences it, or null).

A point rather than a bbox because placing a pin is one gesture where dragging
corners is four, and two values because `limited` had no groups behind it.

Client side: `src/api/pocketbase.ts` (singleton, `pocketbaseUrl` defaults
`/pb`) and `src/api/spots.ts`.

`localities`, `finds` and `attachments` are still on disk from the old model and
are read by nothing. Leave them alone rather than adding a migration to drop
them — see the loose ends in `docs/state-of-the-branch.md`.

### Permissions

Server-enforced:

- **read** — the record is public, *no account needed*; or signed in and (owns
  it, or `@request.auth.role = "admin"`)
- **create** — signed in and owns the record
- **update/delete** — owner or admin

So the UI carries one permission, `mayEdit` (owner *or* admin): an admin can
rename, reshape and delete anybody's lokalitet. There is no show/edit stance —
the old model's `mayAdd` and `editingLocalityIdAtom` went with the funn and the
bilder, and nothing on this branch has children to gate.
