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
| `docs/architecture.md` | Module map, the Jotai atoms, the two-ground `halves` mechanism, the opt-in services, URL parameters, the ribbon's contracts, known gaps | anything under `src/`, especially before building a surface |
| `docs/map-layers.md` | Background grounds, theme layers, and the recipes for adding another | `src/map/layers/`, any new map source |
| `docs/wms-proxy-and-tiles.md` | Caddy → wmscache → upstream and Caddy → mapproxy → upstream, nib-proxy, cache rules, CSP hosts, tile-loading limits | `Caddyfile`, `nginx/`, `mapproxy/`, `nib-proxy/`, tile grids, anything that multiplies request counts |
| `docs/terrain-analysis.md` | Float elevation from hoydedata.no, the endpoint's quirks, the visualizations | `src/terrain/` |
| `docs/render-sidecar.md` | The caller's half of the server-side render service, which lives in the **tufteseid-render** repo: what is sent, the `meta.job` markers read back, the legend's wording, the pinned image, the four seams between the two repos | `src/api/render.ts`, the `sunloop` and `rvt` arms in `src/evidence/`, the `rendersvc` service |
| `docs/identity.md` | PocketBase password auth, the three modes of the sign-in box, the three fields on `users` nobody may set themselves, what a feature gates, and the `MAXUSERS` cap with its `queued` role | `src/auth/`, `pocketbase/pb_hooks/identity.pb.js`, `pocketbase/pb_hooks/capacity.pb.js`, the `users` migrations |
| `docs/votes.md` | The public-only gate, the `votes` and `stars` collections, the two views' shared quirks, and why a self-star is listed but not counted | `src/spots/spotScores.ts`, `src/spots/spotStars.ts`, `src/api/votes.ts`, `src/api/stars.ts`, the vote and star migrations |
| `docs/closed-beta.md` | Who may register and what pays for it, the hook that enforces it, the SQL for opening places and granting invites, the mail route's settings, what the gate does not cover | `pocketbase/pb_hooks/`, `src/invites/`, `src/api/invites.ts`, the sign-in box |
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
- **Four checks run locally**: `npx oxlint@1.83.0` with no arguments, a JSON
  parse of the three locale files, Prettier, and grep. Bare is what
  `npm run lint` runs and it covers the sidecars, the scripts and
  `pocketbase/pb_migrations/` as well as `src`; scoping it to a path hides
  findings elsewhere. The repo is currently clean — a new finding is yours.
- **Prettier needs a throwaway install and the plugin turned off.** Node is on
  the workstation even though the toolchain is not, so install `prettier` and
  `typescript` into a directory outside the repo and point it at `src`. Pass
  the `.prettierrc` options on the command line rather than letting it find the
  file, because `prettier-plugin-organize-imports` cannot resolve imports with
  no `node_modules` here and reports whole files as unformatted that the server
  is happy with. Plugin off, the result matches `npm run format-check`
  exactly — verified against a server run. Import *order* is still only
  checked there.

  ```
  d=$(mktemp -d) && npm --prefix "$d" install prettier@3.9.7 typescript@5.9.3
  "$d"/node_modules/.bin/prettier --no-config --end-of-line auto \
    --single-quote --semi --trailing-comma all --tab-width 2 \
    --check "{src,test}/**/*.{js,jsx,ts,tsx,css,json}"
  ```
- **The app's own proxy paths are unreachable from here** (`/wms/…`,
  `/arcgis/…`). Public upstreams are reachable directly. NiB anonymous tokens
  are bound to the IP that minted them, so mint a fresh one wherever the call is
  made.
- **`icon="…"` props** are typed against the `MaterialSymbol` union from
  `material-symbols`, re-exported by `src/ui/Icon.tsx`. A plausible name that
  isn't in the union fails the docker build. Check one without local
  `node_modules`:

  ```
  curl -sL https://registry.npmjs.org/material-symbols/-/material-symbols-0.47.2.tgz \
    | tar xz -O package/index.d.ts | grep '"terrain"'
  ```
- **`t()` from day one, `nb` only.** User-visible strings go through `t()` into
  `src/locales/nb/translation.json`. `nn` and `en` are stubs — do not hold work
  up for them, and do not add English or Nynorsk guesses to make the files
  match.
- **Keep unused code out.** A helper with no live caller after a change gets
  deleted, not kept "for later". One exception is deliberate and recorded in
  `docs/architecture.md`: `src/search/`.
