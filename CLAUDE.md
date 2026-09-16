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
  can't regenerate `package-lock.json`. The one exception ever made is
  `@excalidraw/excalidraw`, which bought the deletion of ~3500 lines of
  fork-local drawing code; §2 of that doc records what it cost.
- `docs/map-layers.md` — **what is drawn on the map**: the background grounds
  (Standard in its five cartographies, LiDAR hillshade, Hybrid, Flyfoto) and
  how the background *stack* is assembled and swapped, the five Kulturminner
  theme layers and the rendering axis `kulturminner2` exposes, what the public
  registers can be asked about a point or a rectangle (stedsnavn, kommune,
  matrikkel), and the step-by-step recipes for adding
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
- `docs/lokalitet-view.md` — **built**: §12's build order is complete, so the
  two axes, the View/File split, the row's zones, the bottom
  filmstrip/carousel, curation, the picker carousels, **removing the dock**,
  **the edit transaction**, **the copy**, **Terreng/Sammenlign on the row**,
  **sharing** (`?lok=CODE`, `/l/CODE`, `Del`) and **the Rapportpakke** (the
  takeout zip) are all live and are documented in `docs/ui-architecture.md`,
  which is the record where the two disagree. Two builds landed *outside* the
  numbered list and so are not in it at all: placing the rectangle before
  creating it, and sketches as overlays. The whole design of making
  "a lokalitet is open" a view of its own is here — the two axes (owner/reader ×
  show/edit), **show writes nothing and edit is a transaction** (`Lagre` /
  `Avbryt` over a client-side draft), the lokalitet row as three zones
  (identity + short code / the tools, edit only / the exits, deepest-first),
  **the split between a View and a File** — an extract, terrain render,
  flyfoto or sketch is a row of parameters that is stored as a spec and pinned
  to a figure PNG by a background queue after commit, while a screenshot or upload
  is only ever bytes — which is what makes the draft bufferable, the copy
  carry the images, and keeping one free; **removing
  the right-hand dock** in favour of that row plus a bottom
  filmstrip/carousel, the four routes an image takes into a lokalitet (three
  auto-sourced LiDAR styles, a general `Behold` for the ground on screen, and
  keep/discard picker carousels behind LiDAR-uttrekk and Flyfoto), curation
  and the takeout bundle, and moving Terreng and Sammenlign off row 1 onto
  the lokalitet row. Read it before building any of that; each step folds into
  `docs/ui-architecture.md` §8 as it lands. **§13 is a separate thread and
  the row itself is built, all nine steps**: the *layer row* — four `[thing ▾]`
  groups
  (Visning / Bilde / Skisse / Funn) matching the map's z-stack bottom-to-top,
  each member switchable with its own opacity — which deletes `Gjenskap`, `Vis
  i ruta` and the one-slot ground arbiter, makes a funn a container for images
  as well as a sublocation, and gives an arrangement a record of its own
  (`kind: 'scene'`, membership on the existing `over`). §13.10 is its build
  order and all nine steps have landed: the ground overlay is a stack
  and the
  arbiter is gone; `src/localities/groundView.ts` can put a View on the map
  as its own pixels over its own rectangle — rendering it live when there is no
  pinned figure to lay down; `src/shell/LayerGroup.tsx` is the `[thing ▾]`
  control itself; and all four groups wear it.
  The component
  is the *button and the pulldown frame* — a label that toggles the group, a
  caret that opens it, a badge counting what is on the map — with the body a
  render prop, so a group brings either the default `LayerMembers` (a switch
  and a fade each) or a surface of its own, as `[Funn ▾]` brings `FunnList`.
  `[Visning ▾]` (`src/shell/VisningControl.tsx`, §10.1 of the UI doc) holds the
  ground preset at the bottom and every View in the lokalitet above it, so
  switching an extract or a 1937 ortofoto onto the ground is now one pulldown,
  and switching the whole group off leaves a sketch and its funn on white.
  That group is a **selection, not a set of checkboxes**: one View at a time
  over the ground, faded to read one against the other, and **pressing a row
  enters the View** — the ground it was rendered on, its dataset, its knobs —
  which is where `Gjenskap` finally went, from a button on the card, to a
  button in the row, to the press itself. `src/shell/visningRing.ts` is the one
  entrance (`selectVisningAtom`) and W/S go through it too, so the keys, the
  pointer and the rail cannot disagree about what is up; stacking two Views is
  gone on purpose and composing images is `[Bilde ▾]` and `Oppsett`. Two
  earlier corrections to how that group *arrives*, both §10.1: a
  lokalitet opens with its **cover** on the ground when the cover is a View
  that has already been pinned (nothing else, and never a live render — the
  old empty-on-open rule left a place whose point is three readings of one
  rectangle showing none of them) — **provisionally**, since that image covers
  the rectangle every ground speaks about, so the first ground the user asks
  for withdraws it (`provisionalViewAtom`, and touching the group by hand
  spends the latch instead) — and **W/S walk that group** rather than the
  ground's dataset ring wherever there is a View to walk
  (`src/shell/visningRing.ts`, §5.3 — which is also why the four dataset
  pulldowns compose their `· W/S` heading instead of translating it).
  `[Bilde ▾]` (`src/shell/BildeControl.tsx`) is the same control minus
  the ground preset and minus the recreate, over the Files — checkboxes, since
  a File has no spec to enter and several at once is the point — and step 6, which
  built it, is where the whole pin mechanism went: `Vis i ruta`,
  `usePinnedBilde`, `BildeTransparency` on the rectangle, the fold/unfold
  restore, and the `Bilder` button's light, which four group labels answer
  better than one. Step 6 also made the rail stop being a map control at all —
  picking a frame moved the cursor and nothing else — and **that half is
  reversed**: pressing a card shows that card, by standing its own group on it
  (`selectBilde` in `useLocalityWorkspace`), and the cursor follows the map
  back whenever exactly one bilde is up, so W/S and the pulldowns keep the
  strip pointing at what is on the ground. The rule that survives is the one
  step 6 was actually for: the rail speaks the row's atoms and owns no pin, no
  fade and no depth order of its own, so several images at once is still the
  pulldowns' job — and nothing on the rail writes in `show`. A card still may
  not grow a *verb*; what it has is a press that means "show me this one" —
  which is also what **A/D** mean now (`src/localities/bilderRing.ts`, §5.3):
  the rail's ←/→ were borrowed from OpenLayers' pan, so it gets the letter keys
  every other list in the app is walked with, on the same `stripNavigable`
  gate and through the same `selectBilde`. That is the second ring the
  lokalitet takes off the ground, after W/S: inside a lokalitet the LiDAR style
  ring is the pulldown's, and its heading composes `· A/D` for the same reason
  the four dataset headings compose `· W/S`. E is untouched by both.
  Step 7 put the uploads in `[Bilde ▾]` without breaking that rule: an upload
  has no georeference, so `Plasser i ruta` on its card
  (`src/localities/uploadPlacement.ts`) gives the *record* an extent — the
  largest rectangle of the image's own aspect centred in the lokalitet's,
  written as `meta.bbox25833` with `meta.bboxAssumed: true` beside it and
  marked as assumed on every surface that shows it. That is a curation verb
  with a geometry in it, buffered into the edit transaction like a caption; the
  switch it earns is the row's. It is deliberately not *in* the row — §13.8's
  rule is that nothing in the layer row writes, which is why no group has a
  stance gate anywhere in it.
  Step 8 landed the arrangement as a record (`kind: 'scene'`,
  `src/localities/sceneSpec.ts`, migration `1700000800`, **no new field**):
  `over` is the membership and `meta` the order, the per-member fade and the
  ground under them. A scene is a member of *no* group — eligibility is `kind`
  and nothing claims `'scene'` — so it has no switch, cannot be put on the
  ground, and cannot contain another scene. Its two verbs are `Oppsett` on the
  row beside `Behold` (a write, buffered) and `Legg ut igjen` on its card (a
  read, both stances), and its pin is a flatten the queue composites out of the
  members' own ground pixels, captioned with the stack bottom to top. **A
  scene names its members twice**, in `over` and in `meta.layers`, so every
  place that re-mints ids — the commit, the copy — must translate both halves
  (`remapSceneMeta`).
  Step 9 finished the thread by widening `attachments.funn` — same column, no
  migration — from "what a sketch is about" to **which funn this bilde belongs
  to**, on every kind: `src/localities/funnGroups.ts` is the only reader
  (`funnIdOf` is also the single place a dangling id becomes "none", since the
  relation does not cascade), `BildeFunnPicker` on the bilde card is the
  editor, and `[Bilde ▾]` and `[Skisse ▾]` group their members under funn
  headings. The grouping is a **paint order**, not a sort — the grouped
  sequence reaches `setGroundOverlayStack` and `setSketchOverlays` — because
  position in a pulldown means depth. Three rules from steps 4–6 that hold
  across all of it:
  **opacity is a raster idea** — vector members get a switch and nothing else,
  and so does the ground preset, whose fade would be three fades and lives on
  the settings strip instead; **held is not withdrawn** — a group or preset
  switch that takes down a layer somebody else declared must hand it back
  unchanged, never reach for its producer; and the funn
  row's `EyeSplit` polarity (label opens, eye hides) is now row 1's alone, on
  `Kulturminner`.
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
  `docs/ui-architecture.md` §5.3. Four of the buttons are on ribbon row 1; the
  fifth, Terreng, is on the lokalitet row, because it reads a rectangle.
