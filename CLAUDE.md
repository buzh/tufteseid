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

## Companion docs

Each of these owns its subject; this file keeps only what is true across
all of them.

- `docs/ui-architecture.md` — **the whole user interface**: the floating shell
  and its slot geometry, the ribbon and its rows, the lokalitet surfaces,
  drawing, the analysis panels, search, state and URL persistence, the keyboard
  map, and an exhaustive inventory of every user-facing action as the contract
  a redesign has to honour. The UI renders entirely through the in-repo
  `src/ui` kit — plain CSS Modules over `src/ui/tokens.css`, no component
  library. §12 of that doc records the migration off kvib and the primitives
  deliberately not built. **Read it before touching anything under `src/`
  that renders**, and don't reach for a new UI dependency: the workstation
  can't regenerate `package-lock.json`.
- `docs/map-layers.md` — **what is drawn on the map**: the background grounds
  (Standard in its five cartographies, LiDAR hillshade, Hybrid, Flyfoto) and
  how the background *stack* is assembled and swapped, the five Kulturminner
  theme layers and the rendering axis `kulturminner2` exposes, what the public
  registers can be asked about a point or a rectangle (stedsnavn, kommune,
  matrikkel, the kulturminner WFS), and the step-by-step recipes for adding
  another theme or background layer. Every service quirk in it was paid for
  with a live probe. **Read it before touching `src/map/layers/`,
  `src/localities/localityContext.ts`, or before adding a map source.**
- `docs/wms-proxy-and-tiles.md` — how map requests are proxied (Caddy →
  wmscache → upstream, nib-proxy), the nginx cache rules, the Caddyfile CSP
  host list, and the tile-loading constraints that keep request counts under
  Kartverket's rate limit. **Read it before touching `Caddyfile`, `nginx/`,
  `nib-proxy/`, tile grids, layer preloading, anything that multiplies request
  counts, or adding a new external map source.** That machinery is working;
  its details are deliberately out of this file.
- `docs/terrain-analysis.md` — how we get **float elevation** (not shaded
  PNGs) out of hoydedata.no, the endpoint's quirks, and the designs for the
  two bigger analysis builds (a server-side RVT sidecar, a QGIS export) plus
  the Norwegian data sources still unused. **Read it before touching
  `src/terrain/`** or before adding another elevation-derived visualization.
- `docs/analysis-roadmap.md` — status of the "what more can we do with a
  lokalitet" thread: the tier model (0 built, 1–2 designed), the open-source
  GIS tool survey with verdicts and licences, and what's worth building next.
  **Read it before proposing a new analysis feature** — it records what was
  already rejected and why, so those don't get re-litigated.
- `docs/lokalitet-view.md` — **draft, nothing built**: the design for making
  "a lokalitet is open" a view of its own — the two axes (owner/reader ×
  show/edit), **show writes nothing and edit is a transaction** (`Lagre` /
  `Avbryt` over a client-side draft), the lokalitet row as three zones
  (identity + short code / the tools, edit only / the exits, deepest-first),
  **the split between a View and a File** — an extract, terrain render or
  flyfoto is a row of parameters that is stored as a spec and pinned to a
  figure PNG by a background queue after commit, while a screenshot or upload
  is only ever bytes — which is what makes the draft bufferable, the copy
  carry the images, and keeping one free; **removing
  the right-hand dock** in favour of that row plus a bottom
  filmstrip/carousel, the four routes an image takes into a lokalitet (three
  auto-sourced LiDAR styles, a general `Behold` for the ground on screen, and
  keep/discard picker carousels behind LiDAR-uttrekk and Flyfoto), curation
  and the takeout bundle, and moving Terreng and Sammenlign off row 1 onto
  the lokalitet row. Read it before building any of that; it folds into
  `docs/ui-architecture.md` §8 when it lands.
- `README.md` — third-party-facing install and admin guide (docker compose
  install, first-run PocketBase superuser, OAuth redirect URL, granting the
  app admin role, licence). Keep it accurate when any of that changes.

