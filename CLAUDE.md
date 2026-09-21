# Tufteseid — armchair archaeology on Norwegian public data

Map viewer for reading Norwegian LiDAR terrain against the Riksantikvaren
heritage register (Kulturminner). Hard fork of Kartverket's Norgeskart, not
tracking upstream. Working branch: `new-ui`.

**The interface is being rebuilt from nothing, on Mantine.** This branch kept
OpenLayers, the WMS/cache path and the headless computation behind them, and
deleted every surface on top — ribbon, lokaliteter, funn, drawing, search UI,
the UI kit. What has been built back is a top ribbon over the LiDAR ring
(`src/ribbon/`); everything else is still atoms with no writer. Read
`docs/state-of-the-branch.md` before adding the next control: it lists what
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
search. What the user's own records look like is an open question on this
branch — the old lokalitet/funn model was deleted rather than ported.

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
  public. Its raster half still holds; its PocketBase half probes the old
  collections and will need rewriting with the new data model
  (`docs/state-of-the-branch.md`).

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
| `pocketbase` | Backend for lokaliteter (auth + user content), pinned to 0.40.2. Serves `/pb/*`. SQLite on the `pbdata` volume. |
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

- **`localities`** — `owner` (→ users, cascade), `code` (six characters of
  Crockford base32, unique, generated client-side and retried on the
  unique-index 400), `name`, `description`, `place`, `municipality`,
  `matrikkel`, `credit` (the author's name, denormalized off the account
  because `users` is closed to guests), `visibility` (private | limited |
  public), `bbox` (json, `[minLon, minLat, maxLon, maxLat]` EPSG:4326),
  `derivedFrom` (→ localities, **no** cascade — a fork outlives its original) +
  `derivedFromLabel`. The centre coordinate is deliberately not a field: it is
  derived per render.
- **`finds`** — `locality` (cascade), `owner` (denormalized so rules stay
  cheap), `title`, `note`, `status` (mulig | sannsynlig | avkreftet |
  rapportert), `geometry` (json GeoJSON FeatureCollection, EPSG:4326).
- **`attachments`** — `locality`, `owner`, `kind` (extract | screenshot |
  upload | flyfoto | sketch | scene), `file` (≤50 MB, png/jpeg/webp, optional),
  `caption`, `meta` (json, ≤2 MB), `funn` and `over` (uncascaded relations →
  finds and → attachments), `sort`, `hidden`.

Client side: `src/api/pocketbase.ts` (singleton, `pocketbaseUrl` defaults
`/pb`), `src/api/localities.ts`, `localityFinds.ts`, `attachments.ts`.

### Permissions

Server-enforced, same shape on all three collections:

- **read** — the record (or its lokalitet) is public, *no account needed*; or
  signed in and (owns it, or `@request.auth.role = "admin"`)
- **create** — signed in, owns the record, and owns the parent lokalitet
- **update/delete** — owner or admin

That asymmetry is why the UI carries two permissions rather than one:
`mayEdit` (owner *or* admin) and `mayAdd` (owner only). An admin can rename,
reshape and delete anybody's lokalitet but cannot put new funn or bilder in it.

Crossed with that is **stance**, `show` | `edit` — a per-session choice, held in
`editingLocalityIdAtom` and never stored. Nothing in `show` writes: the write
verbs are absent there, not disabled. A lokalitet opens in `show` unless it was
just created here or has a restored draft. Surfaces gate on the product:
`canEdit = mayEdit && stance === 'edit'`, `canAdd = mayAdd && stance === 'edit'`.

`limited` visibility is a placeholder that behaves as `private` until groups
exist.