- **A dataset ring inside every ground** (W/S — cartographies, LiDAR projects,
  ortofoto acquisitions, terrain visualizations), plus **Sammenlign**, a
  draggable curtain holding two full grounds on screen in register — on the
  lokalitet row with Terreng, and torn down when the lokalitet closes —
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
  which a new lokalitet fetches for itself without being asked; **Behold**,
  one verb that keeps whatever ground is on screen at the source's own
  resolution; and **picker carousels** behind `Hent ▾`, where a batch of
  LiDAR readings or ortofoto acquisitions arrives as proposals to keep or
  discard one at a time rather than as saved records —
  `docs/ui-architecture.md` §10, §8.9.
- **Five Kulturminner theme layers** from Riksantikvaren with structured
  GetFeatureInfo, and `kulturminner2` reshapeable by register, render and
  vern subset — `docs/map-layers.md`, `docs/ui-architecture.md` §5.9.
- **The registers, answerable per point**: stedsnavn, kommune and
  matrikkel — `docs/map-layers.md`; the elevation readout
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
- **Lokaliteter**: an authored rectangle holding named *funn* drawn in
  Excalidraw over the frozen map, and *bilder* (extracts, terrain renders,
  screenshots, flyfoto, uploads, sketches, and arrangements of those).
  Making one needs an account; reading a `public` one does not — below, and
  `docs/ui-architecture.md` §8, §9.