The inventory of **deliberate deletions** — upstream Norgeskart machinery
that must not come back, and why each went — is `docs/ui-architecture.md`
§15. Check it before "restoring" anything.

## What is already built

One line each, so a plan can assume these exist without opening the doc
that owns them.

- **Five background grounds**, on digit keys 1–5: Standard, LiDAR hillshade,
  Hybrid, Flyfoto, Terreng — `docs/map-layers.md`, keyboard in
  `docs/ui-architecture.md` §5.3.
- **A dataset ring inside every ground** (W/S — cartographies, LiDAR projects,
  ortofoto acquisitions, terrain visualizations), plus **Sammenlign**, a
  draggable curtain holding two full grounds on screen in register —
  `docs/ui-architecture.md` §5.2, §5.3, §5.8.
- **LiDAR relief at 0.25 m per project or 1 m nationally**, DTM or DOM, with
  a style ring, and an *Automatisk* dataset that follows the viewport unless
  pinned — `docs/map-layers.md`, `docs/ui-architecture.md` §5.7.
- **Ortofoto back to the 1930s**: the seamless NiB mosaic as a ground, and
  every acquisition intersecting a rectangle enumerable and grabbable as a
  temporal stack — `docs/map-layers.md`.
- **A LiDAR tile extract** — stitch the densest per-project hillshade over a
  lokalitet's rectangle into one georeferenced image, kept as a Bilde or
  downloaded as PNG; a **starter set** of three readings of that dataset,
  which a new lokalitet fetches for itself without being asked; and
  **Behold**, one verb that keeps whatever ground is on screen at the
  source's own resolution — `docs/ui-architecture.md` §10, §8.9.
- **Five Kulturminner theme layers** from Riksantikvaren with structured
  GetFeatureInfo, and `kulturminner2` reshapeable by register, render and
  vern subset — `docs/map-layers.md`, `docs/ui-architecture.md` §5.9.
- **The registers, answerable per point**: stedsnavn, kommune, matrikkel and
  the kulturminner WFS readout — `docs/map-layers.md`; the elevation readout
  behind a clicked point is the hoydedata.no ArcGIS identify in
  `src/search/searchApi.ts` — `docs/ui-architecture.md` §7, §7.1. Behind
  **Stedsinfo**, a ribbon toggle (`I`) that is off on arrival: a map click asks
  the registers nothing until the tool is armed.
- **Search** over place names, addresses and matrikkel, with an InfoBox for
  the picked point — `docs/ui-architecture.md` §7.
- **A float elevation grid for any rectangle**, with eight relief
  visualizations computed in the browser — hillshade, multidirectional
  hillshade, VAT, sky-view factor, positive and negative openness, local relief
  model, slope — on a pulldown and a W/S ring like every other ground's dataset
  list — `docs/terrain-analysis.md` and below.
- **Lokaliteter**: an authored rectangle holding named *funn* with full
  drawing tools and *bilder* (extracts, terrain renders, screenshots,
  flyfoto, uploads), behind sign-in — below, and
  `docs/ui-architecture.md` §8, §9.
- **Every raster the app keeps or hands out carries a provenance caption** —
  dataset, acquisition, processing parameters, extent, licence — below, and
  `docs/ui-architecture.md` §8.10.
- **A ribbon + settings-strip UI kit** with URL-persisted state and a
  keyboard map, so a new control has a place to go and a key to get it —
  `docs/ui-architecture.md` §4.3, §5.1.
- **Three languages throughout** — user-visible strings go through `t()` into
  `src/locales/{nb,nn,en}/translation.json`, `ribbon.*` for the ribbon and
  `localities.*` for the lokalitet surfaces, so a new string needs all
  three files — `docs/ui-architecture.md` §5.4.

## Deploy

