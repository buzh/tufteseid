# State of the branch — the map, and a ribbon over the grounds

This branch took the interface down to the map and kept the machinery that
draws it. 290 files became 79. The point was not to make the app smaller — it
was to make the next interface unconstrained by the last one, without
re-deriving four years of Kartverket and Riksantikvaren service quirks.

The rebuild has reached the background, the record over it, and how many of
them are on the screen at once. `src/App.tsx` renders a ribbon above
`MapComponent`: it says which ground is drawing — LiDAR relief, one of
Kartverket's map series, or ortofoto — and which dataset within it, and switches
both; in the middle it chooses the view, which is how many grounds are up and in
what shape. At the other end of the row it puts Riksantikvaren's heritage layers
over whatever that ground is, and says what of them; it starts a lokalitet of
the reader's own and says whether there is an account behind the session; and
only when there is something to say, it names an external service that has
stopped answering. There is still no search box.

The band and the controls are separate things. `src/ribbon/` is the band, and it
is laid out in sections, each with its own subject and its own file:

| Section | Holds | Is about |
| --- | --- | --- |
| `GroundSection` | the ground switch and the arm belonging to it | what is drawn under everything |
| `ViewSection` | the view: one ground, the curtain, or the split | how the map is being looked at |
| `ToolSection` | the Kulturminner overlay, the terrain analysis switch, the `+` that starts a lokalitet, the account button and the upstream fault chip | what applies whichever ground is up |

The split is by subject, not by position. A control belongs to the left because
it chooses the one picture the whole map is made of, to the middle because it
changes how that picture is presented rather than which one it is, and to the
right because it is true of all three grounds at once. Which section a new
control goes in should be a question about the control, never about where there
is room. `Ribbon.tsx` itself is layout and nothing else.

`GroundSection` is the one section that appears twice. A two-ground view mounts
a second immediately right of the view control, so the row reads left to right
as the screen does: the left half's ground, the view that put them both up, the
right half's ground. Each takes a `half` and writes nothing else. The slack is
after all of that, as a `margin-left: auto` on the tools, so nothing already on
the row moves when the second section appears.

Everything inside `GroundSection` is a surface mounted from its own directory:

| Directory | Is |
| --- | --- |
| `src/grounds/` | the ground switch — `GroundSwitch`, three buttons in a `ControlUnit` with the live one lit, and `useGroundControls` which derives which ground is up from the half's background atom rather than storing it |
| `src/lidarControls/` | the LiDAR arm — `LidarControlGroup`, five elements whose design is settled, the last of them the Hybrid overlay and its contours |
| `src/kartControls/` | the Kart arm — one chip over `KART_VARIANTS`, and the memory of which variant Kart means while another ground is up |
| `src/flyfotoControls/` | the Flyfoto arm — the NiB mosaic or one acquisition over the viewport, with the period filter inside its own dropdown |

A section is the ground switch and then one arm, never two: a row carrying the
controls of a ground that is not drawing would be three surfaces claiming the
same map. It mounts all three controllers regardless, because each remembers
something across a visit to another ground.

`src/viewControls/` is the middle one, and the only arm that is not per half: a
view is a property of the map. Three buttons in a `ControlUnit`, one per
`ViewMode`, and a controller thin enough to be two lines — the work of changing
view is what the B half has to be seeded with, and that is `selectViewModeAtom`
beside the layer code it writes.

Every arm takes a controller object and no atoms of its own, so another host
can mount it — which is exactly what the second ground section does. A row of
controls is made of two shapes, and both are `src/ui/` primitives:
`ControlChip`, the line of text
that grows to fit what it is reporting and opens a menu, and `ControlButton`,
the fixed square holding one glyph that is the whole control — filled in papaya
for a mode that is on, or split across the middle for two states that are one
picture. The metrics they share are `--control-height` and
`--control-icon-width` in `src/index.css`.

Where several of those boxes are one control rather than neighbours, they stand
in `ControlUnit`: a third primitive that draws them as a single shape — shared
edge, outer radius only, no gap. It styles its children by position rather than
by a class they wear, because the boxes arrive already wrapped in a `Tooltip` or
a `Popover.Target` and because the set changes as a chip comes and goes; the
survivor of a departure is rounded on all four corners again without anything
being told. Kulturminner is the only control wearing it today.