- **Sketches — drawing *on* the ground rather than of it.** The same
  Excalidraw surface that makes a funn also makes a *tegning*: a transparent
  overlay registered to the lokalitet's rectangle, kept as a bilde of kind
  `sketch` and put back on the map as its own `ol/layer/Image`
  (`src/map/sketchOverlay.ts`, zIndex 2), so several can be shown at once over
  whatever ground is up. The scene is the spec — a sketch is a View, pinned to
  a figure PNG afterwards like any extract — and it can be re-opened and
  re-drawn. `src/funn/` is the surface: `session.ts` (what a drawing session
  is), `scene.ts`, `geometry.ts`, `render.ts`, `FunnCanvas.tsx`,
  `FunnSurface.tsx` — `docs/ui-architecture.md` §9, §9.3.
- **A shared lokalitet can be forked.** `Lag min kopi` carries the rectangle,
  the details, every funn and every View — as unpinned specs, so the pixels
  are made again on the other side — into a private lokalitet of your own with
  `derivedFrom` pointing back; the Files stay with the original and are shown
  at the end of the copy's carousel with one `Ta med` each —
  `docs/ui-architecture.md` §8.12.
- **And a lokalitet can be linked to.** `Del` in the row's `⋮` copies
  `/l/K7M2QX`; the open lokalitet rides along in the URL as `?lok=K7M2QX`,
  both directions owned by `src/localities/shareLink.ts`. The code is the key,
  so the short URL is a `redir` in our own `Caddyfile` rather than a service,
  and there is still **no SPA fallback** — the redirect is one narrow pattern,
  not a catch-all rewrite to `index.html`, so `/hjelp` is still 404 on a cold
  load exactly as it was. Following a link **opens the lokalitet, without
  asking for an account** — a `public` one is readable by a guest since
  migration `1700000900` — and always lands in `show`. Sign-in is offered in
  one place only, on the miss, where the visitor may be the owner of a private
  lokalitet signed out; that branch keeps the code so signing in retries it —
  `docs/ui-architecture.md` §8.13.