Runs as a Docker Compose stack **on a separate server**. The working copy you
see is the user's workstation: it has no docker daemon and does not run the
stack, so `docker compose ...`, `curl localhost:3030`, and container logs are
all unavailable locally. Print the commands for the user to run on the server
instead. Same for the build toolchain — **do not run `npm run build` / `tsc`
locally**; TypeScript errors surface in the docker build output instead.

That also means the app's own proxy paths (`/wms/nib/...`, `/wms/geonorge/...`)
can't be probed from here. Public upstreams *can* be reached directly over the
internet, and that includes the NiB ones: the anonymous token is bound to the
IP that minted it, so a workstation can mint one and use it itself. What it
can't do is mint a token the server would accept, or the reverse — so a token
is never worth carrying between the two, just mint a fresh one wherever the
call is being made.

Standard rebuild on the server:

```
git pull
docker compose build --pull tufteseid
docker compose up -d
docker compose logs -f tufteseid wmscache
```

If anything under `nginx/` changed, also `docker compose restart wmscache` —
the configs are bind-mounted but nginx only reads them at startup, and
`docker compose up -d` doesn't recreate the container.

Same gotcha for **pocketbase** after adding/changing a migration in the
bind-mounted `pocketbase/pb_migrations/`:

```
docker compose restart pocketbase
docker compose logs pocketbase   # confirm the migration applied
```

Symptom of forgetting: API calls against the new/changed collection 404,
which the SPA may surface only in the browser console (e.g. "Ny lokalitet"
appearing to do nothing).

Migration ordering: PocketBase applies **all** of its built-in Go migrations
during bootstrap and only then registers the JS ones from `pb_migrations/`,
whatever the timestamps say. A JS migration can therefore never run before a
core one; anything that has to precede a core migration has to happen out of
band, against a stopped database.

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
- **nib-proxy** — token-injecting sidecar for Norge i bilder (NiB) ortofoto.
  Only reachable from wmscache on the compose network; the token handling and
  routing are `docs/wms-proxy-and-tiles.md`.
- **wmscache** — `nginx:1.27-alpine` reverse proxy + 25 GB disk cache in
  front of every external WMS/WFS/ArcGIS service the SPA uses (Kartverket,
  Riksantikvaren, matrikkel, NiB, hoydedata). Caddy exposes each upstream
  under a same-origin prefix (`/wms/geonorge/…`, `/wms/ra/…`, `/wms/nib/…`,
  `/arcgis/nib/…`, `/arcgis/hoydedata/…`). Rules, cache lifetimes and
  verification commands: `docs/wms-proxy-and-tiles.md`.

## Terrenganalyse (client-side relief from float DEMs)

"Terreng" fetches the **raw float elevation grid** for a rectangle and computes
its own relief visualizations in the browser, instead of restyling Kartverket's
pre-baked hillshade. Rationale and endpoint details: `docs/terrain-analysis.md`.

It has two entrances, and the surface is the same either way: **ribbon row 1**,
over the visible map, with no lokalitet and no account; or **the lokalitet
row**, over an open lokalitet's bbox. Reading the ground is not an act of
ownership — only keeping the render is, and saving from row 1 signs you in and
turns the analysed rectangle into a lokalitet.

Which is why **the terrain strip's own "Lagre" only appears when there is no
lokalitet**, exactly like "Flytt analysen hit" beside it. With one open,
keeping the render is `Behold` on the lokalitet row — one verb for whatever
ground is up, gated on the same `canAdd` as every other write
(`docs/ui-architecture.md` §8.9.2). `useTerrainAnalysis` publishes
`produce()` and a `beholdKey` for that; both paths make the figure the same
way.

Entering it over a lokalitet **seeds the knobs from that lokalitet's cover
terrain render**, once per lokalitet, so coming back to a place opens on the
light that showed the feature rather than on the module defaults. Details and
the reason the seed can't step on "Gjenskap": `docs/ui-architecture.md` §10.