- **No comments.** The code is the documentation. Source, scripts and config
  carry no prose at all — no module headers, no quirk notes, no provenance for
  a magic number, no `docs/*.md` pointers. Everything the code cannot carry
  goes in the doc that owns the subject, and a name or a named constant carries
  the rest.

  The one exception is a **load-bearing directive**, which is machine-read and
  not prose: `// eslint-disable-*`, `/// <reference`, `@ts-expect-error`,
  `# noqa`, a shebang, a `/*! */` licence banner. Those stay, bare — no reason
  appended.

  The Python sidecars keep their module docstrings, which are strings rather
  than comments and the only narrative left in the source. Everything else is
  a paragraph in `docs/`, not a line above the statement.
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
docker compose build --pull
docker compose up -d
docker compose logs -f tufteseid wmscache mapproxy
scripts/live-check.sh https://<host> [spot-code]
```

`scripts/live-check.sh` runs from the workstation too — the live origin is
public.

First run on a new host wants `sudo mkdir -p /site/tufteseid/data/{logs,stats}`
alongside the cVAT and MapProxy store directories (`README.md`,
`docs/monitoring.md`).

- **`.env` must exist before `docker compose up`.** Nothing in it is
  required any more, but `COMPOSE_PROFILES` is what makes the `ENABLE_*` keys
  mean anything. `.env.example` is the committed shape; `.env` is gitignored
  and lives on the server only.
- **`MAXUSERS` caps how many accounts are seated**, 0 or unset being no cap.
  It reaches the `pocketbase` service only, and changing it is
  `docker compose up -d` — no migration, no rebuild (`docs/identity.md`).
- **Three services are opt-in and default off**: `nib-proxy`, `cvat-tiles`
  and `rendersvc`, each behind one `ENABLE_*` key that drives both
  a compose profile and `/services.js`, which `src/services.ts` reads
  (`docs/architecture.md`). Adding a surface that talks to one of them means
  hiding it behind `serviceOn(…)` in the same change. No evidence row goes
  dark for want of a service: what goes is the control that would ask for
  another one.
- **`rendersvc` is a pinned image, not a build.** It lives in the
  **tufteseid-render** repo and is published to `ghcr.io/buzh/tufteseid-render`,
  so `docker compose build` does not touch it and `up -d` pulls whatever tag
  `docker-compose.yml` names. A render change is live in two steps and two
  repos: tag a release there, bump the tag here
  (`docs/render-sidecar.md`).
- **`COMPOSE_PROFILES=enabled-true` must be in `.env` too**, and `git pull`
  never puts it there — an installation whose `.env` predates the opt-in keys
  has to gain that line by hand. Without it neither `enabled-true` nor
  `enabled-false` is active, so an `ENABLE_*` key turns the chips on (it is
  also in the `tufteseid` service's `environment`) while leaving the container
  out, and every chip meets a 502.
- Flipped an `ENABLE_*` key? **`docker compose up -d --remove-orphans`.** The
  key is in the `tufteseid` service's `environment` as well as in the
  profile, so compose recreates that container by itself and the entrypoint
  rewrites `services.js` — leave it there, or turning a service off would
  stop the container and leave its chips on screen. `--remove-orphans` is the
  other half: compose starts a newly enabled service but does *not* stop a
  newly disabled one, which it reports as an orphan and otherwise leaves
  running.
- Changed anything under `nginx/`? Also `docker compose restart wmscache`. The
  configs are bind-mounted but nginx only reads them at startup, and
  `docker compose up -d` does not recreate the container. Same for `mapproxy/`
  and `docker compose restart mapproxy`.
- Added or changed a migration in `pocketbase/pb_migrations/` or a hook in
  `pocketbase/pb_hooks/`? Also `docker compose restart pocketbase`, then check
  its logs. Both are bind-mounted read-only and hook watching is off, so
  neither is re-read otherwise. Symptom of forgetting: API calls against the
  collection 404, or a hook that quietly behaves the old way — which the SPA
  may surface only in the browser console.

### Services

| Service | What it is |
| --- | --- |
| `tufteseid` | `node:24-alpine` builds the SPA, `caddy:2.10.0-alpine` serves `/var/www`, plus the GoAccess report at `/stats/` out of a read-only mount. `config.js` bind-mounted at runtime; `services.js` written beside it by `docker-entrypoint.sh`. |
| `pocketbase` | Backend for accounts and spots, pinned to 0.40.2. Serves `/pb/*`. SQLite on the `pbdata` volume, migrations and hooks bind-mounted read-only from the repo. |
| `nib-proxy` | **Opt-in (`ENABLE_FLYFOTO`).** Token-injecting sidecar for Norge i bilder ortofoto. Reachable only from wmscache and mapproxy. |
| `rendersvc` | **Opt-in (`ENABLE_RENDER`).** A pinned image from the **tufteseid-render** repo, not a build: `ghcr.io/buzh/tufteseid-render`. Serves `/render/*`: renders an evidence row server-side and PATCHes the file back with the caller's own token. One worker, a queue of 8, CPU and memory capped. |
| `cvat-tiles` | **Opt-in (`ENABLE_CVAT`).** `node:24-alpine`, zero deps. Serves `/cvat/*` out of one MBTiles database per LiDAR acquisition in the bind-mounted store. Built out of band by `vat-cache/`. |
| `mapproxy` | `mapproxy:7.0.0-alpine-nginx`. Serves `/cache/*`: the six upstream layers whose parameters never change, meta-tiled onto the app's own grid and held in MBTiles. Config in `mapproxy/`, store bind-mounted. |
| `wmscache` | `nginx:1.27-alpine` reverse proxy + 25 GB disk cache in front of every external WMS/WFS/ArcGIS service whose parameters are chosen at request time, plus Kulturminnesøk's record API. |

## PocketBase

Migrations are versioned in `pocketbase/pb_migrations/` and use the ≥0.23
App-based JSVM API (`$app.findCollectionByNameOrId` / `app.save`, flattened
field classes), **not** the 0.22 `Dao` API. `pocketbase/pb_hooks/` holds JS
hooks in the same runtime, for the three things a collection rule cannot say:
the closed-beta gate counts rows and spends a counter (`docs/closed-beta.md`),
`identity.pb.js` pins the three fields on a `users` row that are not the
reader's to choose, a rule being unable to name a field, and `profile.pb.js`
moves an account's address, which PocketBase refuses on a self-PATCH
(`docs/identity.md`).

- **A hook handler cannot see its own file's scope.** PocketBase serializes
  each handler and runs it in a runtime of its own, so a constant or helper
  declared at the top of a `.pb.js` file is not there inside its handlers —
  only the injected globals are. Shared code goes in a plain `.js` beside it
  (`*.pb.js` is what gets loaded as hooks) and every handler starts with
  ``require(`${__hooks}/<name>.js`)``. Nothing warns you: the first request
  raises a `ReferenceError` that reaches the client as a bare 400 with an
  empty `data` and reaches you only in the admin UI's *Logs*, never stdout.
- **Leave migration filenames alone** — they are recorded in `_migrations`, so
  renaming one makes PocketBase re-run it.
- **Collection ids must not equal any collection name** (0.23+ rejects that),
  hence `pbc_localities` / `finds2` / `pbc_attachments`.
- **Ordering**: PocketBase applies all of its built-in Go migrations during
  bootstrap and only then registers the JS ones, whatever the timestamps say. A
  JS migration can never run before a core one; anything that must precede a
  core migration happens out of band against a stopped database.
- **Sign-in is PocketBase's own password auth**, versioned in
  `1700002500_password_auth.js` rather than left to the admin UI, and
  `oauth2` is switched off with its `providers` cleared — a config left
  enabled but unused still answers `listAuthMethods` and still accepts a
  code. `docs/identity.md` has what turning one back on would take.

### Collections

Two collections carry the reader's records, and four more the votes and
stars on them:

- **`spots`** (id `pbc_spots`) — `owner` (→ users, cascade), `code` (six
  characters of Crockford base32, unique, generated client-side and retried on
  the unique-index 400), `name`, `description`, `credit` (the author's name,
  denormalized because `users` is closed to guests), `visibility`
  (private | public), `point` (json, `[lon, lat]` EPSG:4326), `footprint` (json,
  `[west, south, east, north]` EPSG:4326 or null — the rectangle the spot's
  evidence covers, free in both axes: one render box up to 500 m on either
  side, or past that a boundary snapped to whole grid tiles and tiled into
  render boxes each within the cap, one row apiece), `sketch` (json ≤5 MB: an
  Excalidraw scene plus the frame that georeferences it, or null), `mapSketch`
  (which drawing stands on the shared drawing layer; empty means the `sketch`
  column, which is the only drawing a spot can hold today).
- **`evidence`** (id `pbc_evidence`) — `spot` (→ spots, cascade), `owner`
  (→ users, cascade), `kind` (lidar | terrain | flyfoto | sunloop | rvt, the
  last being every RVT blend, with `meta.vis` saying which), `file`
  (≤50 MB image or `video/webm`,
  **empty until the render lands** — test it rather than assuming a row has a
  picture), `caption`, `meta` (json ≤10 kB: the parameters asked for, the
  rectangle covered, the resolution achieved, `renderedAt`, and `keep` — which
  press of the camera made the row, so a mosaic's tiles read as one picture),
  `sort` (epoch milliseconds at creation).

A row is parameters first and pixels second: the client creates it, then a
serial queue renders and PATCHes the file on. A render is not a cache — nothing
re-renders a row by itself, and `meta.renderedAt` says when the picture was
made.

Which queue depends on the kind. Three kinds are rendered in the tab that asked
(`src/evidence/queue.ts`); `sunloop` and `rvt` are handed to the `rendersvc`
sidecar, which writes `meta.job` as it goes and the file when it is done
(`docs/render-sidecar.md`).

- **`votes`** (id `pbc_votes`) — `owner` (→ users, cascade), `spot` (→ spots,
  cascade), `direction` (up | down). Unique over `(owner, spot)`: one vote per
  account per spot, with retracting being a delete rather than a third value,
  and never on your own spot. Readable only by its owner — *how a spot stands*
  is public, *who voted* is not.
- **`spotScores`** (id `pbc_spot_scores`) — a **view** over `votes`, open to a
  guest, carrying `up`, `down`, `votes` and `score` per **public** spot. Two
  things to code against: PocketBase publishes **no realtime feed on a view**,
  and a spot with no votes is **absent** rather than present at zero
  (`docs/votes.md`).
- **`stars`** (id `pbc_stars`) — `owner` (→ users, cascade), `spot` (→ spots,
  cascade), `created`. A favourite: unique over `(owner, spot)` like a vote,
  readable only by its owner like a vote, but with **no update rule** — it
  holds nothing that can change — and allowed **on your own spot**, which is
  what puts it in *Mine favoritter*.
- **`starCounts`** (id `pbc_star_counts`) — a **view** over `stars` with the
  same two quirks as `spotScores`, carrying `stars` per **public** spot and
  **leaving the owner's own star out**, so the favourites list and the tally
  disagree on an author's own spot by design (`docs/votes.md`).

Two more carry the closed beta, both written by `pb_hooks/closed_beta.pb.js`
rather than by the SPA:

- **`registration`** (id `pbc_registration`) — **one row**, readable by a
  guest: `openSlots` (free registrations left) and `closed`. Nobody may write
  it over the API; it moves by SQL or in the admin UI.
- **`invites`** (id `pbc_invites`) — `issuer` (→ users, cascade), `code`
  (eight characters of Crockford base32, unique, minted by the hook),
  `redeemedBy`, `redeemedAt`, `email`, `sentAt`. **`redeemedAt` is what says
  an invite is spent** — `redeemedBy` empties if the invitee closes their
  account. `users.inviteQuota` caps how many an account may mint, and what is
  left to mint is that less the rows it has issued, so revoking refunds.

`localities`, `finds` and `attachments` are still on disk from the old model and
are read by nothing. Leave them alone rather than adding a migration to drop
them.

Client side: `src/api/pocketbase.ts` (singleton, `pocketbaseUrl` defaults `/pb`),
`src/api/spots.ts`, `src/api/evidence.ts`, `src/api/votes.ts`,
`src/api/stars.ts` and `src/api/invites.ts`.

### Permissions

Server-enforced on `spots`:

- **read** — the record is public, *no account needed*; or signed in and (owns
  it, or `@request.auth.role = "admin"`)
- **create** — signed in and owns the record
- **update/delete** — owner or admin

So the UI carries one permission, `mayEdit` (owner *or* admin): an admin can
rename, reshape and delete anybody's spot. `users.role` and `users.features`
are granted by hand in the admin UI, pinned at registration by
`pb_hooks/identity.pb.js` — which also parks the row in the `queued` role
when the installation is at `MAXUSERS`, a fourth role that may hold no token
until a place opens (`docs/identity.md`). The `users` row is self-updatable
for the three fields that are the reader's — `name`, `description` and
`avatar` — and the same hook puts rank, membership and invite quota back on
every PATCH. The address needs a route of its own and the current password;
the password needs PocketBase's own `oldPassword` (`docs/identity.md`).

**What a feature gates is what costs somebody money**, never what a spot
already carries. A gated capability is a name on `users.features` — `render`
and `flyfoto` so far — kept out of the collection rules and enforced where the
cost is: `rendersvc` reads the caller's own row and refuses, so
`src/auth/features.ts` only hides the control that would meet that 403.
`flyfoto` has no server end at all and is the hiding alone — an ungranted
reader's Flyfoto button opens norgeibilder.no instead of the ground
(`docs/identity.md`). An admin holds every feature, and nobody holds one whose
service is off. Granting one is an admin-UI edit with no code change; adding a
*feature* is a string on both ends.

`evidence` follows its spot and adds the spot's owner to every write rule, so an
admin may keep a render against somebody else's spot and that spot's author can
still caption and delete it. Its `file` field is **unprotected**: public spots
are readable with no account and a guest can hold no file token, so the trade is
that a file URL under a private spot works if it leaks. Same trade the old model
recorded in `1700000900_public_guest_reads.js`.