- **And handed over whole.** `Rapportpakke`, in the same `⋮`, zips the
  lokalitet into `<slug>-YYYY-MM-DD.zip`: an `index.html` and a `README.txt`
  carrying the register facts, the images inline in curated order and the funn
  as a table, then `bilder/NN-*`, `funn/funn.geojson` and `funn/funn.csv`. It
  forces a pin on every unpinned View first, because a bundle of parameter rows
  is not a report — and where it cannot (a reader may not write, a source
  retired an acquisition) it **names the missing bilder on the front page**
  rather than refusing the bundle. The zip writer is ours
  (`src/shared/utils/zip.ts`, stored not deflated) for the `dem.ts` reason: no
  new dependency — `docs/ui-architecture.md` §8.14.
- **A View is a spec before it is pixels.** An extract, terrain render,
  flyfoto grab or sketch is stored as a row of parameters and rendered into a
  figure PNG afterwards by a background queue (`src/localities/pinQueue.ts`); a
  screenshot or an upload is only ever bytes — `docs/ui-architecture.md`
  §8.7.4.
- **Editing a lokalitet is a transaction, and it ends when you say so.**
  Nothing typed, drawn or curated in edit reaches PocketBase until `Lagre`;
  `Avbryt` throws it away, and the buffer survives a crash via `localStorage`.
  Both are about the *buffer* and neither leaves the stance — `Avslutt` is the
  one exit, and over unsaved work it asks. Three writes are outside the
  transaction: the two confirmed deletions (the lokalitet itself, and a bilde)
  and the starter set, which is the tail of `Opprett` — `docs/ui-architecture.md`
  §8.11, §8.9.1.
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
  Riksantikvaren, matrikkel, NiB, hoydedata), plus Kulturminnesøk's record
  API, which is not a map source — it answers whether the link Riksantikvaren
  puts on a heritage feature goes anywhere. Caddy exposes each upstream
  under a same-origin prefix (`/wms/geonorge/…`, `/wms/ra/…`, `/wms/nib/…`,
  `/arcgis/nib/…`, `/arcgis/hoydedata/…`, `/kms/…`). Rules, cache lifetimes
  and verification commands: `docs/wms-proxy-and-tiles.md`.

## Terrenganalyse (client-side relief from float DEMs)

"Terreng" fetches the **raw float elevation grid** for a rectangle and computes
its own relief visualizations in the browser, instead of restyling Kartverket's
pre-baked hillshade. Rationale and endpoint details: `docs/terrain-analysis.md`.