`ToolSection` mounts four subjects, and they are not the same shape.
`src/heritageControls/` is the Kulturminner overlay — `HeritageToggle`, the
button that puts Riksantikvaren's registers over whatever ground is drawing,
and joined to it, only while they are up, `HeritageMenu`: the chip that reads
out the render and opens the five sources, the three registers inside
kulturminner2, the seven renders and the transparency. The two share one box —
the chip is a readout of what the button turned on, not a control standing next
to it — which is why the chip carries no glyph of its own. It is not an arm and
belongs to no ground, which is what puts it at the other end of the band. Off
is `heritageHiddenAtom`, a blind rather than a clearing, so the reader's
selection survives taking the overlay off to look at the terrain; the button is
the product of that atom and `activeThemeLayersAtom`, and with nothing ticked it
arms kulturminner2 rather than raising a blind over an empty set. The one thing
the chip says that is not a setting is that the map is too far out for any
ticked source to draw — every RA service here is capped below city scale, and
an overlay that is on and invisible otherwise reads as an empty register.

`src/terrainControls/` is the second, and only its switch is in the band.
`TerrainToggle` is one `ControlButton` and nothing else — no chip beside it,
because what it turns on is not a setting the band can read out in a line. It is
next to Kulturminner because it too is true of all three grounds — the client's
own relief is read against cartography and ortofoto as readily as against
Kartverket's hillshade. The rest of the surface is `TerrainSurface`, mounted by
`MapComponent` over the map: the controller that holds the DEM and the render,
and, while there is an analysis, a box floating at the top left with the
settings in it. The two hosts share no props and no component state — they meet
in `terrainWindowAtom`, which is the rectangle and the on switch at once, and in
`terrainAdjustingAtom`, which says the rectangle is still being placed. Every
verb in the surface is a write to one of those two, which is why the toggle
holds nothing. The settings are in a box rather than a dropdown because every
one of them changes a picture the reader is looking at while they turn it; the
fold in the box's header gives the corner of the view back without dropping the
grid.

Three things are unlike the overlay. Off is not a blind: it drops the grid,
which is 19 MB, and only the reading survives — visualization, sun,
exaggeration, radii, transparency, all in component state, which is why the
controller is mounted whether or not there is an analysis, so a reader who takes
the render down to look at what is under it gets their own sun back. The
rectangle is not the map: `terrainWindowAtom` holds the square that was framed,
the analysis does not follow a pan, and `Juster` in the box is what gives it
back. And the switch does not start the work — it puts a square on the screen
with handles on its corners (`windowAdjust.ts`) and waits for `Start`, because
one press that both frames the screen and pulls 19 MB spends a reader's
bandwidth on the ground they happened to be looking at. The square itself is
`squareBboxWithin` — the largest that fits inside the visible map, at most 500 m
on a side, and no smaller than `MIN_SIDE_M` once a hand is on it
(`docs/terrain-analysis.md`).

`src/heritageInfo/` is the other surface `MapComponent` mounts beside the map —
beside it rather than in it, and each in an `ErrorBoundary` of its own, so
neither the terrain box nor a card built on some shape the register served can
take the map down with it. The register is readable as well as visible. A pointer **at rest** over a Kulturminner feature raises a tip
naming what is there, and a click opens a card with the fields and the two
links out — Askeladden and Kulturminnesøk. Both are OpenLayers `Overlay`s
portalled into by React (`useMapOverlay`), so they are pinned to the ground and
not to the screen. The tip never takes the pointer; the card does, and is the
only one of the two that can be selected, scrolled or followed.

The cost model is the design. Every question is one GetFeatureInfo per ticked
register against `kart.ra.no`, the slowest origin in the stack, so: the hover
fires only after the pointer has held still (a sweep across the map asks
nothing), the pixel is snapped to a grid before it becomes a coordinate, and
hover and click ask the identical question so they share one memo and a click
on a spot whose tip is already up asks nothing. Touch is left out — a tap is a click there, and a tip
with no pointer to leave with would sit over the map until the next one. The
parsing, grouping and field knowledge behind both surfaces is in
`src/map/featureInfo/` and returns plain data; every string the reader sees is
chosen in `src/heritageInfo/`.