- Source is hoydedata.no's ArcGIS ImageServers via `exportImage` with
  `renderingRule={"rasterFunction":"None"}` — the service's *other* raster
  function is `skyggerelieff`, i.e. the shaded product the WMS already
  serves. Same-origin at `/arcgis/hoydedata/*` → Caddy → wmscache →
  `hoydedata.no/arcgis/rest/services/*`. Anonymous, no token sidecar.
- The mosaics are the **per-project** `Prosjekt_DTM` / `Prosjekt_DOM` (0.25 m),
  not the national `NHM_*` ones (1 m). Measured, not assumed: the national
  mosaic silently serves DTM10 upsampled wherever NHM never flew (its DTM10
  catalogue rows carry `MINPS: 0`), and across 120 random land points there
  was **no** place with laser data nationally but not per-project. So there is
  no fallback to the national mosaic and there should not be — the only thing
  it could add back is the 10 m data. Full probe and the 2×2:
  `docs/terrain-analysis.md`.
- Target resolution is **probed**, not fixed: one `outStatistics` catalogue
  query per bbox returns `min(OPPLOSNING)` over the acquisitions there (0.25,
  0.5 or 1 m), which also answers "is there any laser data here" before a
  single megabyte moves. `Prosjekt_DOM` defaults to a `Northwest` mosaic
  method, so `dem.ts` states `esriMosaicAttribute` / `lowps` explicitly to
  keep the two models alike.
- `src/terrain/dem.ts` — fetch + a ~120-line float-TIFF reader. Deliberately
  **not** geotiff.js: the endpoint emits exactly one shape (uncompressed,
  single-band, 32-bit float, tiled 128×128) and adding a dependency would
  mean regenerating `package-lock.json`, which the workstation can't do.
  No-coverage arrives as **sparse tiles** (`TileOffsets: 0`), not as a nodata
  value or an error — those pixels become NaN and every operator is
  NaN-aware.
- `src/terrain/shade.ts` — hillshade, multidirectional hillshade, slope,
  local relief model, and `computeHorizonFields`, which returns sky-view
  factor and both Yokoyama opennesses from one ray walk. `composeVat` blends
  four of those into RVT's "VAT - Archaeological". Pure functions over a
  `Dem`, split from rendering so the UI can cache the expensive pass while
  scrubbing the cheap one.
- `src/shell/terrain/` — the control surface (`docs/ui-architecture.md` §10),
  and it is **on the ribbon**, not in a dock panel: `useTerrainAnalysis.ts`
  holds all the state and is mounted once from `RibbonGlobalRow`,
  `TerrainStrip.tsx` is its settings-strip half, `TerrainVisPicker.tsx` the
  visualization pulldown on it, and `TerrainSliders.tsx` the slider row under
  it. Terreng is one of the five grounds, so its modifiers
  belong where every other ground's are — a column down the side of the map
  covered the terrain the knobs were describing. The hook resolves the two
  entrances to one rectangle: an open lokalitet's own bbox (which is what makes
  "Juster området" refetch the DEM for free) or `terrainStandaloneBboxAtom`
  (`src/terrain/atoms.ts`) for the row-1 rectangle, never both. Output saves as
  an attachment of the existing `extract` kind (with `style` = the
  visualization), so no PocketBase migration was needed.
- `src/map/groundOverlay.ts` — the render goes **on the map**, as a
  georeferenced `ol/layer/Image` (`ImageCanvasSource`, `zIndex: 1`) over the
  background and under the Kulturminner layers, not as a thumbnail in the
  ribbon. Reading relief *against* the heritage record is the whole point, so
  the relief has to be the ground. Imperative and module-level like
  `swapBackgroundLayers` — the pixels change every slider frame and no React
  component needs to see that.