**One entrance, and it is a lokalitet.** The rectangle analysed is always the
open lokalitet's bbox, the button is on the lokalitet row beside Sammenlign,
and digit `5` still selects it. Pressing Terreng with nothing open **places**
the lokalitet — a rectangle proposed exactly as "Ny lokalitet" proposes one,
and Terreng entered in the record `Opprett` makes — or raises the sign-in
dialog.

That reverses an older rule here, *"reading the ground is not an act of
ownership"*, and the reversal is deliberate. **Computing relief now requires an
account.** What it buys is one rectangle instead of two and one save path
instead of two: the standalone entrance was a free-floating bbox plus a `Lagre`
that could create a lokalitet nobody had asked for, and two controls for one
surface is the failure `docs/ui-architecture.md` §1 is about. The narrower
principle that replaces it is *reading is not writing* — Terreng and Sammenlign
are on the lokalitet row in **both** stances and available to a reader in full;
only their exits escalate.

So **the terrain strip carries no actions at all**. Keeping the render is
`Behold` on the lokalitet row — one verb for whatever ground is up, gated on the
same `canAdd` as every other write (`docs/ui-architecture.md` §8.9.2) — and
the rectangle belongs to "Juster området". `useTerrainAnalysis` publishes
`describe()` and a `beholdKey` for that, and holds no write of its own; the
pixels are made later by the pin queue (see below).

Entering it over a lokalitet **seeds the knobs from that lokalitet's cover
terrain render**, once per lokalitet, so coming back to a place opens on the
light that showed the feature rather than on the module defaults. Details and
the reason the seed can't step on a recreate — which a W/S step in `[Visning ▾]`
can now be: `docs/ui-architecture.md` §10.

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
  `TerrainStrip.tsx` is its whole settings strip, `TerrainVisPicker.tsx` the
  visualization pulldown on it, and `TerrainSliders.tsx` the inline slider
  group beside that — one strip, not a strip plus a row of knobs, since a
  slider laid out as label · track · readout fits the line it is on.
  Terreng is one of the five grounds, so its modifiers
  belong where every other ground's are — a column down the side of the map
  covered the terrain the knobs were describing. The button itself is on the
  lokalitet row; what it needs from `useGroundMode` (which stays mounted once,
  in row 1, because a second mount means a second DEM) crosses the sibling gap
  on `groundHandleAtom` (`src/shell/groundHandle.ts`). The analysed rectangle
  is `locality && tool === 'terrain' ? locality.bbox : null` — read off the
  record rather than copied, which is what makes "Juster området" refetch the
  DEM for free. Output saves as an attachment of the existing `extract` kind
  (with `style` = the visualization), so no PocketBase migration was needed.
- `src/map/groundOverlay.ts` — the render goes **on the map**, as a
  georeferenced `ol/layer/Image` (`ImageCanvasSource`, `zIndex: 1`) over the
  background and under the Kulturminner layers, not as a thumbnail in the
  ribbon. Reading relief *against* the heritage record is the whole point, so
  the relief has to be the ground. Imperative and module-level like
  `swapBackgroundLayers` — the pixels change every slider frame and no React
  component needs to see that.
