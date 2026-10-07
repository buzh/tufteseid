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
| `api/` | PocketBase singleton (`pocketbase.ts`), the `spots`, `evidence` and `votes` collection clients, the one call into the render sidecar (`render.ts`), and the comment engine's own session (`remark42.ts`). |
| `auth/` | The OAuth2 dialog, the redirect trip it starts and picks up again (`trip.ts`), the account menu (with the admin-only links to `/stats/` and PocketBase's dashboard), and `currentUserAtom` mirrored off the SDK's `authStore`. |
| `evidence/` | Keeping a reading of a spot's ground: the offer the map is making, the spec that survives it, the producers, the serial render queue and the handover to the render sidecar, the gallery that lists and orders what was kept, the reader that lays them back on the map, and the provenance legend stamped onto a download. |
| `flyfotoControls/` | The Flyfoto arm: which Norge i bilder acquisition, and its era grouping. |
| `grounds/` | The ground switch. Which ground is up is derived from the half's background layer, never stored. |
| `heritageControls/` | The Kulturminner control: which theme layers are ticked and how they are drawn. |
| `heritageInfo/` | The pointer tip and the click-kept card over heritage features, plus the OL overlay they ride. |
| `kartControls/` | The Kart arm: which cartography. |
| `lidarControls/` | The LiDAR arm: dataset menu, render, DTM/DOM, Automatisk, hybrid overlay and contours. |
| `lidarExtract/` | LiDAR tile planning, fetching and stitching. `stitch.ts` serves the DEM fetch, `run.ts` and `sources.ts` the LiDAR evidence render. |
| `locales/` | i18next JSON, one directory per language. |
| `map/` | The OpenLayers map and everything attached to it: layer configuration and stacks, the compare halves and the split pane, feature info, projections, the rectangle-placing interaction, the footprint and pin and hint layers. |
| `ribbon/` | The top band: its three sections and the upstream status light while the map is the context in front, and the draw band while a drawing is. Layout only. |
| `search/` | Kartverket place, address, road, property and elevation lookups. One function has a live caller. |
| `shared/` | The context in front (`uiContext.ts`), the error boundary, URL parameter access, coordinate parsing, enum and number helpers, and the request deadline that reports to the breaker. |
| `showControls/` | The band's what-is-drawn-over-the-ground group: the Kulturminner control, the open drawing's toggle and the shared drawing layer's. |
| `sketch/` | Excalidraw over a frozen map: the georeferencing frame, the scene, the toolbox that stands in for Excalidraw's own, the remembered pen, the render onto the ground, and the layer that puts every spot's drawing on it at once. |
| `spotControls/` | The reader's records as surfaces: the `+`, the properties box, the read card, the box that orders a render from elsewhere, the index menu. |
| `spots/` | Spot state and geometry: the pin layer, its clustering and its style, the footprint frame, hit test, place and adjust, share link, name suggestion, and the up/down tally each spot is ranked by. |
| `talk/` | The thread on a public spot: the remark42 widget fetched from our own origin, and the box it stands in (`docs/discussion-and-votes.md`). |
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
| `restoreCompareFromUrlAtom` | same | Write-only, spent on its first run: reopens the two-ground view a link described. |
| `compareUrlAtomEffect` | same | Puts the view mode and B's ground back on the address bar. |
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
| `open`/`adjust`/`read`/`closeTerrainWindowAtom` | same | Write-only. `read` takes a rectangle settled elsewhere — the spot card hands it the footprint — and starts the reading without a square to place. |
| `spotPlacingAtom` | `spots/atoms.ts` | The `+` is armed: the next map click places the pin. Exclusive with `spotDraftAtom`. |
| `spotDraftAtom`, `spotFormAtom`, `spotSketchAtom`, `spotFootprintAtom` | same | The spot being edited: where its pin is, which of the four stages has hold of the map (`idle` is none of them), which box is on screen (`box`), what is typed, what is drawn, and the ground it names. The record itself is not here — `useSpotDraft` holds it. |
| `spotFootprintAdjustingAtom`, `standingSpotFootprintAtom` | same | Derived: the draft is in its `footprint` stage, and which rectangle the standing frame draws — nothing while that rectangle is in hand or the pen has the map. |
| `unpinnedSpotIdAtom` | same | Derived: the one spot the pin layer leaves undrawn — the record an editor draft stands for, whose pin `pinAdjust.ts` draws instead, or the open spot, whose card or reader is the box in front of it. |
| `place`/`edit`/`adjust`/`closeSpotDraftAtom`, `setSpotStageAtom` | same | Write-only. `adjustSpotDraftAtom` is the card's: it opens a draft straight into a stage with `box: 'card'`. |
| `activeSpotAtom` | same | The record being read — opened by a click, by an index row, or by `?lok=`. |
| `spotReadingAtom` | same | The open spot's kept renders are being read on the map. Held as the id it was entered on; writing `activeSpotAtom` with a different spot — or none — clears it, and a draft suspends it. True regardless for a spot the reader may not edit, for whom writing it false does nothing. |
| `spotAcquiringAtom` | same | The acquisition box stands in front of the card. Held the same way as the reading and suspended by a draft for the same reason; never true for a reader who may not edit the spot, who is held in the reading. |
| `spotTalkingAtom` | same | The thread stands in front of both the card and the reading, because it is reached from either. Held and suspended like the two above, and never true for a private spot — the comment engine has no account of who may read what, so the only gate is not mounting it. |
| `spotRecordsAtom`, `spotsFailedAtom` | `spots/spotRecords.ts` | Every record the session may see, null until the list lands; and whether it never did. |
| `mySpotsAtom` | same | Derived: the reader's own, newest change first. |
| `spotScoresAtom`, `myVotesAtom` | `spots/spotScores.ts` | The tally per spot id, and the reader's own vote per spot id. A spot absent from the first is unvoted, not unknown — `spotScores` is a view, which PocketBase publishes no realtime feed for, so `useSpotScores` subscribes to `votes` and refetches the affected row. There is no failure atom: a tally that never lands reads as zero, which is what the surfaces would show anyway. |
| `popularSpotsAtom` | same | Derived: every public spot, best first, `updated` breaking a tie. Does not wait on the tallies — without them the list reads unranked rather than not at all. |
| `terrainOfferAtom` | `evidence/offer.ts` | What the terrain analysis would keep, published by `useTerrainControls` because its settings are component state. |
| `keepOfferAtom` | same | Derived: the terrain's offer when an analysis is running, otherwise the ground's (off the A half). Null where the view cannot be re-rendered. |
| `draftGroundAtom` | `evidence/draftGround.ts` | A picture laid on the map at the extent it was rendered over: a kept row to trace a drawing onto, published by `EvidenceGallery`, or a flyfoto proposal under review, published by `useFlyfotoRun`. Never both — the card and the acquisition box do not stand at once. `loop` says the file is a WebM, and so which overlay draws it. |
| the floating panel's layout and placement | `ui/useFloatingPanel.ts` | Which way round the box is laid out, where it was dragged to, how big it may get and which wall it is docked against. Module-private, reached through `useFloatingPanel`: held outside the component, which remounts per spot — and so only one floating panel at a time. `EvidenceReader` is the one caller. |
| `sketchSessionAtom` | `sketch/session.ts` | Non-null exactly while the map is frozen and Excalidraw has it. |
| `uiContextAtom` | `shared/uiContext.ts` | Derived: `map` or `draw`, off the session above. Which surface is in front (*The context in front*). |
| `drawHoldAtom` | same | What the draw context puts in the band: whose drawing it is and the two ways out. Published by whichever `useSpotDraft` has the pen, because its box is away and the writes are still the controller's. |
| `sketchShownAtom`, `sketchFadeAtom` | `sketch/overlay.ts` | Whether the open spot's drawing is on the ground, and how far it is faded towards it. A reading setting, not the record's: they outlive the spot the box was opened on. Putting the pen down with strokes kept turns the first back on, so a drawing is never written out of sight. |
| `allSketchesShownAtom` | `sketch/allSketches.ts` | Whether every spot's chosen drawing is on the ground at once. Seeded from the `sketches` URL parameter and written back to it, so a link carries the reading. |
| `drawnSketchSpotsAtom` | same | Which spots have their drawing on the ground this frame, published by the layer after it paints. Read by `spotLayer`'s clustering, which drops their pins. Empty while the layer is off. |
| `currentUserAtom` | `auth/atoms.ts` | Who is signed in. Written only by `pbAuthSyncEffect`. |
| `isSignedInAtom`, `isAdminAtom` | same | Derived, so a component does not re-render on an unrelated user field. |
| `isAuthDialogOpenAtom`, `authPromptAtom` | same | Whether the dialog is up, and why when the reader did not press anything. |
| `signInFailedAtom` | same | Whether the last attempt came back without a session. Seeded, like the atom above, from the page's boot: signing in is a redirect, so a failure has to survive the page that started it (`docs/identity.md`). |
| `upstreamHealthAtom` | `upstream/health.ts` | One breaker status per origin. |

## The context in front

One context at a time, named by `uiContextAtom` (`src/shared/uiContext.ts`).
`map` is the app at rest: the band over the ground and boxes floating on it.
`draw` is a drawing open — the canvas takes the whole map rectangle, so
everything the map context put over that rectangle stands down and the band
carries the drawing's own controls instead.

What that costs each surface is different, and the difference is the rule:

- **The band swaps, it does not go.** `Ribbon` puts `DrawBand` on the column
  and hides its own three sections with `display: none` — hidden rather than
  unmounted, because each ground arm's controller remembers something across a
  visit elsewhere (the flyfoto era, the dataset lists) that an unmount would
  lose and fetch again. Both bands wear `.ribbon`, whose `height` is stated
  rather than left to the contents: the scene↔ground mapping is bound to the
  map rectangle as it was at the freeze that opened the session and is never
  rebound, so a band that grew or shrank afterwards would slide the map element
  out from under strokes already registered to it. For the same reason no
  scrollport in the band may show a scrollbar — a classic one takes its track
  out of the content box, and the band would grow by it on a platform that has
  them.
- **The boxes go away, not out.** `SpotSurface` wraps them in a
  `display: none`, because the box carries the draft controller and it is that
  controller that writes the strokes. Unmounting it would fire its leaving
  write with the canvas still open, against a scene Excalidraw has not been
  asked for. The band drives the same controller through `drawHoldAtom`.
- **The terrain panel goes and the terrain render stays.** `TerrainSurface`
  mounts `useTerrainControls` either way, so only the box stands down — the
  reading on the ground is what a drawing is traced over. The frame does let go
  of the map: `setSpotStageAtom` clears `terrainAdjustingAtom` on the way into
  the draw stage, because a rectangle under a canvas could not be put down
  again.
- **The heritage tip and card close outright.** Both ride OpenLayers overlays
  on the map element, which the session wears a CSS transform on, so left up
  they would be dragged and scaled with the ground rather than anchored to it.
  They belonged to the context that has gone, so `useHeritageInfo` clears
  them rather than hiding them.

A second full-surface context reuses the atom: add it to `UiContext`, and every
surface above already asks the right question.

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
- **A link's B ground goes on over the top of that seed, never before it.**
  `restoreCompareFromUrlAtom` calls `selectViewModeAtom` first and only then
  writes the ground `?backgroundLayerB=` named, because the seed would otherwise
  copy A's straight back over it. It runs from a mount effect in
  `MapComponent` rather than at module scope, since the seeder registry is only
  as full as the import graph that has been evaluated by then, and a
  module-level one-shot spends it on the first run — the same idiom as
  `src/spots/shareLink.ts`.

### Mirrored into pane B, and not

| Mirrored | Not |
| --- | --- |
| Kulturminner theme layers (`syncThemeLayers`, called once per map) | The heritage tip and card |
| LiDAR footprints, split rather than mirrored — one viewport query, a layer per pane drawing that pane's own flight (`footprintTargets`) | The terrain analysis, frame and render both |

## Making a spot

Three boxes stand over one record, one at a time. `SpotProperties` is what a
spot is *called* — name, description, the pin, and the delete — reached from the
card's cogwheel and from the `+` that makes a new one. `SpotCard` is where the
reader then spends their time: the rectangle and the drawing as an icon button
each, an elevation button that points the terrain analysis at that rectangle
rather than framing another (`readTerrainWindowAtom`, so the reading starts at
once and its offer is what the camera beside it then keeps), and the pictures.
Reading terrain against a place is the ongoing act and naming it a one-off, so
the card is the workbench and the properties box is behind a button. The
rectangle's button becomes a row — the hint and its Ferdig — for as long as it
has the map; the pen takes the whole map instead, so the box goes away behind
the canvas and its Avbryt/Lagre are in the band (*The context in front*). Only
one of the two can have the map at a time. The third box, `SpotAcquire`, is
behind the card's microscope and orders the pictures that are asked for over
the footprint rather than read off the view (*The pictures of a spot*).

The pin belongs to the properties box and stands only while it is open
(`unpinnedSpotIdAtom`, `pinAdjust.ts`). The card and the reader are read against
the ground the pin sits in the middle of, so the open spot loses it there — the
footprint frame is what marks the place then, and the name is in the box's own
title. Every other spot keeps its pin, which is what a reader clicks to move on.

Two rules keep a view of many spots legible, and they answer to different
things. The name plate is drawn out to zoom 10 only (`LABEL_OFF_ZOOM`,
`src/spots/pinStyle.ts`): it is for telling spots apart across a view that
holds several, and from there in the reader is looking at the ground itself,
where a dark plate over the hillshade covers the thing being read. The pin
itself always stands.

Pins that come within 44 css pixels of each other are drawn as one translucent
disc carrying their count (`ol/source/Cluster`, `src/spots/spotLayer.ts`), so a
zoomed-out view reads as a scatter of weights rather than a mat of overlapping
name plates. A disc stands for no record: clicking one fits the view to the
pins it gathered instead of opening anything, and `spotsAtPixel` answers with
the whole gathering so the heritage query stays out of the way of both. The
open spot is dropped by the cluster's `geometryFunction`, not merely left
unstyled, so losing its pin also takes it out of the count.

Both ways a click could land on nothing are closed. Clustering is off at the
view's deepest zoom, because two spots six metres apart is an ordinary thing to
record and a gathering that no amount of zooming could break apart would answer
a click with silence; and a gathering whose pins share one coordinate exactly —
which no zoom separates either — opens the first of them instead of fitting to
a rectangle of no width.

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
- **The scene opens on the view the map is showing and is held over it.** The
  map is frozen for the session and follows the scene by a CSS transform
  (`slaveMapToScene`), so the canvas opens at the zoom that makes that transform
  the identity (`initialSceneView`) — one map element laid out exactly under the
  surface being drawn on. Zooming out from there brings no more ground in; it
  scales the ground off the edges. So `holdSceneOnMap` puts the zoom floor at
  the opening zoom and the scroll inside whatever room zooming *in* bought,
  which at the floor is none at all, and `SketchCanvas` writes any frame outside
  that back with `updateScene`. Excalidraw has a prop for neither. Zooming in is
  not capped: stretched tiles still cover.
- **Leaving hands the view what the scene was looking at.** `thawMap` inverts
  the transform it is about to take off into a centre and a resolution, so the
  pen is put down on the ground it was lifted from rather than on the extent the
  session froze. The centre is exact; `constrainResolution` rounds the scale to
  a whole zoom level, so a scene zoomed to something between two of them lands
  on the nearer.
- **The toolbox is ours, not Excalidraw's.** Neither its toolbar nor its
  properties island has a prop behind it and neither leaves a slot to put a
  button in, so both are hidden in `SketchCanvas.module.css` and `SketchTools`
  stands in for them: ten tools and the note in one row, six colours, three
  widths and a fill in the other. `toolbox.ts` is the seam — reading is off
  `onChange`'s app
  state, writing is `setActiveTool` and `updateScene`. A style press restyles
  the selection as the island did, carrying a container's bound label along and
  passing the tombstones back with it so undo keeps its reach, under
  `CaptureUpdateAction.IMMEDIATELY` so the restyle is an undo step of its own.
- **Two tools share a button where the shape is the only difference.** Circle,
  square and diamond are one; arrow and line are the other. A press picks what
  the button is showing and a hold opens the rest, which is what keeps a row of
  ten down to a row a reader can scan. The member shown is the last one
  picked, and `pen.ts` remembers it — with the lock, the colour and the width —
  under `sketchPen.v1`, validated field by field so an older record upgrades in
  place rather than being thrown away. The tool itself is not remembered:
  `OPENING_TOOL` is the hand and every canvas opens on it, so entering the draw
  stage behaves as the map did a press earlier — a drag moves the view, and
  nothing is drawn until the reader reaches for something that draws. Panning is
  the map's own interaction everywhere else and that one is frozen for the
  session, so the hand is also the only thing that moves the view once zooming
  in has bought the room for it.
- **What went with the island stays gone on purpose.** The laser and
  frame tools have no use over a map; the layer order, the alignment and the
  actions are on the canvas's own context menu; and the properties the strip
  does not offer are set once in `buildInitialData`. Roughness and rounded
  edges are deliberately left as Excalidraw's own — a traced line should look
  drawn rather than plotted. The fill is hatched and never solid, because a
  filled shape here sits over the ground being read.
- **The note is the one button that is not a tool.** Excalidraw makes a sticky
  note the long way — draw a rectangle, press Enter, type — so `addNote`
  (`toolbox.ts`) does all three: `convertToExcalidrawElements` builds the
  rectangle with its label bound inside it, `updateScene` drops it in the
  middle of the view and selects it, and a synthesised Enter at the Excalidraw
  container opens the label for editing, which is the one thing the imperative
  API has no verb for. The editor selects the text it finds, so the
  placeholder is typed over rather than edited around, and a run of notes
  cascades by a fixed step so the second does not land on the first. Its
  yellow is solid and its writing is dark, against the strip's rule for every
  other fill: a note is written over the ground rather than traced off it, and
  paper that cannot be read through is the point.
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
  properties box says so. Old rows predate the rule and are still nullable in
  `SpotRecord`; `SpotCard` repairs one on sight with a single write rather than
  a migration, because deriving the square wants a projection PocketBase's JSVM
  has not got.
- **A rectangle being *changed* starts from what is there.** `seedFootprint`
  (`src/spots/atoms.ts`) only runs for a draft with no footprint in hand, and
  `bringBboxIntoView` then pans or zooms *out* until the square is on screen,
  never in, so a reader who can already see it keeps the view they chose;
  `MAX_SIDE_M` bounds how far out that ever goes.
- **The card can take the map without becoming the properties box.**
  `adjustSpotDraftAtom` opens a draft on the open record straight into its
  `footprint` or `sketch` stage with `box: 'card'`, and `SpotSurface` keeps
  showing the card. The controller is mounted *inside* the card
  (`SpotUnitsHeld`) rather than around it, so the picture list and the traced
  ground survive the draft — remounting them would take the traced picture off
  the map exactly when the reader opens the pen to draw on it. A card draft has
  no resting state: the stage's own Ferdig or Avbryt writes and closes it in one
  act, which is why the controller carries `finish`/`abort` alongside `close`.
- **A misplaced pin is a real record**, so the properties box carries its own
  Slett, behind a two-press confirm. It is not on the card: a destructive button
  on a surface pressed constantly buys nothing.

## The pictures of a spot

A spot's `evidence` rows are a sequence, not a set. `sort` is an ordering key in
epoch milliseconds, so a row lands last by being created. There is one list over
them — `EvidenceGallery` on the card — and it does everything but the asking:
the kept rows, the drag that sets the order, and the press that lays a picture
back on the map to trace over. Asking for another is the camera in the card's
tools row, beside the rectangle and the pen — or, on the end of that same row,
the microscope, which is where the pictures nobody can take from the view are
ordered. `EvidenceReader` flips through the same rows full size and changes none
of them.

- **The cover is the first readable row.** Nothing marks one: the reading opens
  on it, so dragging a picture to the top is how a cover is chosen, and the star
  says which one is. `coverOf` (`evidence/spec.ts`) is the single authority
  both surfaces ask, and a sun loop passes — both surfaces ground a loop as
  readily as a still.
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
- **One offer, and it is a button.** The camera in the card's tools row keeps
  the view as it stands, so the gallery lists only what is already kept. Asking
  is one press with no source name attached: the row it makes carries the title
  (`evidenceTitle`), and the reader chose the view by looking at it.
- **What is offered follows the map.** `keepOfferAtom` publishes a reading of
  the ground as it stands, or of the analysis when one is running — the
  analysis wins, because it is then what is on screen and the ground it was
  computed from is underneath it. Where neither can be re-rendered (cartography,
  the empty ground) the offer is null and the camera is dead.
- **A cached VAT is kept like any other flight.** `lidarCvat` offers a `lidar`
  spec keyed by the flight it was computed from, told apart from that flight's
  WMS grounds by `style: 'cvat'`, so the duplicate guard, the title and the
  legend's RVT credit all follow from what is already there. Only the producer
  differs: `cvatRaster.ts` stitches whole tiles off `/cvat/*` at the deepest
  level the store holds and crops them, where the WMS grounds ask for the
  rectangle at the source's own resolution. A tile the pipeline has not written
  is a 404, so a rectangle off the flight reads as `empty` rather than failed.
- **A sun loop is ordered, not kept.** It reads nothing on screen, so it never
  belonged on a camera that keeps the view. It is asked for in `SpotAcquire`
  (`src/spotControls/`), the box behind the microscope on the end of the card's
  tools row, which stands in front of the card and holds one chip per picture
  that is asked for over the footprint rather than read off the view.
  `SUN_LOOP_SPEC` (`evidence/spec.ts`) is the whole
  ask — DTM, the analysis panel's own sun and exaggeration, 72 frames — so there
  is no form and nothing about the ask follows the map. The chip is dead while a
  loop of the spot's is outstanding, because the sidecar takes one job per
  caller, and while one already covers the footprint with those parameters; a
  settled row is retried in the gallery, where every other kind's is.
- **The flyfoto series is a walk, not a batch.** The other chip in `SpotAcquire`
  proposes every Norge i bilder acquisition over the footprint, one at a time,
  and the reader keeps or discards each (`useFlyfotoRun.ts`, `FlyfotoRun.tsx`).
  A proposal is rendered before it is offered, at the acquisition's own
  resolution, so keeping writes the very
  bytes on screen: `keepProduced` (`useSpotEvidence.ts`) creates the row and
  PATCHes the file in one go, and deletes the row again if the file will not
  land, because a row with no pixels and no queue state is nothing the gallery
  could retry. A discard was never a record — the pixels only ever existed in
  the tab — so running again asks about it a second time. What the run passes
  over is only what `evidenceMatches` already finds against the footprint as it
  now stands, which is also how an acquisition the catalogue has added since
  comes up on its own, and how moving the footprint re-offers the lot. The
  seamless mosaic is not in the series: that one is a ground, and the card's
  camera already keeps it.
- **A proposal is judged on the map, not in a box.** The picture under review
  goes on the ground through `draftGroundAtom`, in the footprint, under the
  spot's own drawing — because the question the reader is answering is whether
  what they traced off the terrain is there in the photograph, and that is a
  comparison a thumbnail cannot carry. So the acquisition box becomes a bar
  along the bottom of the map for as long as the run lasts, the same move the
  card's rectangle and pen make and for the same reason: the buttons follow the
  eye. Nothing in the run takes the map, so zoom and pan stay the reader's
  throughout; `bringBboxIntoView` runs once at the start, out only, so a view
  that already holds the footprint is left alone. The object URL behind each
  proposal is revoked as its card leaves, which is why a discard costs nothing.
  The answer is yes or no, by button or by `j` and `n` — bound in `FlyfotoRun`
  and off while the pen has the map, as every other single letter is. The bar
  holds one width for the whole walk and the answers sit at its right edge, so
  the hand stays where it is between one acquisition's name and the next; a key
  does no more than its button, so neither answers while the keep is in flight.
- **A proposal shares the render queue, in wider lanes.** `enqueuePreview`
  (`evidence/queue.ts`) puts pixels with no row behind them into the same queue
  as the rows' own renders, because the reason for a queue at all is the shared
  public edge and not the rows. A row's render still runs alone; previews run
  `PREVIEW_LANES` at a time, that being a reader sitting in front of one upstream
  with nothing else asked for. Order is strict either way, so a row the reader
  asked for is never starved by a run that keeps proposing. The run looks
  `PREVIEW_LANES + 1` cards ahead — the one under review and a render in every
  lane behind it — which is why the constant is exported rather than guessed at
  twice; the waste is at most that many stitches nobody reaches. A preview's
  signal gates the queue position rather than the render: a burst already on the
  wire runs out its own deadline, and only the result is dropped.
- **Not every row is made here.** Three kinds are rendered in the tab that asked
  for them; `sunloop` and `rvt` are created the same way and then handed to the
  render sidecar, which writes the file back itself
  (`docs/render-sidecar.md`). `rendersOnServer` (`evidence/spec.ts`) is where
  that split is stated. The row,
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
  `#t=0.1`, which is what gets a frame painted rather than a black box. The
  element carries `disablePictureInPicture` and the thumbnail is
  `pointer-events: none`, because Firefox lays a picture-in-picture toggle over
  a video on hover and at thumbnail size that toggle is the whole picture: the
  press opened a floating window instead of reaching the button behind it.
- **Clicking a picture lays it on the map**, opaque, through `draftGroundAtom`,
  driven from `SpotSurface`. That is the ground the pen draws over, and it
  rides the map element, so a sketch session's transform carries it along. A
  sun loop grounds like anything else and plays while it is there; which
  overlay carries it is the only difference, and `draftGround.loop` is what
  says so — `useEvidenceOverlay` for a still, `useEvidenceLoopOverlay` for a
  loop, in a leaf component of its own because that hook's transport changes
  with every frame and the surface renders the whole card. The card drives no
  transport; play, pause and seek belong to the reading.
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
  - The sidecar burns a provenance band under every frame, because a WebM cannot
    be stamped in the browser the way a still is. The ground keeps the whole
    rectangle; `meta.bandTop` says where it stops and the overlay draws only the
    rows above it, so the band stays in the file and off the map
    (`docs/render-sidecar.md`).
- **The card is an owner's surface.** Somebody else's spot opens straight into
  the reading, however it was opened — a click on the pin, an index row, `?lok=`
  — and stays there: `spotReadingAtom` reads true for a spot outside `mayEdit`
  whatever is written to it, so there is nothing for the reading to step back
  to. A visitor sees one box, and closing it leaves the map as it was. The card
  holds the camera, the rectangle, the pen and the visibility switch, none of
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

The box floats (`src/ui/useFloatingPanel.ts`). It is dragged by its title row
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

## Every drawing at once

`src/sketch/allSketches.ts` puts one drawing per spot on the ground as a single
transparent layer at z 1.9, with no pin and no name plate: the reading is the
drawings themselves, laid over the country, and a click on the strokes opens
the spot they belong to. Off until asked for, on the `a` key and the band's
second drawing button, and carried by the `sketches` URL parameter.

- **Which drawing is the record's to say.** `spots.mapSketch` names it, and
  `mapSketchOf` (`sketch/scene.ts`) resolves it. A spot holds one drawing
  today, so the field is empty on every record written before it existed and
  the resolver reads empty as the `sketch` column; an edit that writes the
  drawing writes `mapSketch` with it. An id this build cannot resolve draws
  nothing rather than falling back — falling back would put a drawing its
  author took off the map back on it.
- **The open spot is left out**, as is the one being drafted. `overlay.ts`
  already has those, with the fade slider and the `t` key the box owns, and two
  copies of one drawing would darken every stroke.
- **A drawing on the ground takes its own pin off.** The layer publishes what
  it painted to `drawnSketchSpotsAtom` and `spotLayer`'s cluster geometry drops
  those records, so the pin and its name plate go and the count on a gathering
  goes with them. Published from what was painted rather than worked out from
  the zoom: a spot is never left with neither pin nor strokes, and an export
  still in flight keeps its pin until the drawing is really there. A spot with
  no drawing keeps its pin at every zoom — it has nothing else to be found by.
- **The cost is the export, not the drawing.** Each scene is re-exported
  through Excalidraw at the view's resolution, so the layer culls to the
  viewport, skips anything under 24 px across, holds two exports in flight at
  a time and gives each a quarter of the pixel budget a lone drawing gets.
  Renders off screen are dropped once more than forty are held. A hidden layer
  is never asked for a canvas, so a layer switched off costs nothing at all.
- **A click reads the alpha channel**, not the rectangle: the pixel under the
  pointer is looked up in the render that covers it, within six pixels, and the
  smallest drawing wins where two overlap. A pin takes the click first — it is
  the smaller target and it says which spot it opens.
- **The list is fetched signed out too** (`spots/spotRecords.ts`). A public
  spot is readable with no account, so a guest gets the coverage and the pins
  that go with it; signing in adds the reader's own records to the same list.

## The provenance legend

A stored render is bare pixels. The reader lays that same file back on the
ground it was made over and the sketch draws on top of it, so a caption burned
into the file would ride the map and be drawn over. The legend goes on **at the
door instead** — `stampEvidence` (`src/evidence/download.ts`) sits between the
stored bytes and the bytes that leave, so a downloaded figure comes out in the
reader's language and the current wording rather than whatever was true when the
queue ran.

The download is the only door, and a visitor reading somebody else's public spot
is exactly who wants a citable figure out of it — so the reader has one too.
`useEvidenceDownload` (`download.ts`) is shared by the gallery's per-row button
and the reader's, which downloads the picture on the ground. One at a time —
decoding, stamping and re-encoding a multi-megapixel raster is about a second
of main-thread work.

`withLegend` in `legend.ts` composes it onto a canvas of its own: the capture
unchanged at the top, the band appended underneath, every dimension derived from
the one font size, which is `clamp(11, captureWidth / 70, 26)`. Off the capture
and not the finished canvas, because the band can widen the canvas and a font
size that grew with it would want a wider band again. A footprint is 50–500 m
and the producers publish between 1 and 0.08 m/px, so a capture is anywhere from
50 to 6300 px across and the legend has to hold its proportions over the whole
of that.

- **Line one** is the title in weight 600 and `evidenceFacts` after it, the same
  list the card and the reader print. Too long for the width, it sheds facts
  from the end, so the render date is the first to go. A title too long for the
  width on its own is cut with an ellipsis.
- **Below it, the rights lines**, flush left and one per holder rather than one
  joined line: Norge i bilder's holder name is sixty characters on its own.
- **Last, a footer row** in three cells: the scale bar at the left edge, the
  rectangle's centre in the middle, and for a public spot its `/l/<code>` at the
  right. The middle is centred in what the other two leave rather than on the
  canvas, so the three cannot collide.
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
- **Nothing is ever shed, and the capture is never covered.** The band is
  appended, so the height it takes costs no ground, and a capture too narrow to
  carry the footer row is matted out to it with `MAT` either side rather than
  losing the bar or the link — national LiDAR over the smallest footprint is
  50 px square and comes back a few hundred wide, the picture a small square in
  the middle of it. The footer sets that floor because it is the one part that
  is neither cut nor wrapped; the head ellipsizes and the rights wrap, so
  neither asks for width of its own. The scale bar likewise takes the next round
  distance up rather than none where four segments would be illegible, which
  over a small capture means a ruler wider than the picture. That reads
  correctly: the mat beside it is not ground.
- **The download is no longer registered to its bbox** — the capture sits
  inset. That is the trade for spending no pixel of ground on caption, and it
  costs nothing downstream: the file the map lays back over the rectangle is the
  *stored* one, which is never stamped.
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
- Canvas text does not wait for webfonts, so `withLegend` loads Mulish 400 and
  600 before measuring, which is why it is async. Without it two figures stamped
  a second apart come out in different faces. Measuring happens before the
  canvas is sized, because what it measures is what the width has to be —
  and setting `width` resets every context property, so nothing survives that
  line.

## URL parameters

`UrlParameter`, `src/shared/utils/urlUtils.ts`: `lok`, `invite`, `projection`,
`backgroundLayer`, `hybrid`, `contours`, `lidarModel`, `lidarRender`,
`viewMode`, `backgroundLayerB`, `curtain`, `themeLayers`, `heritageDetails`,
`heritageRender`, `heritageOpacity`, `sketches`, `lat`, `lon`, `zoom`.

`lidarRender` is the one parameter written even when it holds the default,
because its *absence* is a value: it says nobody chose a render, which is what
lets `preferredLidarRender` offer the cVAT one instead. Present, it is what
Automatisk's first settled dataset is asked for, through the `wanted` argument
on `selectNational`/`selectProject` — so a shared link reproduces the render it
was made on rather than being upgraded out of it. It is held, not spent, until
the list that dataset's clamp consults has arrived — the mosaic's
GetCapabilities, the cVAT manifest — because `resolveLidarStyle` against an
empty list answers the default, and by then the effect mirroring the ground
back to the URL has overwritten the parameter. One value for the whole page
load, not one per ground section.

Two of them name something rather than set something, and both are read once
at import and then taken off the address bar:

- `lok`, the open spot's six-character code, written back by whatever record
  is open (`src/spots/shareLink.ts`).
- `invite`, a closed-beta invite code, which is the whole of an invitation
  link (`src/invites/inviteLink.ts`, `docs/closed-beta.md`). It is never
  written back — it belongs to the visit that arrived carrying it, not to a
  link the reader copies afterwards.

**The comparison is on the URL, the B half's settings are not.** Three
parameters carry it, all written by `src/map/compare/`: `viewMode`
(`curtain` or `split`, absent while one ground is up), `backgroundLayerB` (the
ground in the second pane) and `curtain` (the seam as a whole percent, absent
at the 50 default and in the split, where there is no seam). Everything else
about B — its render, DTM or DOM, the hybrid overlay, the flight or
acquisition it was pinned to — is session state, so a link reopens the
*comparison* rather than the half.

`backgroundLayerB`'s vocabulary is narrower than A's `VALID_STARTUP_LAYERS`
(`linkableGroundB`, `compare/atoms.ts`): the five Kart variants,
`lidarHillshade` and `flyfoto`. No `lidarCvat`, because B enters with
Automatisk off and nothing then fills `activeCvatAcquisitionHalves.b`, and no
`empty`, which is a bare pane. The same function reads the parameter and
writes it, so the address bar names the ground a reload would really open: a
flight degrades to the national mosaic and an ortofoto acquisition to the
mosaic, on the way out as much as on the way in, and a value outside the
vocabulary altogether is dropped, which leaves the contrast rule to place B.

`curtain` is written by `CompareCurtain` on a 400 ms debounce, because a drag
moves the seam on every pointer event and `replaceState` is rate-limited.

## Ribbon and the UI kit

`Ribbon.tsx` is layout and nothing else:

```
GroundSection half="a"  →  ViewSection  →  [GroundSection half="b"]  →  ToolSection
```

That is the map context. With a drawing open the same shell carries `DrawBand`
instead — whose spot is being drawn on, Avbryt, Lagre — and nothing else, since
nothing in the band may change the ground under strokes already registered to
it (*The context in front*).

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

**When the band runs out of room, a ground section gives and nothing else
does.** The centre and the tools are fixed-width icon controls that cannot
shrink by a pixel, while a ground section carries a flight name no one can
predict the width of. So each ground section is its own scrollport and the band
is not one: the view switch, the show group and the tools stay put at every
width, and a ground's controls scroll inside the column they were given. The
band keeps an `overflow-x` of its own for the widths under about 610px where
the centre and the tools alone outrun it, but that is a last resort rather than
the design.

- Every arm takes a controller object (`useLidarControls(half)` and friends) and
  owns no atoms of its own. All three controllers mount whichever arm is
  showing: each remembers something across a visit to another ground.
- `ControlChip` is the labelled box that opens something — icon, label, hint,
  chevron. `ControlButton` is the square icon toggle, optionally split into two
  lit halves.
- Shared metrics: `--control-height` and `--control-icon-width` in
  `src/index.css`.
- The show group's two toggles each answer to a single key: **`k`** —
  kulturminner — raises and lowers the heritage blind, **`t`** the drawing.
  Both are bound to the document by the hook behind the box rather than by the
  box, so they answer from a card as well; both keep their hands off a press
  aimed at an input, and both go quiet while the pen has the map, where
  Excalidraw owns the single letters.
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
  key, hung on the thing that key works: `heritageKey` on `HeritageToggle`,
  `sketchKey` on the band's `SketchToggle` and `pictureKeys` on the reader's
  roll of thumbnails. A tip that has to name the control it is about is
  pointing at the wrong one. Each waits for its key to be worth knowing — the
  heritage tip until the overlay is on, the drawing's until there is a drawing
  — so nothing greets a reader who has not started.

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
- **The record list carries every drawing.** `listSpots` is one `getFullList`
  of whole records, so every readable spot's scene — up to 5 MB apiece — is
  fetched on load whether or not the shared drawing layer is ever switched on,
  and now for a guest as well. Fine at a few dozen records, which is also all
  the index is built for.
- **A drawing gives no hover affordance.** The shared layer answers a click on
  its strokes but the cursor never changes over them, so nothing says a drawing
  can be opened; testing the alpha channel on every pointer move is what that
  would cost.
- **The spot index does not light the pin.** `SpotMenu` is a Mantine `Menu`
  with two tabs — the reader's own by date, and every public one by score —
  and no hover-to-light: enough for a few dozen records, not a few hundred.
- **The thread widget speaks English.** remark42 ships no Norwegian locale, so
  its own chrome is `en` while every string the app puts around it is nb. A
  deliberate exception to *`t()` from day one*, and the only one.
- **A thread outlives the visibility it was opened under.** Threads exist only
  for public spots, but remark42 keeps what was written: turning a spot
  private hides the box and leaves its comments reachable to anyone who kept
  the URL. Deleting a spot does not delete its thread either — nothing
  propagates the cascade out of PocketBase.
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