- **That slot holds exactly one image, and two features want it**: a live
  terrain render and a bilde pinned with "Vis i ruta"
  (`src/localities/usePinnedBilde.ts`). The arbiter is the module, not the two
  callers — `showGroundOverlay({ owner })` takes the slot from whoever has it
  and `hideGroundOverlay(owner)` no-ops unless you still hold it, so **pinning
  an image stands the terrain render down, and entering Terreng unpins the
  image**. The displaced side hears about it through `subscribeGroundOverlay`
  and drops its own selection. There is deliberately no "take it away from
  them" verb: an arbiter with two verbs is an arbiter two callers can disagree
  with.

Load-bearing:

- **The multidirectional blend's azimuths are unevenly spaced and weighted.**
  Averaging evenly spaced azimuths at equal weight cancels the directional
  term by symmetry and silently collapses the result to `cos(zenith)·cos(slope)`
  — a slope map with a hillshade's name. The tell is a maximum of exactly
  0.7071 at altitude 45°, i.e. nothing brighter than flat ground.
- **The `useMemo`s in `useTerrainAnalysis` are split on purpose.** The horizon
  scan is ~800 ms on a 600² grid and must never be keyed on azimuth, or
  dragging the slider queues a multi-second recompute per frame. The radius
  knob is on the *expensive* side of that line, which is why its slider alone
  commits on release instead of streaming.
- **The horizon memo is deliberately not keyed on `vis`.** Sky-view factor,
  both opennesses and VAT are one ray walk read four ways (`usesHorizon` in
  `render.ts`), so the scan gets a memo of its own keyed on
  `[dem, usesHorizon(vis), horizonRadius]`, and the radius is clamped through
  `'svf'` rather than through `vis` so all four resolve to the same number.
  That is what makes W/S between them instant. Key it on `vis` and the ring
  costs 800 ms a step while looking identical.
- **VAT's sun is frozen** at 315°/35°, z-factor 1, and its four layers are
  stretched on *absolute* bounds rather than this rectangle's percentiles
  (`VAT_LAYERS`). Both are what make two VAT renders comparable, which is the
  whole reason to have it; wiring the azimuth slider back up would break it
  silently. It is also why VAT is on the static side of the memo split.
- **`computeHorizonFields` clamps its search radius to 24 px** — 6 m on a
  0.25 m DEM — whatever metre value it is handed, so a requested radius and an
  effective one are routinely different numbers. Everything that renders or
  *describes* a render goes through `clampRadius` (`render.ts`), and
  `radiusRange` derives the slider's ceiling from the same cap. Skipping it
  puts "SVF-radius 20 m" on the caption of a 6 m render, which is the one
  thing `src/figure/` exists to prevent.

## Lokaliteter (user content)

The top-level user object is **an area to explore**, not a claim that
something is there — mirroring Riksantikvaren's lokalitet → enkeltminne
hierarchy. A lokalitet is an authored rectangle — framed from the visible map
in one press, resizable afterwards — holding *funn* (individually named and
addressable drawn features) and *bilder* (kept LiDAR extracts, terrain
renders, map screenshots, flyfoto, uploads).

Two rules that hold regardless of what the interface looks like:

- All lokalitet content is behind sign-in, including `public` ones — the read
  rules require `@request.auth.id != ""`. The map itself stays publicly
  browsable.
- `limited` visibility is a placeholder that behaves as `private` until
  groups exist.

The ribbon rows, the funn list, the bottom edge the bilder live on — a
filmstrip in show, a carousel in edit (`docs/ui-architecture.md` §8.7.2) —
the drawing tools and the policy
decisions around them (bbox is authored not derived, only seeded from the
viewport; drawing and extract exist only inside a lokalitet; measure and
terrain analysis stay global) are in `docs/ui-architecture.md`.

Key files (data side):

- `src/api/pocketbase.ts` — singleton PB client (`pocketbaseUrl` from env,
  defaults `/pb`).
- `src/api/localities.ts`, `localityFinds.ts`, `attachments.ts` — CRUD +
  realtime per collection. Attachment files are `protected`, so the client
  fetches short-lived file tokens for thumbnails.
