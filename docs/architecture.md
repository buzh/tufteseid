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
| `api/` | PocketBase singleton (`pocketbase.ts`), the `spots` and `evidence` collection clients, and the one call into the render sidecar (`render.ts`). |
| `auth/` | OAuth2 dialog, the account menu (with the admin-only links to `/stats/` and PocketBase's dashboard), and `currentUserAtom` mirrored off the SDK's `authStore`. |
| `evidence/` | Keeping a reading of a spot's ground: the offer the map is making, the spec that survives it, the producers, the serial render queue and the handover to the render sidecar, the gallery that offers and orders them, the reader that lays them back on the map, and the provenance legend stamped onto a download. |
| `flyfotoControls/` | The Flyfoto arm: which Norge i bilder acquisition, and its era grouping. |
| `grounds/` | The ground switch. Which ground is up is derived from the half's background layer, never stored. |
| `heritageControls/` | The Kulturminner control: which theme layers are ticked and how they are drawn. |
| `heritageInfo/` | The pointer tip and the click-kept card over heritage features, plus the OL overlay they ride. |
| `kartControls/` | The Kart arm: which cartography. |
| `lidarControls/` | The LiDAR arm: dataset menu, render, DTM/DOM, Automatisk, hybrid overlay and contours. |
| `lidarExtract/` | LiDAR tile planning, fetching and stitching. `stitch.ts` serves the DEM fetch, `run.ts` and `sources.ts` the LiDAR evidence render. |
| `locales/` | i18next JSON, one directory per language. |
| `map/` | The OpenLayers map and everything attached to it: layer configuration and stacks, the compare halves and the split pane, feature info, projections, the rectangle-placing interaction, the footprint and pin and hint layers. |
| `ribbon/` | The top band: its three sections and the upstream status light. Layout only. |
| `search/` | Kartverket place, address, road, property and elevation lookups. One function has a live caller. |
| `shared/` | Error boundary, URL parameter access, coordinate parsing, enum and number helpers, and the request deadline that reports to the breaker. |
| `showControls/` | The band's what-is-drawn-over-the-ground group: the Kulturminner control and the drawing's toggle. |
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
| `spotDraftAtom`, `spotFormAtom`, `spotSketchAtom`, `spotFootprintAtom` | same | The spot being edited: where its pin is, which of the four stages has hold of the map (`idle` is none of them), which box is on screen (`box`), what is typed, what is drawn, and the ground it names. The record itself is not here — `useSpotDraft` holds it. |
| `spotFootprintAdjustingAtom`, `standingSpotFootprintAtom` | same | Derived: the draft is in its `footprint` stage, and which rectangle the standing frame draws. |
| `place`/`edit`/`adjust`/`closeSpotDraftAtom`, `setSpotStageAtom` | same | Write-only. `adjustSpotDraftAtom` is the card's: it opens a draft straight into a stage with `box: 'card'`. |
| `activeSpotAtom` | same | The record being read — opened by a click, by an index row, or by `?lok=`. |
| `spotReadingAtom` | same | The open spot's kept renders are being read on the map. Held as the id it was entered on; writing `activeSpotAtom` with a different spot — or none — clears it, and a draft suspends it. True regardless for a spot the reader may not edit, for whom writing it false does nothing. |
| `spotRecordsAtom`, `spotsFailedAtom` | `spots/spotRecords.ts` | Every record the session may see, null until the list lands; and whether it never did. |
| `mySpotsAtom` | same | Derived: the reader's own, newest change first. |
| `terrainOfferAtom` | `evidence/offer.ts` | What the terrain analysis would keep, published by `useTerrainControls` because its settings are component state. |
| `keepOffersAtom` | same | Derived: the ground's offer (off the A half) and the terrain's, ground first. Only what is on screen — the sun loop is not, so `useSpotEvidence` appends `SUN_LOOP_SPEC` (`evidence/spec.ts`) to the list. |
| `draftGroundAtom` | `evidence/draftGround.ts` | One of the spot's own pictures laid back on the map at the extent it was rendered over, to trace a drawing onto. Published by `EvidenceGallery`, which is the only thing holding the rows. |
| the reading box's layout and placement | `evidence/readerWindow.ts` | Which way round the box is laid out, where it was dragged to, how big it may get and which wall it is docked against. Module-private, reached through `useReaderWindow`: held outside the component, which remounts per spot. |
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

## Making a spot

Two boxes stand over one record. `SpotEditor` is what a spot is *called* — name,
description, the pin, and the delete — reached from the card's cogwheel and from
the `+` that makes a new one. `SpotCard` is where the reader then spends their
time: the rectangle and the drawing as a button each, and the pictures. Reading
terrain against a place is the ongoing act and naming it a one-off, so the card
is the workbench and the editor is behind a button. A button becomes a row —
the hint and its Ferdig, or the pen's Avbryt/Lagre — for as long as it has the
map, and only one of the two can.

A spot is written as it is made. `createSpot` runs the moment the pin lands —
under the pin's own coordinate as a provisional name, because the column is
required and the place-name register has not answered yet — and every unit after
that is a write of its own: the register's answer when it arrives, the typed
text behind an Avbryt/Lagre pair that is there only while what is typed differs
from what is stored, the point, the drawing, the rectangle. So neither box
carries a save button over the whole of it, closing one throws nothing away, and
evidence can hang off the record while the rest is still being filled in.

`useSpotDraft` (`src/spotControls/`) owns that. Every write goes through one
serial promise chain: two PATCHes in flight together would leave whichever
landed second's copy of the spot on screen, and the create has to be first of
all. A failed create settles the chain on null and every later write is then a
no-op — as is every write queued behind a delete, which is what keeps the card
from reopening on a spot that is no longer there. The controller holds the
record itself and publishes it to `activeSpotAtom` only on the way out, so
nothing centres the map on a spot the reader is still placing.

The point, the drawing and the rectangle are held on the map rather than in a
field, so they are written when their stage is left — `setStage` commits before
it hands the map over — and on the way out, whoever took it. The point and the
rectangle are compared by value; the drawing only off the stage that owns it,
because `sketchNow` builds a fresh object and anything wider would resend five
megabytes on every press.

- **Whoever ends a draw session takes the scene first**, through `sketchNow`
  while the canvas is still up. `SketchCanvas` reads nothing off Excalidraw on
  its way out: by the time an unmount cleanup runs the editor is being torn
  down and answers with an empty scene, which went over `spotSketchAtom` as a
  drawing with no strokes. So `commit` writes that atom as well as the record,
  and the pen's Avbryt puts it back to what is stored.
- **The accent walks the reader through it.** `step` is whichever stage has
  hold of the map and, failing that, the first thing the record is still
  missing: description, then drawing. `idle` is the fourth stage — the box
  resting, nothing on the map in the reader's hand — and it is what an editor
  draft opens in.
- **Every spot has a rectangle, and nobody is asked for one.** The first write
  that finds the record without one derives it (`derivedFootprint`,
  `src/spots/footprint.ts`): the smallest square covering the drawing if there
  is a drawing, otherwise `DEFAULT_FOOTPRINT_SIDE_M` — 50 m — around the pin.
  `squareBboxCovering` clamps to `MIN_SIDE_M`…`MAX_SIDE_M` (50…500 m), so a
  drawing outside that range gets a square that is not what was drawn and the
  editor says so. Old rows predate the rule and are still nullable in
  `SpotRecord`; `SpotCard` repairs one on sight with a single write rather than
  a migration, because deriving the square wants a projection PocketBase's JSVM
  has not got.
- **A rectangle being *changed* starts from what is there.** `seedFootprint`
  (`src/spots/atoms.ts`) only runs for a draft with no footprint in hand, and
  `bringBboxIntoView` then pans or zooms *out* until the square is on screen,
  never in, so a reader who can already see it keeps the view they chose;
  `MAX_SIDE_M` bounds how far out that ever goes.
- **The card can take the map without becoming the editor.** `adjustSpotDraftAtom`
  opens a draft on the open record straight into its `footprint` or `sketch`
  stage with `box: 'card'`, and `SpotSurface` keeps showing the card. The
  controller is mounted *inside* the card (`SpotUnitsHeld`) rather than around
  it, so the picture list and the traced ground survive the draft — remounting
  them would take the traced picture off the map exactly when the reader opens
  the pen to draw on it. A card draft has no resting state: the stage's own
  Ferdig or Avbryt writes and closes it in one act, which is why the controller
  carries `finish`/`abort` alongside `close`.
- **A misplaced pin is a real record**, so the editor carries its own Slett,
  behind a two-press confirm. It is not on the card: a destructive button on a
  surface pressed constantly buys nothing.

## The pictures of a spot

A spot's `evidence` rows are a sequence, not a set. `sort` is an ordering key in
epoch milliseconds, so a row lands last by being created. There is one list over
them — `EvidenceGallery` on the card — and it does everything: the offers above
it, the kept rows below, the drag that sets the order, and the press that lays a
picture back on the map to trace over. `EvidenceReader` flips through the same
rows full size and changes none of them.

- **The cover is the first readable row.** Nothing marks one: the reading opens
  on it, so dragging a picture to the top is how a cover is chosen, and the star
  says which one is. `coverOf` (`evidence/labels.ts`) is the single authority
  both surfaces ask, and a sun loop passes — the reading grounds a loop as
  readily as a still. `laysOnGround`, in the same module, answers the narrower
  question the traced ground asks, and a video fails it: that picture is the one
  a sketch is traced over, and a shadow that has moved since the strokes were
  drawn is not something to trace.
- A drop writes one row. `sortForMove` (`evidence/order.ts`) takes the midpoint
  between the row's new neighbours, so nothing else moves; a row dropped last
  takes the current time instead, or a picture kept a moment later would sort
  in front of it. The write is optimistic and puts the row back on a refusal.
- The rows are one height, so a drag measures every slot's middle once at the
  press and then takes the nearest one to the pointer: the preview moves rows
  between slots, and the slots themselves do not move. The handle answers ↑ and
  ↓ too, and stops the press reaching OpenLayers' keyboard pan.
- Pictures are their own records, so reordering — like keeping and deleting —
  is written when it happens, as is every other unit of a spot
  (*Making a spot*).
- **An offer is a row, not a button.** Its title is a full source name — a
  dataset and a visualization — which no button in a 19 rem panel can carry, so
  the row shows the title ellipsized with the whole of it in a tooltip and puts
  one compact `+` on the right.
- **What is offered follows the map.** `keepOffersAtom` publishes readings of
  the ground and the analysis as they stand, so those offers come and go with
  what is under them. A sun loop reads nothing on screen — it is every azimuth,
  which leaves only the sun's height and the exaggeration, and `SUN_LOOP_SPEC`
  answers both from the terrain panel's defaults — so `useSpotEvidence` appends
  it last, where it stands whatever the reader is looking at.
- **Not every row is made here.** Three kinds are rendered in the tab that asked
  for them; `sunloop` is created the same way and then handed to the render
  sidecar, which writes the file back itself (`docs/render-sidecar.md`). The row,
  the gallery, the ordering and the reading are the same either way — the
  difference is who makes the pixels, and that a sidecar render survives the tab
  being closed. `stateOf` (`useSpotEvidence.ts`) states the one precedence rule:
  a row with pixels has no state, a job this browser is still holding comes
  next, and past that the sidecar's own `meta.job` marker — which the sidecar
  beats while the job lives — outranks whatever the local queue concluded.
  Neither settled state is terminal; `mayRetry` (`queue.ts`) is the question the
  gallery asks.
- PocketBase makes no thumbnail for a video, so a loop is its own handle
  everywhere a `200x200` thumb would be: a `<video preload="metadata">` at
  `#t=0.1`, which is what gets a frame painted rather than a black box.
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
- Left and right flip. `keyboardEventTarget` is the document (`map/atoms.ts`),
  so the listener is in the capture phase — OpenLayers' own keyboard pan would
  otherwise answer the same press. Up and down are swallowed there too and do
  nothing: half an arrow cluster flipping pictures while the other half slid
  the ground out from under them read as a fault.
- The drawing sits above the pictures at z 2, so `SketchFade` (`src/sketch/`)
  takes it part of the way off the ground, `SketchToggle` in the band takes it
  off altogether, and **`t`** — tegning — does the same from the keyboard. The
  shortcut is bound by `useSketchOverlay`, not by a box, so it answers from the
  card as well; it is inert while Excalidraw has the map, and it keeps its hands
  off a press aimed at an input.
- A row whose render has not landed, or that has no rectangle, is not part of
  the reading; the gallery on the card is where it is waited on. A reading with
  nothing left in it steps back to the card — where there is one. For a reader
  who may not edit the spot there is not, so the box stays and says the spot has
  no pictures yet; stepping back would close a spot they had just opened.
- **A sun loop is read on the ground, like everything else.** It plays over its
  own `bbox25833`, looping, and the transparency slider fades it the way it
  fades a still, so the sun can be walked round a mound against the map under
  it. What differs is only which overlay carries it: `useEvidenceOverlay` is an
  `ImageStatic` and takes a URL to a still, so a loop goes to
  `useEvidenceLoopOverlay` in the same module — one `<video>`, drawn frame by
  frame into an `ImageCanvas` the way `terrain/terrainLayer.ts` draws its own
  canvas. The two never stand together. The box holds no second element — that
  would be a second decode of the same file — only a transport over the one
  that is already decoding: play, pause and a bar stepped by frame
  (`EvidenceTransport.tsx`). The bar is read in degrees of azimuth rather than
  seconds, because the loop walks the circle from north in `meta.stepDeg` steps
  and so one frame is one bearing, the bearing the burnt-in band names.
  - The element is a pixel wide and all but transparent in the corner of the
    document rather than detached or `display: none`, because a browser is
    entitled to stop decoding what nobody can see, and the frames are wanted
    even though the element is not.
  - `ImageCanvas` caches one image, so a repaint is `source.changed()`. It is
    called off `requestAnimationFrame`, gated on the element's own
    `currentTime` having moved: `requestVideoFrameCallback` is tied to frames
    reaching the compositor, which is exactly what this element is hidden from,
    and an ungated rAF would repaint the whole map 60 times a second to show a
    24 fps loop.
  - The sidecar burns a provenance band over the bottom of every frame, because
    a WebM cannot be stamped in the browser the way a still is. `meta.bandTop`
    says where it starts and the overlay draws only the rows above it, so the
    band stays in the file and off the map (`docs/render-sidecar.md`).
- **The card is an owner's surface.** Somebody else's spot opens straight into
  the reading, however it was opened — a click on the pin, an index row, `?lok=`
  — and stays there: `spotReadingAtom` reads true for a spot outside `mayEdit`
  whatever is written to it, so there is nothing for the reading to step back
  to. A visitor sees one box, and closing it leaves the map as it was. The card
  holds the rectangle, the pen, the visibility switch and the offers, none of
  which a visitor may press; keeping it behind the reading would be a panel of
  disabled controls and one button that works. So neither the card nor
  `EvidenceGallery`, which only the card mounts, branches on `mayEdit` at all —
  the reader is the surface that does.
- `/l/<code>` opens the reading for an owner too: a link is an invitation to
  read. The reading fits the footprint itself, so `shareLink.ts` keeps its hands
  off the view whenever one is open rather than putting two animations on it.
  The code goes back onto the URL for whatever spot is open, so a reload lands
  in the reading too.
- **The reading's two ways out say two different things.** The close is the
  spot's own: it clears `activeSpotAtom` and leaves the map as it was, and it
  means that for an author as much as for a visitor. The pencil beside it, on
  `mayEdit` (`src/spots/mayEdit.ts`), only ends the reading and so steps back to
  the card — the workbench, not the naming form, which is one further press on
  the card's cogwheel. Without it an author's only way back to their own spot
  would be to close it and open it again.

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

## The provenance legend

A stored render is bare pixels. The reader lays that same file back on the
ground it was made over and the sketch draws on top of it, so a caption burned
into the file would ride the map and be drawn over. The legend goes on **at the
door instead** — `stampEvidence` (`src/evidence/stamp.ts`) sits between the
stored bytes and the bytes that leave, so a downloaded figure comes out in the
reader's language and the current wording rather than whatever was true when the
queue ran.

The download is the only door, and a visitor reading somebody else's public spot
is exactly who wants a citable figure out of it — so the reader has one too.
`useEvidenceDownload` (`download.ts`) is shared by the gallery's per-row button
and the reader's, which downloads the picture on the ground. One at a time —
decoding, stamping and re-encoding 2500 px is a second of main-thread work.

`legend.ts` draws it: a band along the bottom edge, every dimension derived from
the one font size, which is `clamp(11, width / 70, 26)`. A footprint is
50–500 m and the producers publish between 1 and 0.2 m/px, so a render is
anywhere from 50 to 2500 px across and the legend has to hold its proportions
over the whole of that.

- **Line one** is the title in weight 600 and `evidenceFacts` after it, the same
  list the card and the reader print, with the rectangle's centre in it. Too
  long for the width, it sheds facts from the end, so the render date is dropped
  before the centre is: where the ground is beats when the picture was made. A
  title too long for the width on its own is cut with an ellipsis.
- **Below it, two columns.** Left carries the scale bar and, for a public spot,
  its `/l/<code>`; right carries the rights lines. A left cell pairs with a
  right one where both fit and goes alone where they do not, so the legend is
  two lines usually and three where the credit is long. Norge i bilder's holder name
  is sixty characters and its terms are not CC BY, which is exactly the case
  that earns the third line.
- **Rights lines are never shed** and wrap rather than being cut: they are the
  only part of the legend the licences require. Each names the holder by the part
  it plays *in this picture* — the same Kartverket is `høydedata` under a
  terrain render and `skyggerelieff` under a LiDAR extract, and that difference
  is the statement about who did the visualising. Terrain therefore also carries
  an authored line, because that one the app made rather than fetched. One line
  is not a rights holder at all: relief that came out of the Relief
  Visualization Toolbox — terrain, the sun loop, the cached VAT — adds a
  short-form citation of RVT's authors, who ask for one. The full references are
  in `README.md`, and a figure cannot carry them.
- **The bar and the link are shed to keep the band under a fifth of the image
  height**, in that order. The rights lines are not shed even when they take it
  past the fifth, so a small render comes out with a heavy band rather than
  uncredited. Nothing is drawn at all past half the height, or where the image
  is narrower than eight ems — national LiDAR over the smallest footprint is
  50 px square, and a caption covering it would be worse than none.
- **A loop cannot be stamped at the door**: `decodeToCanvas` is
  `createImageBitmap`, which throws on a WebM, so `stampEvidence` hands a video
  back untouched and the band is burnt in at render time instead. The wording is
  still the client's — `sunLoopLegend` composes it beside `legendContentFor` in
  `evidence/legendContent.ts` — but what the wording asserts is not: the credit
  travels as a hole and the link is composed by the sidecar out of the record,
  because a band in the pixels is a claim nobody downstream can check.
  `docs/render-sidecar.md` records the whole split, and what burning early
  costs: a credit edited afterwards, and a resolution the client has to send as
  a hole in a pre-localized string.
- Canvas text does not wait for webfonts, so `drawLegend` loads Mulish 400 and
  600 before measuring, which is why it is async. Without it two figures stamped
  a second apart come out in different faces. It returns whether it drew, so
  `stamp.ts` can hand back the bytes it was given rather than spend a JPEG
  generation re-encoding an unchanged canvas.

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

The second ground section mounts only while two grounds are up. `ViewSection`
carries two units: `ViewControlGroup`, the one/curtain/split switch, and beside
it `ShowControlGroup` — Kulturminner and the drawing, what is laid over the
ground whichever ground is up. `ToolSection` holds the rest of the controls that
apply to the reading — terrain, the spot `+` and its index, the share link, the
account — with `UpstreamStatus` last, because it comes and goes on its own.

`ShareButton` hands over the open spot's short link, or, with no spot open, the
address bar as it stands: every ground, overlay and the centre are already
parameters on it. Same gesture and same two-second answer as the button in a
spot's title row, both out of `src/spots/useShareCopy.ts`.

**Which section a new control goes in is a question about the control, never
about where there is room.** A control that means something different per ground
belongs to an arm; one that turns something on over the ground belongs to the
show group; anything else that applies to the reading belongs to the tools.

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
- `Hint` floats a tip beside the control it is about, on a Mantine `Popover`
  anchored to whatever child takes a ref — a `Panel`, a Mantine `Tooltip` or a
  plain box all do. `tips` is a list of
  lines the caller has already filtered to what applies there, and an empty one
  means no tip; the wrapper stays in the tree either way, because
  `Popover.Target` clones its child and dropping it would remount the surface.
  `keys` names the `KeyboardEvent.key` values the tips are about, built beside
  `tips` so the two cannot drift: pressing one takes the tip down, because the
  reader has just shown they did not need telling. Click-outside is off — it
  fires on `mousedown`, so a pan would take the tip with it.
  Waving a tip off puts it away for the page load, ticking the box writes its id
  to `hintsDismissed.v1` in localStorage. Ids live in the `HINT_IDS` list in
  `src/ui/hints.ts`; one that leaves the list is dropped on read. One id per
  key, hung on the thing that key works: `sketchKey` on the band's
  `SketchToggle` and `pictureKeys` on the reader's roll of thumbnails. A tip
  that has to name the control it is about is pointing at the wrong one.

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
- **A grounded sun loop repaints the whole map.** Every decoded frame is a
  `source.changed()`, and OpenLayers has no way to redraw one layer, so reading
  a loop costs a map render 24 times a second for as long as it is up. Cheap
  enough against cached tiles; a view carrying the `projection` URL parameter
  reprojects each of those frames on top, which nothing has measured. The same
  frames re-render the reader, because the seek bar may not run ahead of the
  ground it reports; that render is the cheap half of the pair.
- **A loop's transport is what the element gives.** Play, pause and a seek bar
  stepped by azimuth, driven off the hidden `<video>` and reading its state
  back, so a browser that refused the autoplay shows a play button rather than
  a lie. No speed, no frame-by-frame step, and a scrub decodes forward from the
  file's one keyframe.
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