- **That level is a stack, and anyone may be in it**: the live terrain render
  at the bottom, every View switched on in `[Visning ▾]`
  (`src/shell/VisningControl.tsx`) above it, and every File switched on in
  `[Bilde ▾]` (`src/shell/BildeControl.tsx`) above those. It used to be one
  slot with an arbiter making two features take turns; that is deleted
  (`docs/lokalitet-view.md` §13), because it forbade the one comparison the
  overlay exists for. **Producers declare, the layer row orders**:
  `setGroundOverlay(key, member | null)` takes any string key, and
  `setGroundOverlayStack(group, keys, held)` — called once per group, by the
  two controls above — says what order that group's keys paint in and which of
  them are held down. A key nobody ordered paints above everything that was.
  The *groups* are ordered by `GROUP_ORDER`, a constant in the module rather
  than a third caller above both controls: they are siblings on the lokalitet
  row with no component between them, and their relative order never changes.
  The module paints them bottom-to-top
  into **one layer and one canvas**, each with its own `globalAlpha`. One layer
  rather than one per member: the members are an ordered composite with
  per-member opacity, and the reused output canvas is ~30 MB. The compare
  curtain (`COMPARE_Z = 1.5`) covers the whole group, which is what it is for.
  Two rules the row rests on: **held is not withdrawn** — holding a member
  down never touches the producer that declared it, so switching the group
  back on gives it back unchanged — and `opacityByKey` is **never pruned**,
  because a member's fade has to outlive its member.

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
- **`computeHorizonFields` buys its reach by decimating, not by walking
  further.** The ray walk is width × height × directions × steps, so the step
  budget is fixed at `SVF_MAX_RADIUS_PX` (24); what used to make that a limit
  in *metres* was scanning the DEM at its own cell size, which put the horizon
  at 6 m on a 0.25 m grid — shorter than the mounds the tool is pointed at.
  Now `horizonDecimation` averages the grid down to no coarser than
  `HORIZON_MIN_M_PER_PX` (1 m) when the requested radius asks for it, scans
  that, and interpolates the three fields back, so the ceiling is a flat 24 m
  on any grid at 1 m or finer (`horizonMaxRadiusMetres`) and the pass is
  factor² cheaper besides. Two consequences: the horizon views are read off a
  coarser surface than the hillshade beside them, which `figure.set.horizonGrid`
  prints when it happens; and a requested radius and an effective one can still
  differ, so everything that renders or *describes* a render goes through
  `clampRadius` (`render.ts`) and `radiusRange` derives the slider's ceiling
  from the same rule. Skipping that puts "SVF-radius 40 m" on the caption of a
  24 m render, which is the one thing `src/figure/` exists to prevent.

## Lokaliteter (user content)

The top-level user object is **an area to explore**, not a claim that
something is there — mirroring Riksantikvaren's lokalitet → enkeltminne
hierarchy. A lokalitet is an authored rectangle — proposed from the visible map,
then moved and sized by hand before anything is written, and resizable
afterwards — holding *funn* (individually named and addressable drawn features)
and *bilder* (kept LiDAR extracts, terrain renders, map screenshots, flyfoto,
uploads, sketches, and *oppsett* — an arrangement of the others, kept as a
record of itself). It is bounded to **50–1500 m per side**, a band read off what the
producers can actually render (`src/localities/bboxLimits.ts`,
`docs/ui-architecture.md` §5.6).

Two rules that hold regardless of what the interface looks like:

- **Authorship is behind sign-in; reading a `public` lokalitet is not.** The
  create, update and delete rules all require `@request.auth.id != ""` and
  ownership, and nothing about that has moved. The *read* rules opened up in
  `1700000900` so a shared link resolves for a guest (`docs/ui-architecture.md`
  §8.13), which also means `attachments.file` is no longer `protected` — a
  private lokalitet's images are unreachable because nobody can read the
  record that names them, not because a rule guards the bytes. Anything
  `private` or `limited` still requires being its owner. The map itself stays
  publicly browsable, and a signed-out visitor is shown no register: the
  rectangle layer draws the one lokalitet a link resolved and never lists.
- `limited` visibility is a placeholder that behaves as `private` until
  groups exist.

The ribbon rows, the funn list in its popover on the lokalitet row, the bottom
edge the bilder live on — one rail in both stances, read-only in show and with
the write verbs and drag-to-reorder in edit (`docs/ui-architecture.md` §8.7.2)
— the drawing surface and the policy
decisions around them (bbox is authored not derived, only seeded from the
viewport; drawing and extract exist only inside a lokalitet; measure and
terrain analysis stay global) are in `docs/ui-architecture.md`.

Key files (data side):

- `src/api/pocketbase.ts` — singleton PB client (`pocketbaseUrl` from env,
  defaults `/pb`).