- `src/api/kulturminnerWfs.ts` — the "kjente kulturminner her" readout;
  which service it has to ask and why is `docs/map-layers.md`.
- `src/auth/` — atoms (currentUserAtom, roleAtom, isAdminAtom), hooks
  (useOAuthProviders, useSignIn, useSignOut).
- `src/localities/localityContext.ts` — what the public registers know about a
  rectangle (see below).
- `pocketbase/pb_migrations/1700000200_localities.js` — current schema.
  `1700000000` adds `users.role`, `1700000100` relaxes it,
  `1700000300` adds the `flyfoto` attachment kind, `1700000400` adds
  `localities.place` / `.municipality` / `.matrikkel`, `1700000500` adds
  everything the lokalitet view needs at once (`localities.code` +
  backfill, `.derivedFrom`, `.derivedFromLabel`, `attachments.sort`,
  `.hidden`, and `attachments.file` relaxed to optional). **Leave the
  filenames alone** — they're recorded in `_migrations`, so renaming one
  makes PB re-run it. Collection ids must not equal any collection name
  (0.23+ rejects that), hence `pbc_localities` / `finds2` /
  `pbc_attachments`.

Data model:

- **`localities`** — `owner` (relation → users, cascade), `code` (six
  characters of Crockford base32, unique, generated client-side at create
  and retried on the unique-index 400), `name`, `description`, `place`,
  `municipality`, `matrikkel` (all optional text), `visibility` (private |
  limited | public), `bbox` (json, `[minLon, minLat, maxLon, maxLat]`
  EPSG:4326), `derivedFrom` (relation → localities, **no** cascade delete —
  a fork outlives its original) + `derivedFromLabel`. The centre coordinate
  is deliberately **not** a field — see below.
- **`finds`** — `locality` (relation, cascade), `owner` (denormalized so
  rules stay cheap), `title`, `note`, `status` (mulig | sannsynlig |
  avkreftet | rapportert), `geometry` (json GeoJSON FeatureCollection,
  EPSG:4326 — Circles round-trip as 64-gons).
- **`attachments`** — `locality`, `owner`, `kind` (extract | screenshot |
  upload | flyfoto), `file` (protected, ≤20 MB, png/jpeg/webp, thumbs, and
  **optional** — a View is a spec before it is pixels), `caption`, `meta`
  (json: source key/label, style, model, metresPerPx, bbox, `imageRect`),
  `sort` and `hidden` for exhibit order and concealment.

Rules (server-enforced by PB), same shape on all three:

- read: signed in **and** (own it, or its lokalitet is public, or
  `@request.auth.role = "admin"`)
- create: signed in, owns the record, and owns the parent lokalitet
- update/delete: owner or admin