## The reader's own lokaliteter

The third and fourth subjects in the tool section are the `+` that starts a
lokalitet (`src/spotControls/`) and the account button beside it (`src/auth/`).
They are neighbours because one is the other's precondition: nothing here can be
kept without an account, and pressing `+` signed out opens the sign-in dialog
rather than a draft.

**A lokalitet on this branch is one `spots` record and nothing else.** The old
three-collection model — `localities`, `finds`, `attachments` — was deleted
rather than ported. What replaced it is a single row: a name, a description, a
point, an optional drawing, a visibility and a six-character code.
`pocketbase/pb_migrations/1700001100_spots.js` is the schema and says field by
field what it does differently. Pictures, scenes and the funn/bilde distinction
are deliberately out.

The workflow is four gestures and the box reads down them in that order: place
the pin, name it, say what you saw, draw over the terrain, save. `src/spots/` is
the map half — the draft atoms, the draggable pin (`pinAdjust.ts`, modelled on
the terrain window's handles), the layer of saved pins, the place-name lookup
that fills the name field in while the pin stands still (`spotName.ts`, whose
ranking vocabulary came over from `main` unchanged), and the short link.
`src/spotControls/` is the box: `SpotPanel` while it is being written,
`SpotCard` once it has been saved, sharing one stylesheet and one corner because
only ever one of them is up.

Three draft atoms rather than one, split by who writes them at what rate.
`spotDraftAtom` is written by the pin drag sixty times a second, `spotFormAtom`
by a keystroke, `spotSketchAtom` by the canvas settling. Folded into one, a
typed character would redraw the pin and a dragged pin would re-render two text
inputs.

**What the layer lists depends on who is looking.** Signed in, it is your own
spots and every public one, which is the index the record is for. Signed out, it
draws only the single record a short link resolved — a visitor who followed
`/l/K7M2QX` came for that spot, and turning the map into a gazetteer of
everybody's public pins for anyone who loads the page is a different product
with different consent.

A spot is private when it is written and made public as a second, separate
decision, taken in the card once there is something to share. What the surfaces
gate on is what the server enforces: a record is readable if it is public, or
yours, or you are an admin — no account needed for the first — while creating
one is yours only and changing or deleting one is owner or admin. So `SpotCard`
carries one permission, owner-or-admin, and there is no show/edit stance on this
branch: the old model's `mayAdd` was about putting funn inside somebody else's
lokalitet, and a spot has nothing inside it.

`src/sketch/` is the drawing. It is `main`'s `src/funn/` with the funn taken out
— the frame maths, the freeze, the CSS transform that slaves the map to the
scene rather than the other way round, the wheel rewrite and the
export-at-view-resolution overlay, all unchanged; the two draw modes, the GeoJSON
conversion, the attachment records and the autosave, all gone. Drawing freezes
the map and captures a frame — the viewport's ground extent in the view's own
projection — so scene pixels have a place on the ground for as long as the pen
is down. The canvas may still be panned and zoomed; the map follows it with a
transform OpenLayers cannot see, which is what keeps the frame valid. Excalidraw
stays on its light theme against the app's dark chrome, because its dark theme
is a filter over the canvas and the strokes would be kept in colours other than
the ones they were drawn in.

`src/auth/` is PocketBase's `authStore` mirrored into `currentUserAtom` by an
`atomEffect` mounted at the root, plus a dialog. OAuth2 only: there is no
password form and no guest flow, and the dialog lists whatever
`listAuthMethods()` reports, so adding a provider stays an admin-UI change with
no code in it.

**Mantine is the design system, and the app is dark.** `MantineProvider` and
the theme (`src/ui/theme.ts`) are mounted at the root, and every surface is
built from its primitives and its variables. The palette is anthracite grey —
shade 7 is RAL 7016, and the ramp is registered as Mantine's `dark` as well as
under its own name, which is what makes the page that colour — with papaya
orange as the accent, chosen because the accent has to be findable against
terrain and the old green sat inside both hillshade and ortofoto.

There is **no light scheme**. `defaultColorScheme="dark"` is set on the
provider and `data-mantine-color-scheme="dark"` statically on `<html>`, the
second so the first paint is already dark; Mantine's `ColorSchemeScript` would
do the same job with an inline `<script>` the CSP has no nonce to give it.
Nothing offers a toggle, and CSS that hard-codes a light surface will look
wrong.

One consequence of Mantine is in the `Caddyfile`: it writes its CSS variables
into a runtime `<style>` element, so `style-src` had to become
`style-src-elem 'self' 'unsafe-inline'`. A nonce would be stricter and is not
available — Caddy serves this as static files, so there is no per-request value
to mint.

## What was kept, and why

**OpenLayers and the WMS/cache path.** The whole of `src/map/layers/`,
`src/map/projections/`, the tile grids and `src/map/atoms.ts`, plus the proxy
half on disk — `Caddyfile`, `nginx/`, `nib-proxy/`, `vat-cache/`. Every
service fact in `docs/map-layers.md` and `docs/wms-proxy-and-tiles.md` was paid
for in probing live endpoints and is not recoverable from reading code.

**Headless computation, with its callers deleted.** These have no UI now and
that is fine: they take arguments and return values.

| Kept | Was driven by | Entry point |
| --- | --- | --- |
| `src/lidarExtract/` | the extract dialog | `extractCanvas` (`run.ts`) |
| `src/search/searchApi.ts` | the search box | the place / address / property / coordinate queries |

`src/map/featureInfo/` was on that list and is off it: `src/heritageInfo/` is
its caller again. What came back is not what went — the fetcher is scoped to the
ids the caller names and routed through `fetchWithin`, the vector-feature half
had no layers left to query and went, and the rendering knowledge was split out
into `heritageSummary.ts` so a surface receives data rather than markup.

`src/map/lidarFootprintsLayer.ts` was on that list and is off it:
`MapComponent` mounts it again. It is what fills `lidarViewportAtom`, which the
ribbon's dataset menu lists and Automatisk decides from, and it paints the
outlines while that menu is open.

`src/terrain/` was on that list and is off it: `src/terrainControls/` drives it
again, from a switch in the band and a box floating on the map. The operators,
the DEM reader and `render.ts` are untouched — what is new is the surface,
`terrainLayer.ts` to put the painted canvas on the map, and a rectangle that is
capped at 500 m square and framed inside the visible map rather than clamped
from it (`docs/terrain-analysis.md`).

`src/map/compare/` was on that list and is off it: `ViewSection` drives it. It
kept its curtain and grew a split; what it lost is focus, which the ground
section per half made unnecessary. See *Two grounds at once* below.

**`src/ui/`, reduced to three files.** `Icon.tsx`, because `MaterialSymbol` is
the union that keeps a plausible-but-absent icon name out of the build; `cx.ts`;
and `theme.ts`. The rest of the kit went, `tokens.css` with it — the four
stylesheets that still read its custom properties were rewritten onto
`--mantine-*` when the app went dark, and a second set of tokens that has to be
kept in step with the first is exactly the thing not worth maintaining.

## What was added

`src/upstream/` is the one thing on this branch that is neither kept nor
rebuilt. It is a circuit breaker over the four external map origins plus the
ribbon chip that reports one being down — written after a Kartverket height
outage that the app had no way to notice and no way to mention. Every tile
source goes through `guardTileSource`, and every non-tile request to those
origins through `fetchWithin`, which is now the admission point as well as the
deadline. The rules, the thresholds and the two cache interactions that make
the probes honest are in `docs/wms-proxy-and-tiles.md`.

Noticing is half of it; the other half is still drawing what does not need the
dead origin. A `hoyde` outage now leaves three things standing: the national
mosaic reads MapProxy's `lidar-*-held` siblings, which serve what is stored and
nothing else; the cVAT store places its own acquisitions out of the envelope in
`/cvat/manifest.json` rather than off Kartverket's catalogue; and
`lidarViewportAtom` takes a `held` status, whose rows are the cached flights
over the viewport, which the dataset menu labels as such and Automatisk picks
from. `docs/map-layers.md` and `docs/wms-proxy-and-tiles.md` have the detail.

## What went

`src/shell/` (ribbon, layer rows, ground modes), `src/localities/`, `src/funn/`,
`src/figure/` (the provenance plates), `src/auth/`, `src/api/` (the PocketBase
clients), `src/measure/`, the search UI, `src/map/overlay/`,
`src/map/groundOverlay.ts`, `src/map/composite.ts`, `src/map/interactions.ts`,
and the vector layers nothing draws into any more.

Three of those are back, and none of them as it was. `src/auth/` is an OAuth2
dialog over a mirrored `authStore`, where it used to carry password and guest
flows. `src/api/` is a PocketBase singleton and one collection client, where it
used to be three. And `src/funn/` came back as `src/sketch/`, which is the
drawing without the funn. `src/localities/`, `src/figure/` and `src/measure/`
are still gone, and the data model the first two described is not coming back.

`docs/ui-architecture.md`, `docs/analysis-roadmap.md`, `docs/open-questions.md`
and `docs/live-site-test.md` described that interface and went with it. All of
it is in `git log` on `main`.

## Driving the map

Every ground is a Jotai atom. Writing one rebuilds the stack, and
`backgroundLayerAtomEffect` (mounted by `MapComponent`) does the work.

**Every ground atom is a pair**, not one atom: `halved()` in
`compare/halves.ts` makes an `.a` and a `.b`, `.a` being the left of the screen
and the whole of it while one ground is up. There is no facade over the pair and
no notion of focus — a surface says which half it is driving, and the band
mounts a ground section per half that is drawing. What a surface belonging to
the map rather than to a half reads instead is `acrossHalves(pair)`: an array of
that pair's values for every live half, in `liveHalvesAtom` order, so two of
them can be zipped. `lidarFootprintsLayer` and the tile guard are the callers.

Each half of `backgroundLayerHalves` has three writers, one per arm, and a
ground section mounts each once. Reach for the arm's controller rather than the
atom: on a LiDAR flight the ground's *name* is a function of the render
(`lidarFlightGround`), so `useLidarControls` writes the style and the name
together; on Kart the name has to land in `kartVariantHalves` too, or the ground
is forgotten the moment you leave it; on Flyfoto the acquisition travels with the
name. Which ground a name belongs to is derived by `groundOf` (`src/grounds/`)
out of the vocabularies the layer code already keeps, so a ground that gains a
member gains it in one place.

The rows below without a writer still have none.

| Atom | Module | Does | Written by |
| --- | --- | --- | --- |
| `backgroundLayerHalves` | `layers/config/backgroundLayers/atoms.ts` | which ground | all three arms |
| `hybridOverlayHalves`, `hybridContoursHalves` | same | Kartverket's transparent overlay | `useLidarControls` |
| `kartVariantHalves` | `…/kartVariants.ts` | which cartography | `useKartControls` |
| `activeLidarProjectHalves`, `activeLidarStyleHalves`, `activeLidarModelHalves` | `…/lidarProjects.ts` | per-project LiDAR | `useLidarControls` |
| `lidarAutoDatasetHalves` | `…/lidarAuto.ts` | pick the dataset from the viewport | `useLidarControls` |
| `activeCvatAcquisitionHalves` | `…/cvatGround.ts` | our own cached VAT render | `useLidarControls` |
| `activeFlyfotoProjectHalves` | `…/flyfotoBackground.ts` | one NiB acquisition | `useFlyfotoControls` |
| `lidarPickerOpenHalves` | `…/lidarRelevance.ts` | that half's dataset pulldown is open | `useLidarControls` |
| `viewModeAtom` | `map/compare/halves.ts` | one ground, the curtain, or the split | `useViewControls` via `selectViewModeAtom` |
| `compareSplitAtom` | `map/compare/atoms.ts` | where the curtain's edge sits | `CompareCurtain` |
| `activeThemeLayersAtom` | `layers/atoms.ts` | which Kulturminner layers | `useHeritageControls` |
| `heritageDetailsAtom`, `heritageRenderAtom`, `heritageOpacityAtom`, `heritageHiddenAtom` | `layers/heritage.ts` | how they are drawn | `useHeritageControls` |
| `heritageTipAtom`, `heritagePopupAtom` | `map/featureInfo/atoms.ts` | what the pointer found, and what a click kept | `useHeritageInfo` |
| `terrainWindowAtom`, `terrainAdjustingAtom` (+ the `open`/`adjust`/`close` writers) | `terrain/window.ts` | the rectangle under analysis, null for no analysis, and whether it is still being placed | `useTerrainToggle`, `useTerrainControls`, `windowAdjust.ts` |
| `spotDraftAtom`, `spotFormAtom`, `spotSketchAtom` (+ the `open`/`edit`/`close`/`setStage` writers) | `spots/atoms.ts` | the lokalitet being written: where its pin is and which gesture has the pointer, what has been typed, what has been drawn | `SpotToggle`, `useSpotDraft`, `pinAdjust.ts`, `SketchCanvas` |
| `activeSpotAtom` | same | the lokalitet being read — opened by a click or by `?lok=` | `useSpotLayer`, `useSpotShareLink`, `SpotCard`, `useSpotDraft` |
| `sketchSessionAtom` | `sketch/session.ts` | the map is frozen and Excalidraw has it | `useSketchSession` |
| `currentUserAtom`, `isAuthDialogOpenAtom` | `auth/atoms.ts` | who is signed in, and whether the dialog is up | `pbAuthSyncEffect`, `AuthButton`, `AuthDialog` |

The URL still carries `projection`, `backgroundLayer`, `hybrid`, `contours`,
`lidarModel`, `themeLayers`, `heritage*`, `lat`, `lon` and `zoom`
(`UrlParameter`, `src/shared/utils/urlUtils.ts`), so a cold load lands where it
is told, plus `lok` — the only parameter that names a record rather than a
setting, written by whatever lokalitet is open and read once at import
(`src/spots/shareLink.ts`). `sok`, `markerLat`, `markerLon` and `showSelection`
went with the surfaces that wrote them. The A half is what all of that
describes: the view mode and everything in B are session state.

## Two grounds at once

`viewModeAtom` has three values, and the two that are not `single` put a second
ground on the screen:

| View | Is |
| --- | --- |
| `single` | one ground over the whole map |
| `curtain` | two grounds in one viewport, B clipped to the right of a draggable edge |
| `split` | two viewports side by side on one shared `View`, so the centre of each half is the same point |

The split is two OpenLayers maps sharing one `View` **object**, not two views
kept in step: same centre, resolution and projection at every instant, each
rendered into its own half-width viewport, and dragging either one moves both.
The second map is `compare/splitMap.ts`, a lazy module singleton — `peekSplitMap`
answers "is there one" without making one, which is what lets the tile guard and
the theme-layer effect walk whatever maps exist. Its header records why
translating the B stack inside one map was rejected.

The B ground's layers carry a `cmp.` prefix and go into whichever map the view
mode names (`compareHostFor`). An OL layer belongs to one map at a time, so a
change of view resolves the B stack afresh in the new host rather than moving
layers between collections; the reuse signature is namespaced too, so A and B
never share an instance. The host is resolved once, from the mode the effect
read, and the map it is *not* is emptied before the build rather than after it
(`clearCompareLayersExcept`) — every way a build can end without installing
would otherwise leave the previous view still drawing. Emptying it retires its
layers into the pool (`layers/layerPool.ts`, `docs/map-layers.md`), and a pooled
layer is on no map, so the new host's build takes back the instances the old one
just gave up: the stack is resolved again, but its tiles are not refetched.

Neither two-ground view is persisted to the URL: a shared link opens on one
ground and the reader asks for the second, rather than every recipient landing
in two-ground spend on a rate limit this deployment shares across every visitor.
B is culled to what it actually shows in both shapes, so that spend is a second
stack's worth of layers and queue pressure rather than a second viewport's worth
of tiles — `docs/wms-proxy-and-tiles.md` has the per-shape numbers.

Entering a two-ground view seeds every `.b` from its `.a` (`seedHalfB`, a
registry rather than a list, so a pair added later cannot open B on a `null`),
then moves B off A: onto whichever of relief and cartography A is not, with
Automatisk off, because a comparison term that follows the viewport is not a
comparison term. B enters LiDAR on the national mosaic rather than on the flight
the half is holding — that flight is wherever the reader last looked at one, and
with the pin just set nothing would re-rank it against this screen. Moving
between the curtain and the split leaves B where the reader put it.

What is mirrored into the second pane and what is not: the Kulturminner theme
layers are, because a ticked register belongs to the reading rather than to a
half (`syncThemeLayers`, called once per map). The LiDAR footprint outlines are
split rather than mirrored — one viewport query for both halves, but a layer per
pane drawing that pane's own flight, because an outline over the wrong ground
names the wrong picture (`footprintTargets`). The heritage tip and card are
not there at all — `src/heritageInfo/` and `src/map/featureInfo/` are wired to
the main map, so the right-hand pane draws the register but does not answer
questions about it. Nor is the terrain analysis: `terrainLayer.ts` and the
window frame both add to the main map, so the second pane shows the ground the
analysis was framed over and not the analysis.

## Loose ends, deliberately left

- **`@tanstack/react-query` is listed and imported by nothing.** Removing a
  dependency means regenerating `package-lock.json`, which the workstation
  cannot do; it is one server-side `npm install` whenever something else needs
  one anyway. `@excalidraw/excalidraw` and `pocketbase` were on this list and
  are off it — `src/sketch/` and `src/api/` import them, and the Excalidraw
  font plugin is back in `vite.config.ts`.
- **PocketBase still carries the old collections.** `localities`, `finds` and
  `attachments` are untouched on disk and unreferenced by the client, which now
  reads `spots` and nothing else. Nothing was dropped: the old rows are test
  data on a test host, and a migration that deletes three collections is worth
  writing once, when there is no chance of wanting to read them again.
- **`scripts/live-check.sh` still probes the old collections** and takes a
  lokalitet code. Its raster half — the one that matters on this branch — is
  correct; the PocketBase half checks a schema the client no longer reads, and
  wants rewriting against `spots` and a spot code.
- **No route but `/`.** Caddy has no SPA fallback, unchanged. `/l/<code>` is a
  `redir` to `/?lok=<code>` on one narrow pattern and not a route — a catch-all
  rewrite to `index.html` would turn every wrong path into a 200.
- **A lokalitet has no index but the map.** Your spots are pins where they are;
  there is no list, no ordering by date and no way to find one whose ground you
  cannot remember. That is the next surface this subject wants, and it probably
  arrives with the search box rather than before it.
- **Only `nb` is a moving target.** Strings still go through `t()` so the
  retrofit stays free, but `nn` and `en` carry only what survived the cut and
  are not expected to keep pace until the interface stops moving.
- **Map z-indices 5 and 7–9 are free.** They were the old interface's overlays;
  2 has since gone to a lokalitet's drawing and 6 to its pin, and
  `docs/map-layers.md` records what occupies the rest.
- **`lidarCyclingAtom` has a reader and no writer.** `lidarFootprintsLayer`
  keeps the viewport list warm while the keyboard ring walks datasets, and the
  ring (`useBackgroundCyclingKeys`, W/S/A/D/E) went with the old shell. It costs
  nothing false today and comes back with those keys.
- **The second pane is looked at, not asked.** The Kulturminner tip and card
  come off the main map only, so a feature under the right-hand half of a split
  answers nothing. Same for the terrain analysis — frame and render both — and
  the LiDAR extract. Wiring
  `src/map/featureInfo/` to whichever map was clicked is the fix; nothing here
  assumes one map except those callers.
- **There is no search box.** The ground section is built, the view section is
  built, and the tool section holds the Kulturminner overlay, the terrain
  analysis switch, the lokalitet `+` and the account. Search is the next surface
  in, and the tool section is where it goes: it belongs to no ground.
- **Hybrid is a LiDAR control, not a tool.** The overlay went into the LiDAR
  arm rather than the tool section because `resolveStack` draws it only over a
  LiDAR ground (`LIDAR_LAYERS`) — a switch in the tool section would be inert
  on two of the three grounds. If the overlay is ever wanted over ortofoto,
  which is what "hybrid" means in Norgeskart, both the test in `resolveStack`
  and the control's home move together.
- **Nothing walks the rings.** The arms list and pick; there is no W/S step
  through datasets, variants or acquisitions, because those keys went with the
  old shell (`lidarCyclingAtom` above).
