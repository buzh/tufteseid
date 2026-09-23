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
| `api/` | PocketBase singleton (`pocketbase.ts`) and the `spots` collection client. |
| `auth/` | OAuth2 dialog, the sign-in button, and `currentUserAtom` mirrored off the SDK's `authStore`. |
| `flyfotoControls/` | The Flyfoto arm: which Norge i bilder acquisition, and its era grouping. |
| `grounds/` | The ground switch. Which ground is up is derived from the half's background layer, never stored. |
| `heritageControls/` | The Kulturminner tool: which theme layers are ticked and how they are drawn. |
| `heritageInfo/` | The pointer tip and the click-kept card over heritage features, plus the OL overlay they ride. |
| `kartControls/` | The Kart arm: which cartography. |
| `lidarControls/` | The LiDAR arm: dataset menu, render, DTM/DOM, Automatisk, hybrid overlay and contours. |
| `lidarExtract/` | Headless LiDAR tile planning, fetching and stitching. Only `stitch.ts` has a live caller. |
| `locales/` | i18next JSON, one directory per language. |
| `map/` | The OpenLayers map and everything attached to it: layer configuration and stacks, the compare halves and the split pane, feature info, projections, the footprint and pin and hint layers. |
| `ribbon/` | The top band: its three sections and the upstream status light. Layout only. |
| `search/` | Kartverket place, address, road, property and elevation lookups. One function has a live caller. |
| `shared/` | Error boundary, URL parameter access, coordinate parsing, enum and number helpers, and the request deadline that reports to the breaker. |
| `sketch/` | Excalidraw over a frozen map: the georeferencing frame, the scene, the pen, and the render onto the ground. |
| `spotControls/` | The reader's records as surfaces: the `+`, the draft panel, the read card, the index menu. |
| `spots/` | Spot state and geometry: the pin layer and its style, hit test, place and adjust, share link, name suggestion. |
| `terrain/` | Client-side terrain analysis: DEM fetch, shading, the analysis window and its layers. |
| `terrainControls/` | The terrain toggle and its panel. |
| `types/` | Search response types. |
| `ui/` | The kit: `ControlChip`, `ControlButton`, `ControlUnit`, `Panel`, `Icon`, the Mantine theme, `useConfirm`. |
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
| `spotDraftAtom`, `spotFormAtom`, `spotSketchAtom` | same | The record being written: where its pin is and which stage has the pointer, what has been typed, what has been drawn. |
| `place`/`edit`/`closeSpotDraftAtom`, `setSpotStageAtom` | same | Write-only. |
| `activeSpotAtom` | same | The record being read — opened by a click, by an index row, or by `?lok=`. |
| `spotRecordsAtom`, `spotsFailedAtom` | `spots/spotRecords.ts` | Every record the session may see, null until the list lands; and whether it never did. |
| `mySpotsAtom` | same | Derived: the reader's own, newest change first. |
| `sketchSessionAtom` | `sketch/session.ts` | Non-null exactly while the map is frozen and Excalidraw has it. |
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
  `useConfirm`.

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
- **`src/lidarExtract/`**: only `stitch.ts` is live, via `src/terrain/dem.ts`.
  `run.ts` and most of `sources.ts` are headless computation behind no surface.
  Kept on purpose.
- **The spot index is your own records only.** `SpotMenu` is a Mantine `Menu`
  ordered by date with no hover-to-light-the-pin: enough for a few dozen
  records, not a few hundred.
- **Only `nb` is a live locale.** `nn` and `en` are stubs.
- **There is no SPA route but `/`.** `/l/<code>` is a narrow Caddy `redir` to
  `/?lok=<code>`; there is no `try_files` fallback, which would turn every wrong
  path into a 200.
- **PocketBase still carries `localities`, `finds` and `attachments`.** Nothing
  reads them; they are deliberately left on disk.