That asymmetry is why the UI carries **two** permissions rather than one.
`useLocalityWorkspace` computes `access` (`owner` | `admin` | `reader`),
`mayEdit` (update/delete — owner *and* admin) and `mayAdd` (create — owner
only, because the create rules also demand the parent lokalitet's owner). An
admin can rename, retitle, reshape and delete anybody's lokalitet but cannot
put new funn or bilder in it.

Crossed with that is a second, independent axis: **stance**, `show` | `edit`.
Access is a fact about the record; stance is a choice made inside it. Every
lokalitet opens in `show` and **nothing in show writes** — the write verbs are
*absent* there, not disabled — with one exception: a lokalitet created in this
session (from the viewport, or by saving a terrain render with none open)
opens in `edit`, because it was made by an act of authorship. Stance is per
session and never stored; it lives in `editingLocalityIdAtom`, keyed on the
record id rather than a boolean, so "opens in show" holds by construction when
the active lokalitet changes.

What the surfaces actually gate on is the product, and that is what the hook
publishes: `canEdit = mayEdit && stance === 'edit'`, `canAdd = mayAdd && stance
=== 'edit'`. (`mayEdit` is published too — the lokalitet row needs it to decide
whether to offer `Rediger` at all.) Every surface gates on whichever of the two
matches the call it makes. Details: `docs/ui-architecture.md` §8.1.

Adding an OAuth provider: PB admin UI → Collections → `users` → Edit
collection → Options → OAuth2 (since 0.23 the providers live on the auth
collection, not in global settings). No code change needed — the SPA's
AuthDialog lists whatever is enabled via
`pb.collection('users').listAuthMethods()`, reading `oauth2.providers`.

### Provenance figures (what a saved image says about itself)

`src/figure/` — every raster the app keeps *or hands out* goes through
`renderFigureBlob(canvas, spec)` first and comes back as a figure: the image
untouched, a scale bar and north arrow on it, and a caption panel **below** it
naming the dataset, the acquisition, the processing settings (azimuth,
altitude, z-factor, radii, stretch), the EPSG:25833 extent, the geodetic
centre, the rights holder and the licence.

The reason is the point of the app: a hillshade at 315°/35° and one at 135°/20°
disagree about whether there is a mound in that field, so a render without its
own azimuth on it cannot be checked by anyone — which is the difference between
a picture and evidence, and reporting a find to Riksantikvaren means handing
over the second kind.

- Scope is **everything but "Last opp"**: both extract exits (Behold *and* the
  PNG download), Behold on any ground, terrain Lagre, the flyfoto grab, Ta
  skjermbilde, all three steps of the starter set. An upload's provenance is
  unknown to the app.
- Because the caption is a panel below rather than an overlay, the file is no
  longer pixel-registered to `bbox25833` — every attachment records
  `meta.imageRect` for where the image sits inside it.
- Producers therefore hand back a **canvas**, not a blob (`fetchFlyfoto`,
  `captureLocalityScreenshot`, `renderTerrain`, `extractCanvas`).
- Strings live under `figure.*`; `src/figure/` reads `t` / `i18n` from
  `'i18next'` directly, since three of its five call sites are outside React.

Full rationale and the load-bearing details: `docs/ui-architecture.md` §8.10,
and `docs/terrain-analysis.md` for which parameters each visualization records.

### Sted / kommune / matrikkel (what the registers already know)

`src/localities/localityContext.ts` asks three anonymous GeoNorge point
endpoints what a rectangle is, and `createLocalityFromBbox` awaits that
*before* writing the record, so a new lokalitet arrives named after the
nearest stedsnavn with its place, kommune and matrikkel fields filled. Which
endpoints, the `navneobjekttype` vocabulary that picks the name over mere
distance, and the never-fatal-never-slow failure behaviour are in
`docs/map-layers.md`; UI consequences are `docs/ui-architecture.md` §8.3.

Two policy facts that live here rather than with the endpoints:

- **Pre-fill, not derivation.** The three are ordinary editable fields; only
  the explicit "Hent stedsdata på nytt" button re-derives them. The register
  cannot know the user means "the terrace above Storevike".
- **The centre coordinate is not stored**, precisely because it *is* derivable
  — `formatBboxCentre` computes it per render, so "Juster området" can never
  leave it lying.

## Conventions specific to this fork

- Server-only rebuilds. Do not `npm install` / `tsc` / `npm run build`
  locally; the user's host doesn't carry the build toolchain. Print the
  `docker compose ...` commands they should run.
- Keep unused code out. If a helper (retry function, config field) has no
  live caller after a change, delete it — don't leave it in "for later".
- `icon="…"` props are typed against the `MaterialSymbol` union that
  `material-symbols` ships, re-exported from `src/ui/Icon.tsx`. A
  plausible-looking name that isn't in it fails the docker build. How to check
  a name without local `node_modules`: `docs/ui-architecture.md` §11.
- Commits use short imperative subject lines. Body explains the *why* when
  the reasoning isn't obvious from the diff. The `Co-Authored-By` trailer is
  added by the commit workflow.