- `src/api/localities.ts`, `localityFinds.ts`, `attachments.ts` — CRUD +
  realtime per collection. Attachment files are served by the collection's
  own rules since `1700000900`, so `getAttachmentUrl` is a synchronous string
  build with no file token behind it. `createAttachmentSpec` writes
  a fileless View row and `pinAttachment` puts the figure on it later.
- `src/localities/pinQueue.ts` — the pinner: turns a stored spec into a
  provenance figure and PATCHes it onto the record. Module-level and
  imperative, like `map/groundOverlay.ts`. Everything it waits on is on a
  clock — `src/shared/utils/deadline.ts` bounds each request and each whole
  render, because one stalled `fetch` would park the single worker and leave
  every card behind it spinning.
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
  `.hidden`, and `attachments.file` relaxed to optional), `1700000600`
  raises `attachments.file` to 50 MB, `1700000700` adds the `sketch`
  attachment kind together with `attachments.funn` and `.over` (both
  uncascaded relations) and raises `attachments.meta` to 2 MB so a sketch
  can carry its scene, `1700000800` adds the `scene` attachment kind and
  **nothing else** — an arrangement reuses the `over` relation and the 2 MB
  `meta` that one added — and `1700000900` opens `public` to guests: the
  list/view rules on all three collections drop their auth requirement for
  the public branch, and `attachments.file` stops being `protected` so the
  images come with it. **Leave the
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
  EPSG:4326 — curves are sampled on the way in, so an ellipse is stored as a
  64-gon and stays one; the record never knew it had been a curve).
- **`attachments`** — `locality`, `owner`, `kind` (extract | screenshot |
  upload | flyfoto | sketch | scene), `file` (≤50 MB, png/jpeg/webp,
  thumbs, and
  **optional** — a View is a spec before it is pixels), `caption`, `meta`
  (json, ≤2 MB: source key/label, style, model, metresPerPx, `bbox25833`,
  `imageRect`, `renderedAt`, `bboxAssumed` on a placed upload, for a
  sketch the Excalidraw scene itself, and for a scene its layer order, their
  fades and the ground under them),
  `funn` and `over` (uncascaded relations → finds and → attachments: which
  funn this bilde belongs to, on every kind and editable since §13.10 step 9,
  and which bilder a sketch is a layer on — on a scene, which
  bilder it is an arrangement *of*), `sort` and `hidden`
  for exhibit order and concealment. `funn` is read only through
  `src/localities/funnGroups.ts`, because the relation does not cascade and an
  id that no longer names a funn has to read as "none" everywhere at once.

**Views and Files.** `kind` decides which: `extract`, `flyfoto`, `sketch` and
`scene` are **Views** — producible from the record's own parameters, so they are written as
a spec (`createAttachmentSpec`, `meta` only) and the figure PNG is pinned onto
them afterwards by `src/localities/pinQueue.ts`. `screenshot` and `upload` are
**Files**: bytes, with nothing behind them that could make the bytes again.
There is no `spec` field and no `isView` field — a flag that can disagree with
`kind` eventually will. The queue is module-level and React-free on purpose
(it has to outlive the surface that started it), runs one job at a time
against Kartverket's rate limit, renders the *spec's* rectangle rather than the
lokalitet's current one, and only ever runs for `canAdd` — a pin is an `update`
and nothing in show writes. Rationale, states and the two forced-pin call sites:
`docs/ui-architecture.md` §8.7.4.

Rules (server-enforced by PB), same shape on all three:

- read: it (or its lokalitet) is public — **no account needed** — or else
  signed in and (own it, or `@request.auth.role = "admin"`)
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
session, i.e. one whose rectangle was just placed and committed with `Opprett`,
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
- `renderFigureBlob` **fits the image to the store before captioning it** —
  40 Mpx, with 50 MB (the field's ceiling) as a re-encode backstop — and
  returns the resolution it actually wrote. Callers record *that* in
  `meta.metresPerPx`; scaling anywhere the caption cannot see it puts a m/px
  and a scale bar on the figure that its own pixels contradict.
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
