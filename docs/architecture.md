# Architecture

The modules, the Jotai atoms they own, the two-ground mechanism, the URL, and
the band that hosts the controls.

Related: `docs/map-layers.md` (what is drawn), `docs/terrain-analysis.md`
(elevation and the visualizations), `docs/wms-proxy-and-tiles.md` (the request
path).

## Module map

One row per directory under `src/`.

| Directory | Owns |
| --- | --- |
| `api/` | PocketBase singleton (`pocketbase.ts`) and the `spots` and `evidence` collection clients. |
| `auth/` | OAuth2 dialog, the account menu (with the admin-only links to `/stats/` and PocketBase's dashboard), and `currentUserAtom` mirrored off the SDK's `authStore`. |
| `evidence/` | Keeping a reading of a spot's ground: the offer the map is making, the spec that survives it, the producers, the serial render queue, the gallery, the strip that puts the kept renders in order, and the reader that lays them back on the map. |
| `flyfotoControls/` | The Flyfoto arm: which Norge i bilder acquisition, and its era grouping. |
| `grounds/` | The ground switch. Which ground is up is derived from the half's background layer, never stored. |
| `heritageControls/` | The Kulturminner tool: which theme layers are ticked and how they are drawn. |
| `heritageInfo/` | The pointer tip and the click-kept card over heritage features, plus the OL overlay they ride. |
| `kartControls/` | The Kart arm: which cartography. |
| `lidarControls/` | The LiDAR arm: dataset menu, render, DTM/DOM, Automatisk, hybrid overlay and contours. |
| `lidarExtract/` | LiDAR tile planning, fetching and stitching. `stitch.ts` serves the DEM fetch, `run.ts` and `sources.ts` the LiDAR evidence render. |
| `locales/` | i18next JSON, one directory per language. |
| `map/` | The OpenLayers map and everything attached to it: layer configuration and stacks, the compare halves and the split pane, feature info, projections, the rectangle-placing interaction, the footprint and pin and hint layers. |
| `ribbon/` | The top band: its three sections and the upstream status light. Layout only. |
| `search/` | Kartverket place, address, road, property and elevation lookups. One function has a live caller. |
| `shared/` | Error boundary, URL parameter access, coordinate parsing, enum and number helpers, and the request deadline that reports to the breaker. |
| `sketch/` | Excalidraw over a frozen map: the georeferencing frame, the scene, the pen, and the render onto the ground. |
| `spotControls/` | The reader's records as surfaces: the `+`, the editor, the read card, the index menu. |
| `spots/` | Spot state and geometry: the pin layer and its style, the footprint frame, hit test, place and adjust, share link, name suggestion. |
| `terrain/` | Client-side terrain analysis: DEM fetch, shading, the analysis window and its layers. |
| `terrainControls/` | The terrain toggle and its panel. |
| `types/` | Search response types. |
| `ui/` | The kit: `ControlChip`, `ControlButton`, `ControlUnit`, `Panel`, `Hint`, `Icon`, the Mantine theme, `useConfirm`. |
| `upstream/` | Per-origin circuit breaker, the origin registry, and the tile guard that reports to it. |
| `viewControls/` | The view-mode control: one ground, the curtain, or the split. |

## State (Jotai atoms)

A `Halves` suffix means a pair (see below). Each pair's `live*` sibling is
`acrossHalves(pair)`, read-only.

| Atom | Module | Is |
| --- | --- | --- |
| `mapAtom` | `map/atoms.ts` | The main OpenLayers `Map`, built on first read. |
| `viewModeAtom` | `map/compare/halves.ts` | `single`, `curtain` or `split`. `compareOnAtom` is the derived "not `single`". |
| `selectViewModeAtom` | `map/compare/atoms.ts` | Write-only: changes the view mode and seeds B on the way out of `single`. |
| `compareSplitAtom` | same | Where the curtain's edge sits, as a fraction of map width. |
| `backgroundLayerHalves` (+ `liveBackgroundLayersAtom`) | `…/backgroundLayers/atoms.ts` | Which ground that half is drawing. |
| `hybridOverlayHalves`, `hybridContoursHalves` | same | Kartverket's transparent overlay, and its contours. |
| `backgroundLayerCapabilitiesCacheAtom` | same | GetCapabilities documents, keyed by URL. |
| `kartVariantHalves` | `…/kartVariants.ts` | Which cartography the half returns to. |
| `activeLidarProjectHalves` (+ `liveLidarProjectsAtom`) | `…/lidarProjects.ts` | The per-project LiDAR flight; null is the national mosaic. |
| `activeLidarStyleHalves`, `activeLidarModelHalves` | same | The picked render, and DTM or DOM. |
| `lidarAutoDatasetHalves` (+ `liveLidarAutoAtom`) | `…/lidarAuto.ts` | Pick the dataset from the viewport. |
| `lidarViewportAtom` | `…/lidarRelevance.ts` | The flights over the viewport, bucketed primary/secondary, with a status. |
| `lidarFilterSettingsAtom` | same | The year and coverage bars that split primary from secondary. |
| `lidarPickerOpenHalves` (+ `livePickerOpenAtom`) | same | That half's dataset pulldown is open. |
| `lidarCyclingAtom` | same | Datasets are being cycled: same WFS fetch, no polygons. |
| `hoveredLidarProjectIdAtom` | same | The dataset row under the pointer, so its footprint lights. |
| `activeCvatAcquisitionHalves` | `…/cvatGround.ts` | Our own cached VAT render. |
| `activeFlyfotoProjectHalves` | `…/flyfotoBackground.ts` | One NiB acquisition. |
| `activeThemeLayersAtom` | `map/layers/atoms.ts` | Which Kulturminner layers are ticked. |
| `heritageDetailsAtom`, `heritageRenderAtom`, `heritageOpacityAtom` | `map/layers/heritage.ts` | How they are drawn. |
| `heritageHiddenAtom` | same | A blind: hides them without unticking the sources. Not URL-persisted. |
| `heritageTipAtom`, `heritagePopupAtom` | `map/featureInfo/atoms.ts` | What the pointer found, and what a click kept. |
| `terrainWindowAtom` | `terrain/window.ts` | The rectangle under analysis; null is the analysis being off. |
| `terrainAdjustingAtom` | same | It is still being placed, so nothing is fetched yet. |
| `open`/`adjust`/`closeTerrainWindowAtom` | same | Write-only. |
| `spotPlacingAtom` | `spots/atoms.ts` | The `+` is armed: the next map click places the pin. Exclusive with `spotDraftAtom`. |
| `spotDraftAtom`, `spotFormAtom`, `spotSketchAtom`, `spotFootprintAtom` | same | The record being written: where its pin is and which stage has the pointer, what has been typed, what has been drawn, and the ground it names. |
| `spotFootprintAdjustingAtom`, `shownSpotFootprintAtom` | same | Derived: the draft is in its `footprint` stage, and which rectangle the standing frame draws. |
| `clearSpotFootprintAtom` | same | Write-only. |
| `place`/`edit`/`closeSpotDraftAtom`, `setSpotStageAtom` | same | Write-only. |
| `activeSpotAtom` | same | The record being read — opened by a click, by an index row, or by `?lok=`. |
| `spotReadingAtom` | same | The open spot's kept renders are being read on the map. Held as the id it was entered on, so closing the spot, opening another or starting a draft ends it. |
| `spotRecordsAtom`, `spotsFailedAtom` | `spots/spotRecords.ts` | Every record the session may see, null until the list lands; and whether it never did. |
| `mySpotsAtom` | same | Derived: the reader's own, newest change first. |
| `terrainOfferAtom` | `evidence/offer.ts` | What the terrain analysis would keep, published by `useTerrainControls` because its settings are component state. |
| `keepOffersAtom` | same | Derived: the ground's offer (off the A half) and the terrain's, ground first. |
| `draftGroundAtom` | `evidence/draftGround.ts` | The kept render laid under an open draft: the picture being framed against and drawn over. Published by the strip, which is the only thing holding the rows. |
| `readerLayoutAtom` | `evidence/readerWindow.ts` | Which way round the reading box is laid out, and beside it where it was dragged to, how big it may get and which wall it is docked against. Outside the component, which remounts per spot. |
| `sketchSessionAtom` | `sketch/session.ts` | Non-null exactly while the map is frozen and Excalidraw has it. |
| `sketchShownAtom`, `sketchFadeAtom` | `sketch/overlay.ts` | Whether the open spot's drawing is on the ground, and how far it is faded towards it. A reading setting, not the record's: they outlive the spot the box was opened on. |
| `currentUserAtom` | `auth/atoms.ts` | Who is signed in. Written only by `pbAuthSyncEffect`. |
| `isSignedInAtom`, `isAdminAtom` | same | Derived, so a component does not re-render on an unrelated user field. |
| `isAuthDialogOpenAtom`, `authPromptAtom` | same | Whether the dialog is up, and why when the reader did not press anything. |
| `upstreamHealthAtom` | `upstream/health.ts` | One breaker status per origin. |

## Two grounds (the halves mechanism)

Every ground atom is a **pair**, made by `halved()` in
`src/map/compare/halves.ts`: an `.a` and a `.b`. `.a` is the left pane, and the
whole screen while one ground is up. There is no facade over the pair and no
notion of focus — a surface names the half it is driving, and the band mounts a
ground section per half that is drawing. `acrossHalves(pair)` returns that
pair's values for every live half, in a fixed order, so two of them can be
zipped — for surfaces that belong to the map rather than to a half.

**Reach for the arm's controller, not the atom.** Each half of
`backgroundLayerHalves` has three writers, one per arm, because writing the
ground alone is not enough:

- On a LiDAR flight the ground's *name* is a function of the render
  (`lidarFlightGround`), so `useLidarControls` writes the style and the name
  together.
- On Kart the name must also land in `kartVariantHalves`, or the ground is
  forgotten the moment you leave it.
- On Flyfoto the acquisition travels with the name.

### View modes

| `viewModeAtom` | Is |
| --- | --- |
| `single` | One ground over the whole map. |
| `curtain` | Two grounds in one viewport, B clipped to the right of a draggable edge. |
| `split` | Two viewports side by side on one shared `View`, so the centre of each half is the same point. |

The split is two OpenLayers maps sharing one `View` **object**, not two views
kept in step. The second map is `compare/splitMap.ts`, a lazy module singleton;
`peekSplitMap()` answers "is there one" without making one, which is what lets
the tile guard and the theme-layer effect walk whatever maps exist.

### Building the B stack

- B's layers carry a `cmp.` prefix and go into whichever map the view mode names
  (`compareHostFor`). An OL layer belongs to one map at a time, so a change of
  view resolves the B stack afresh in the new host; the reuse signature is
  namespaced too, so A and B never share an instance.
- The map the host is *not* is emptied **before** the build
  (`clearCompareLayersExcept`): a build can end without installing and leave the
  previous view drawing. Emptying retires layers into the pool, so the new
  host's build takes back the instances the old host just gave up.
- Entering a two-ground view seeds every `.b` from its `.a` (`seedHalfB`, a
  registry `halved()` appends to rather than a list, so a pair added later
  cannot open B on a `null`), then moves B off A onto whichever of relief and
  cartography A is not, with Automatisk off. B enters LiDAR on the national
  mosaic, not the flight the half is holding. Moving between the curtain and the
  split leaves B where the reader put it.

### Mirrored into pane B, and not

| Mirrored | Not |
| --- | --- |
| Kulturminner theme layers (`syncThemeLayers`, called once per map) | The heritage tip and card |
| LiDAR footprints, split rather than mirrored — one viewport query, a layer per pane drawing that pane's own flight (`footprintTargets`) | The terrain analysis, frame and render both |

## The pictures of a spot

A spot's `evidence` rows are a sequence, not a set. `sort` is an ordering key in
epoch milliseconds, so a row lands last by being created, and the strip in the
editor (`src/evidence/EvidenceStrip.tsx`) is where that order is changed.
On the card the same rows are a gallery, because reading them is flipping
through them and editing them is deciding what they are a sequence of.

- **The cover is the first row with pixels.** Nothing marks one: the reading
  opens on the first row it can lay on the ground, so dragging a picture to the
  top is how a cover is chosen, and the star says which one is.
- A drop writes one row. `sortForMove` (`evidence/order.ts`) takes the midpoint
  between the row's new neighbours, so nothing else moves; a row dropped last
  takes the current time instead, or a picture kept a moment later would sort
  in front of it. The write is optimistic and puts the row back on a refusal.
- The rows are one height, so a drag measures every slot's middle once at the
  press and then takes the nearest one to the pointer: the preview moves rows
  between slots, and the slots themselves do not move. The handle answers ↑ and
  ↓ too, and stops the press reaching OpenLayers' keyboard pan.
- Pictures are their own records, so reordering — like keeping and deleting —
  is written when it happens, not by the draft's save button.
- **Clicking a picture lays it on the map**, opaque, through `draftGroundAtom`
  and the same `useEvidenceOverlay` the reader uses, driven from `SpotSurface`.
  That is the ground the pen draws over, and it rides the map element, so a
  sketch session's transform carries it along.
- Entering the draw stage with a picture chosen fits the view to that picture's
  own rectangle before `captureFrame`, so the frame holds the ground the
  picture does and the strokes register to every other picture of the spot as
  well. Strokes already made keep their own frame — nothing may move it.
  Switching pictures inside a session swaps the overlay and leaves the frame
  alone, which is the whole point: every row covers the same rectangle.

## Reading a spot

Every row of evidence covers the same rectangle — the spot's footprint, as
`meta.bbox25833` records it — so a spot's kept renders are registered to one
another. The reader (`src/evidence/EvidenceReader.tsx`) is what that buys: it
stands in for the card, fits the map to the footprint, and lays one kept render
at a time back on the ground it was made over (`evidenceOverlay.ts`). Flipping
holds the ground still and changes only how it was seen.

- The overlay is at z 1.25: over the terrain render, **under the B half**, so a
  curtain reads a kept render against a live ground. The transparency slider
  does the same against A.
- The outgoing picture comes off only once the incoming one has pixels. A blink
  between two readings of the same ground would make the comparison worthless.
- Arrow keys flip. `keyboardEventTarget` is the document (`map/atoms.ts`), so
  the listener is in the capture phase — OpenLayers' own keyboard pan would
  otherwise answer the same press.
- The drawing sits above the pictures at z 2, so `SketchFade` (`src/sketch/`)
  takes it off the ground or part of the way off it, and **`t`** — tegning —
  toggles it. The shortcut is bound by `useSketchOverlay`, not by a box, so it
  answers from the card as well; it is inert while Excalidraw has the map, and
  it keeps its hands off a press aimed at an input.
- A row whose render has not landed, or that has no rectangle, is not part of
  the reading; the gallery on the card is where it is waited on. A reading with
  nothing left in it steps back to the card.
- `/l/<code>` opens the reading rather than the card: a link is an invitation to
  read. The view move is the reader's then, and `shareLink.ts` keeps its hands
  off. The code goes back onto the URL for whatever spot is open, so a reload
  lands in the reading too.
- Because the reading stands in for the card, it carries the card's edit button
  as well, on the same `mayEdit` (`src/spots/mayEdit.ts`). Otherwise the only
  way to an owner's own edit is a close that reads as leaving the spot. A draft
  opened from the reading returns to it: `editSpotDraftAtom` leaves
  `readingSpotIdAtom` alone, and `spotReadingAtom` is false only for as long as
  the draft is up.

The box floats (`src/evidence/readerWindow.ts`). It is dragged by its title row
and resized from the corner grip, and it has two layouts: `wide`, a bar along
an edge, and `tall`, a column down one. Both live in atoms outside the
component, because the reader is keyed on the spot and remounts when another is
opened.

- **Nothing gives the box a size.** It is `width: max-content` under ceilings,
  so it shrink-wraps its content in both axes: a reading of three pictures with
  no prose gets a box that small. The ceilings are the layout's own — 46rem by
  60 % for the bar, 23rem by the full height for the column — and the grip is
  the only thing that ever sets another. It therefore only ever makes the box
  *smaller* than its content, which is what it is for, since the prose and the
  strip scroll.
- Until the box has been moved or resized the layout's own CSS places it too.
  The first gesture takes over with an inline corner, and `.placed` switches
  the CSS anchors off; choosing a layout drops the placement again, which is
  also the way back from a box left somewhere unhelpful.
- **Pushing a box through a wall docks it there**: flush at the gutter, in the
  shape that wall asks for. The shape is as much of the dock as the anchor is —
  down the side is a column, along the top or the bottom a bar — and the layout
  is what makes a column narrow, so a dock carries no ceiling of its own and
  drops any the grip had set. A side dock pins the top corner; a top or bottom
  dock keeps the run it was dragged to, so it does not slide sideways under the
  hand that put it there.
- The dock is why a dragged box is *not* clamped: crossing a wall is the ask,
  and the dock puts the box back inside the map, so nothing ever ends up off
  it. Everything else is clamped — a resize, a window resized under the box,
  and the pass on mount that catches a window resized between two readings.
  What is measured for all of that is the box as drawn, not the ceiling, which
  may be higher than the content needs.
- The caption rides in the footer between the flip buttons and the transparency
  slider rather than on a line of its own: in the bar layout that slack is the
  only thing there was to put there.
- The fit on entering the reading pads for the layout the box opens in, and
  never runs again: a box moved out of the way afterwards must not move the map
  with it.
- `Panel` grew `handle` and `actions` for this. Folding is off — moving,
  resizing, docking and closing are enough ways to stop covering something.

## URL parameters

`UrlParameter`, `src/shared/utils/urlUtils.ts`: `lok`, `projection`,
`backgroundLayer`, `hybrid`, `contours`, `lidarModel`, `themeLayers`,
`heritageDetails`, `heritageRender`, `heritageOpacity`, `lat`, `lon`, `zoom`.

`lok` is the only one naming a record rather than a setting: the spot's
six-character code, written by whatever record is open and read once at import
(`src/spots/shareLink.ts`).

**The A half is what the URL describes.** The view mode and everything in B are
session state, so a shared link opens on one ground.

## Ribbon and the UI kit

`Ribbon.tsx` is layout and nothing else:

```
GroundSection half="a"  →  ViewSection  →  [GroundSection half="b"]  →  ToolSection
```

The second ground section mounts only while two grounds are up. `ToolSection`
holds the controls that apply whichever ground is up — Kulturminner, terrain,
the spot `+` and its index, the account — with `UpstreamStatus` last, because it
comes and goes on its own.

**Which section a new control goes in is a question about the control, never
about where there is room.** A control that means something different per ground
belongs to an arm; one that applies to the reading belongs to the tools.

- Every arm takes a controller object (`useLidarControls(half)` and friends) and
  owns no atoms of its own. All three controllers mount whichever arm is
  showing: each remembers something across a visit to another ground.
- `ControlChip` is the labelled box that opens something — icon, label, hint,
  chevron. `ControlButton` is the square icon toggle, optionally split into two
  lit halves.
- Shared metrics: `--control-height` and `--control-icon-width` in
  `src/index.css`.
- `ControlUnit` laps its children into one seam-free box, styling them **by
  position** (`:not(:first-child)`, `:not(:last-child)`) rather than by class.
  Children must be single boxes, not nested units. A component contributing more
  than one box hands them up in a Fragment — see `HybridToggle`, whose contour
  button exists only while the overlay is on.
- `Panel`'s contract: `onClose` absent means the box has no close of its own
  because something else takes it down; `unsaved` puts the close behind
  `useConfirm`; `handle` makes the title row a drag handle and `actions` puts
  buttons in it, which is what a floating box needs of the shell and all of it
  — the frame itself belongs to the caller.
- `Hint` floats a tip beside the surface it is about, on a Mantine `Popover`
  anchored to whatever child takes a ref — `Panel` does. `tips` is a list of
  lines the caller has already filtered to what applies there, and an empty one
  means no tip; the wrapper stays in the tree either way, because
  `Popover.Target` clones its child and dropping it would remount the surface.
  Waving a tip off puts it away for the page load, ticking the box writes its id
  to `hintsDismissed.v1` in localStorage. Ids live in the `HINT_IDS` list in
  `src/ui/hints.ts`; one that leaves the list is dropped on read. One id per
  surface, not per key: `spotKeys` on `SpotCard` says what `T` does, and
  `readingKeys` on `EvidenceReader` says that and what the arrows do, because a
  share link opens the reading and the card is never seen.

## Known gaps

- **`lidarCyclingAtom` has a reader and no writer.** `lidarFootprintsLayer`
  keeps the viewport list warm while datasets are cycled; nothing walks the
  flight rings.
- **The second pane is looked at, not asked.** The heritage tip and card
  (`src/heritageInfo/`) and the terrain analysis read `mapAtom` and never
  `peekSplitMap`, so they answer for the main map only.
- **There is no search box.** `src/search/searchApi.ts` and
  `src/types/searchTypes.ts` are mostly the tail of a deleted surface; one
  function, `getPlaceNamesByLocation`, has a live caller (`spots/spotName.ts`).
  Kept as they are.
- **The spot index is your own records only.** `SpotMenu` is a Mantine `Menu`
  ordered by date with no hover-to-light-the-pin: enough for a few dozen
  records, not a few hundred.
- **Evidence files are unprotected.** A public spot is readable with no
  account and a guest can hold no PocketBase file token, so `evidence.file` is
  served to anyone holding the URL. The same trade the old
  `1700000900_public_guest_reads.js` recorded.
- **A render is not a cache.** Upstreams re-fly and reprocess, so the same spec
  re-rendered later may not be the picture its author read. `meta.renderedAt`
  says when the file was made; nothing re-renders on its own.
- **Evidence never meets the sketch.** Excalidraw's image tool stays off
  (`sketch/SketchCanvas.tsx`): a PNG dropped into the scene would be stored
  inside the drawing, against the 5 MB `sketch` cap, where nothing can see it.
- **Only `nb` is a live locale.** `nn` and `en` are stubs.
- **There is no SPA route but `/`.** `/l/<code>` is a narrow Caddy `redir` to
  `/?lok=<code>`; there is no `try_files` fallback, which would turn every wrong
  path into a 200.
- **PocketBase still carries `localities`, `finds` and `attachments`.** Nothing
  reads them; they are deliberately left on disk.
