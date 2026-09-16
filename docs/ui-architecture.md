# UI architecture — the status quo, and the contract a replacement inherits

The interface was inherited Norgeskart chrome, de-branded and extended sideways
until it carried features it was never shaped for. It is being replaced. Two
slices of that have landed. First: the map became the full window, the chrome a
**ribbon** floating over it, and new code moved onto an in-repo plain-CSS kit
(`src/ui`) instead of kvib — which is now gone entirely (§12). Then the ribbon
turned out to be the wrong container for anything with a body, and the second
slice reshaped the app around the work loop it exists for:

- everything about the thing you are working on is reached from **its own
  ribbon row plus the bottom edge of the map** (§8) — the right-hand dock that
  held it is gone, and the ribbon is thin rows with no bodies in them;
- **all framing is chrome-aware** — `chromeInsets` measures what the floating
  surfaces are covering, so the map fits its subject into the free area (§3.1);
- lokalitet rectangles and funn are **cased frames over the relief, not tints
  across it** (§8.6), and clicking one on the map selects it everywhere at
  once — the row's `Funn ▾` list and the callout beside the shape;
- the five grounds — Standard, LiDAR, Hybrid, Flyfoto, **Terreng** — are one
  ring of buttons with digits 1–5 and a hold-to-peek key (§5.1, §5.3);
- a funn is **saved from the moment its first shape closes** (§8.5); there is no
  Lagre and nothing to discard.

This document exists so the rest can be planned without archaeology: what is on
screen today, what holds it up, which parts are load-bearing engineering and
which are accidents of the fork, and — most importantly — **the complete
inventory of things a user can do** (§13), so none of it gets dropped on the way
across.

The functional goal the UI serves, stated once so it can be designed for rather
than reconstructed: *an amateur reads relief-shaded LiDAR terrain against the
heritage record, spots something, boxes it, and works it up.* Every affordance
below is either in service of that or is upstream residue.

Companion reading: `docs/map-layers.md` (what the grounds and theme layers
actually are, and how to add another), `docs/terrain-analysis.md` (what the
Terreng panel is driving), `docs/wms-proxy-and-tiles.md` (why layer switching is
shaped the way it is), `docs/analysis-roadmap.md` (what the workspace is
expected to grow).

---

## 1. Three invariants a replacement must not break

Everything else in this document is description. These three are constraints,
and each has already cost a debugging session.

**One slot, one occupant — but only where the slot is really one.** Running a
LiDAR extract and reading terrain are the same slot: `ribbonToolAtom`
(`src/localities/toolAtoms.ts`) holds at most one of `'lidar' | 'terrain'`, and
picking one drops the other. Drawing is deliberately *not* in that slot. It is
its own question, asked of the drawing session — `funnDraftActiveAtom` is
derived from `funnSessionAtom?.mode === 'funn'` rather than held, because a
flag beside the session is a flag that can disagree with it, and "the draft
band is up but the canvas never opened" is exactly the state a failed frame
capture falls into. A funn draft and a terrain render can be live together:
terrain is a read-only view of the same rectangle and tracing what it shows is
the reason to have it up. They do not compete for a surface — the draft owns a
thin ribbon row, and Terreng's knobs are on the settings strip.

`workspaceModeAtom` still derives the single answer
(`'draft' | 'lidar' | 'terrain' | 'browse'`) and is what the ribbon's button
highlighting and `useWorkspaceKeys`' `navigable` flag read. Surfaces that have
to be up at the same time read the two underlying flags instead, precisely
because collapsing them to one answer is what would force them apart again.
`MapTool`
(`'measure' | 'localities' | null`, `src/map/overlay/atoms.ts`) is
separate state again, so a map tool card and an open lokalitet cannot fight over
the same real estate.

What must not come back is the version where a tool surface *replaced* the
content it was about: starting to draw hid the list of what you had already
drawn, and running an extract hid the gallery it was about to add to.

**OL interactions are owned, not scanned for.** `src/map/interactions.ts` tags
every interaction with an owner (`draw`, `measure`, `localityAdjust`,
`lidarExtract`) on the way in and filters by owner on the way
out. Four tools add the same OL classes; before tagging, "remove every `Draw`"
in one tool silently detached another's, and a lookup by `instanceof` returned
whichever happened to be first in the collection. A new UI that adds its own
interactions must use this registry. (`getOwnedInteractions` also returns a
fresh array on purpose — the live `Collection` array is walked by index with the
length read up front, so removing while iterating skips entries, and every
caller here removes while iterating.)

**Keyboard is layered by capture phase.** The OL map is constructed with
`keyboardEventTarget: document`, so `KeyboardPan` sees every keystroke on the
document and does not check `defaultPrevented`. Any app-level key binding that
must beat the map has to listen in the **capture** phase and call
`preventDefault` + `stopPropagation` + `stopImmediatePropagation` — a
bubble-phase listener will fire *and* pan the map out from under itself.
`useWorkspaceKeys` and `useBackgroundCyclingKeys` both do this.

The layers also have to stand down for each other. Each checks `event.target`
for an input, a `contentEditable`, or an enclosing
`[data-scope="popover"|"dialog"|"select"]`, and then checks
`anyOverlayOpenAtom` — the attribute walk only works if the overlay took
focus, so anything that renders without doing so needs the counter.

---

## 2. Stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | React 19 | `StrictMode` on, so effects double-invoke in dev |
| Build | Vite 8, TypeScript ~7.0.2 | oxlint + prettier; vitest for the handful of unit tests |
| Design system | `src/ui` + CSS Modules | in-repo, zero deps; see below |
| Fonts | `@fontsource/mulish` | four weights, self-hosted, imported in `mainApp.tsx` |
| State | jotai ^2.20.3 + `jotai-effect` | default store, no `<Provider>` |
| Map | OpenLayers ^10.10.0 | EPSG:25833 via proj4 |
| Backend | PocketBase JS SDK ^0.28 | lokaliteter, auth, attachments |
| Server state | `@tanstack/react-query` | one consumer: the elevation lookup |
| i18n | i18next / react-i18next | nb, nn, en |
| Icons | `material-symbols` (rounded) | typed union, see §11 |
| Routing | react-router-dom | two routes: `/` and `/hjelp` |
| Drawing | `@excalidraw/excalidraw` ^0.18.1 | the whole pen surface, §9; assets served locally, see below |

**One system, in-repo.** `src/ui/` is a small primitive kit — plain CSS
Modules over custom properties, no new npm dependency, because
`package-lock.json` cannot be regenerated on the workstation this is developed
on. It exports `Button` / `IconButton`, `Badge` / `CountBadge`, `Popover`,
`Menu`, `Dialog`, `Tooltip`, `Switch`, `Segmented`, `Section`, `Field`
(`Input` + `NoteInput`), `ConfirmPopover`, `Alert`, `Spinner`, `Icon`, `toast` /
`Toaster`, `cx`, `useMediaQuery` and `overlayAtoms`. Every surface in the app
renders through it.

**The no-new-dependency rule has been broken exactly once, on purpose.**
`@excalidraw/excalidraw` came in to replace ~3500 lines of fork-local drawing
code (§15), which is the trade that justifies the cost of regenerating the
lockfile off-workstation; it is not a precedent for a component library. It
also brings one deploy-relevant detail: Excalidraw fetches its fonts from a CDN
unless told otherwise, which `font-src 'self'` in the Caddyfile forbids. Two
halves fix that and both are load-bearing — `src/funn/excalidrawAssets.ts` sets
`window.EXCALIDRAW_ASSET_PATH = '/'` (a module of its own, imported first,
because the same assignment inside `FunnCanvas.tsx` would run *after* the
Excalidraw import), and the `excalidrawFonts` plugin in `vite.config.ts` copies
the font directory out of `node_modules` into the build and streams it in dev.
Drop either and text on a funn 404s under CSP, in production only.

`src/ui/tokens.css` is the single source for colour, spacing, radius, shadow,
control heights and — the one that was genuinely scattered before — the
**z-index ladder**: `--z-map: 0`, `--z-map-controls: 1`, `--z-overlay: 2`,
`--z-ribbon: 20`, `--z-popover: 1200`, `--z-tooltip: 1300`,
`--z-toast: 1400`. There is no `--z-dialog` because `Dialog` is a native
`<dialog>` opened with `showModal()`, which puts it in the browser's top layer
above everything.

`Toaster` reaches that same top layer by a different door: the region is a
`popover="manual"` element, not a z-index. Toasts are fired from inside modal
dialogs — a failed save from a lokalitet dialog — and an ordinary z-index loses
to the top layer, i.e. the message would be invisible exactly when it matters.
`--z-toast` is only the fallback for browsers without the popover API. Its
store is a module-level list read through `useSyncExternalStore` rather than an
atom: `toast.error(…)` is called from non-React modules, and one component
reads it.

**Layout and typography have no primitives, and that is the convention.**
There is no `Box`, `Stack`, `Text` or `Heading` in `src/ui` and none is coming.
A ported component gets a co-located `Foo.module.css` and writes plain
`div` / `span` / `p` / `h2` with `font-size: var(--font-sm)` and
`gap: var(--sp-4)`; the kit is only for things with behaviour or a shape worth
sharing. Flexbox in a stylesheet is shorter than `<VStack align="flex-start"
gap={2}>`, owes nothing to a component library that can be swapped out under
it, and keeps the styling of a surface in one readable place instead of spread
across a hundred props.

Buttons colour themselves from `--c-fg` / `--c-bg-hover` / `--accent-*` rather
than from literals, so a surface that needs a different ground overrides those
custom properties on its own container. That is what the deleted extract
viewer's dark chrome was: re-pointing two variables, with no dark variant of
`Button.module.css` anywhere.

**kvib is gone** (§12). `src/index.css` carries the reset it used to supply,
Mulish is imported directly, and the `MaterialSymbol` union comes from
`material-symbols` itself. There is no dark mode.

Hand-written CSS is now the `src/ui/*.module.css` files plus one module per
ported component, on top of `src/index.css` and `src/map/map.css`
(79 lines). The latter is entirely OL control skinning: the `.ol-scale-line`
position (with a mobile breakpoint that recentres it), the `.ol-tooltip` family
used by the measure and draw tools, a `.hidden` utility that
`drawControls/drawUtils.ts` toggles via `classList`, and
`#map { touch-action: none }`. All of it survives further rewriting unchanged
as long as the same class names reach the DOM.

---

## 3. Boot and the component tree

```
main.tsx → mainApp.tsx
  StrictMode
    BrowserRouter
      AtomWrapper            ← hydrates activeThemeLayersAtom from ?themeLayers
        QueryClientProvider
          App                ← routes + F11 + auth sync
          Toaster
```

`mainApp.tsx` also side-imports the four Mulish weights and
`material-symbols/rounded.css`. No provider wraps the tree for styling: the
kit reads `src/ui/tokens.css`, which `src/index.css` pulls in.

`projInit()` runs at module scope in `mainApp.tsx`, before render — proj4 has to
know EPSG:25833 before any atom touches a coordinate.

`AtomWrapper` hydrates exactly one atom, and its comment records why it is only
one: `backgroundLayerAtom` validates its own URL parameter against a whitelist
in its default-init function, and hydrating it a second time here would bypass
that check and could leave the atom on a value the effect cannot render (e.g.
`lidarProject` with no active project), i.e. a blank map on cold load.

`App.tsx` mounts `pbAuthSyncEffect` **above** the router — signing in must not
depend on which route is showing — then routes `/` → `AppShell` and `/hjelp` →
`HelpPage`. It used to hold `<LidarExtractViewer />` outside the router too, so
that the fullscreen extract result survived navigation; the picker carousel
(§8.9.3) took that job and lives in the bottom slot like everything else.

### 3.1 Shell geometry

`src/shell/AppShell.tsx` (~75 lines) plus `AppShell.module.css`. **The map is
the window and the chrome floats over it**, which is the single geometric
decision everything else follows from.

```
.shell   position:relative  height:100dvh  overflow:hidden
├── .map      position:absolute inset:0  z --z-map     ← OL target div, full bleed
└── .overlay  position:absolute inset:0  z --z-overlay
              display:flex  flex-direction:column  pointer-events:none
    ├── .ribbon   flex:0 0 auto   pointer-events:auto   z --z-ribbon
    │     └── Ribbon                  ← row 1, the settings strip,
    │                                   the lokalitet row
    ├── .row      flex:1  min-height:0  position:relative  pointer-events:none
    │     ├── .left    absolute top/left/bottom          SearchComponent + MapToolCards
    │     └── .right   absolute top/right  360→400px       InfoBox, and only that
    └── .bottom   flex:0 0 auto   pointer-events:none   z --z-ribbon
          └── the bottom slot   ← one of: BilderStrip, BilderCarousel,
                                  BilderPicker (§8.7.2)
```

Siblings of the whole thing: `KulturminnerPopup`, `AuthDialog`.

Details that are easy to lose:

- **No height measurement in the *layout*.** `.overlay` is an ordinary flow
  column that *contains* the ribbon, so the ribbon's natural height pushes the
  slots below it down with zero JS — no ResizeObserver, no CSS variable.
  Growing a ribbon row therefore costs nothing, and because the OL canvas never
  resizes it provokes no new GetMap requests. The old `calc(100vh - 65px)` /
  `calc(100vh - 80px)` guesses at the header height are gone; the slots have a
  definite height and their cards say `100%`.
- **`.right` holds one card.** It was a dock column — infobox on top,
  whichever dock was live under it — and needed `bottom: 0` so a child asking
  for `max-height: 100%` had a containing height. Both docks have gone
  (Terrenganalyse's to the ribbon, the lokalitet's to the row and the bottom
  edge), the infobox sizes itself at `max-height: 52vh`, and the slot is a
  plain top-right column: 360 px from `48rem`, 400 px from `62rem`, full width
  below that.
- **`.bottom` is in flow, not floated.** It is a flex child of `.overlay`
  *after* `.row`, exactly like `.ribbon` before it: its own height shortens
  `.row`, so the left and right slots end where the bottom edge begins with no
  media query and no z-index fight. Floating it over `.row` instead would mean
  every card in those slots had to be told how tall this one is.
- **`.map` must stay a *sibling* of `.overlay`, never its parent.** F11 calls
  `requestFullscreen()` on the map target element, and parenting the chrome
  inside it drags the chrome into fullscreen.
- **`pointer-events: none` all the way down, `auto` only on leaves.** Every
  element in `.overlay` spans the whole viewport now, not just a 400 px
  column, so one stray `auto` on a container stops the map being panned
  *anywhere*.

The lokalitet rows are keyed on `locality.id` in `Ribbon.tsx`, which remounts
the workspace controller with fresh form state. Without the key, opening a
second lokalitet shows the first one's half-typed name.

Error boundaries are per ribbon row and per bottom-slot occupant, not one
around the bar: a crash in the terrain panel should not take the search field
and the background controls with it, and the map underneath stays usable either
way — which is the whole reason the chrome floats over it. `RibbonLocalityRow`
is outside the boundary that wraps the bottom edge for the same reason: if the
carousel throws, you still need the exits to get out of the lokalitet.

#### `data-chrome`, and why nothing hard-codes a padding

The chrome floats *over* the map, so the map's own size says nothing about how
much of it you can see. Anything that frames something — fitting a lokalitet's
rectangle, seeding a new one from the viewport, zooming to a funn, marking a
search result — has to work in the free area, or it centres its subject
underneath the ribbon or behind the bottom edge.

`src/shell/chromeInsets.ts` answers that. Surfaces opt in by carrying
`data-chrome="top|right|bottom|left"`; `chromeInsets(map)` walks them, measures
each one's depth into the map viewport, and takes the max per edge.
`fitPadding(map, margin)` adds breathing room and is what every `view.fit` call
passes — replacing the hard-coded `[80, 80, 80, 80]` and `[120, 120, 120, 120]`
that the floating shell had made unknowable in the first place.

Three properties of it are deliberate:

- **Generic, not a registry.** The lone predecessor was a `ribbonHeight()` that
  measured `[data-ribbon]` and knew about no other edge. A new panel joins the
  calculation by declaring which edge it hugs, with nothing to register
  anywhere — which is how the four bottom-slot occupants all count as the same
  `data-chrome="bottom"` without any of them knowing about the others.
- **Measured on demand, never observed.** No ResizeObserver, no layout state,
  no re-render; the values are read at the instant a fit is computed. A folded
  bottom edge is unmounted, reports no rect, and drops out on its own.
- **Opposing paddings are clamped together** to 70 % of the viewport. Two that
  together exceed it cannot both be honoured, and `View#fit` answers an
  over-constrained rectangle by zooming out to nothing useful.

### 3.2 Where map side-effects mount

`src/map/MapComponent.tsx` is 39 lines and renders essentially a target div —
but it is the **only** mount point for three atom effects (`themeLayerEffect`,
`trackPostitionAtomEffect`, `backgroundLayerAtomEffect`).

Everything else is `src/shell/useMapSideEffects.ts`, called once by `AppShell`:
`useFeatureInfoClick`, `useSearchEffects`, `useMapClickSearch`,
`useLocalitiesLayer`, `useFunnLayer`, `useFunnHighlightLayer`, `useFunnPointer`,
`useLocalityClick`, `useLidarFootprintsLayer`, `useBackgroundCyclingKeys`.

This is the sharpest coupling between "the UI" and "the map": these are not
presentational components, they are the wiring that puts layers on the map.
Three of them register a `singleclick` handler on the same OL map and the
order is preserved on purpose. `useLidarFootprintsLayer` looks like decoration
and is not — it is the only writer of `lidarViewportAtom`, which both the
dataset pulldown and W/S cycling read. And it must be mounted **exactly once**:
the three layer hooks each hold a PocketBase realtime subscription whose
cleanup calls `source.clear()`, so a second mount gives duplicate features and
double reloads, and unmounting either one empties the layer.

`MapComponent` itself is unconditional, unkeyed and never moved in the tree.
`useMap`'s `setTarget` is a no-op when the map already has one, so a second
instance silently attaches nothing and then blanks the map when the first
unmounts.

### 3.3 Stacking order

Two independent ladders. **OL layer `zIndex`** (map-internal): background stack
at 0 (it sets none), the ground overlay 1 — one layer and one canvas holding
the whole of [Visning] and [Bilde], bottom to top (§8.7.1, §10.1) — the compare
curtain's B stack 1.5, the shown sketch overlays 2 (`Z_INDEX` in
`src/map/sketchOverlay.ts`, §9.3), measure / theme layers 3, active theme layer
promoted to 10, lidar footprints 3, localities 4, funn highlight 4.5, funn 5,
`propertyGeometryLayer` 5, `markerLayer` 6, locality adjust 8. The fractional
4.5 and 1.5 are the tell that this ladder grew by insertion rather than design.
Nothing sits at 7 any more: the old `drawLayer` / `drawOverlayLayer` went with
`src/draw/` (§15) and the lidar extract's own selection rectangle went with the
picker carousels (§8.9.3).

`COMPARE_Z = 1.5` (`src/map/compare/curtainLayers.ts`) is a real constraint,
not a free choice: the B half has to cover the A background *and* the terrain
render — Terreng on the left against a photograph on the right is one of the
comparisons worth making — while staying under everything drawn on top of the
ground. A funn, a measurement or a pen stroke in progress that vanished when
the curtain was dragged over it would be exactly the thing compare was opened
to look at.

**DOM `zIndex`** (chrome) is entirely named in `src/ui/tokens.css` and listed
in §2 — no raw numbers left anywhere in `src/`.

---

## 4. State

### 4.1 jotai on the default store

There is no `<Provider>`, so everything lives in jotai's default store. That is
load-bearing rather than lazy: non-React code (OL event handlers, the URL
sync, `screenshot.ts`) reaches state with `getDefaultStore()`. A rewrite that
introduces a scoped `Provider` has to find and fix every one of those callers.

`mapAtom` (`src/map/atoms.ts:87`) is a read-only atom whose init function
lazily constructs the `ol/Map`. This is how a single map instance is shared
across the tree without prop drilling or context, and it is the reason
components can be freely reordered.

Map construction options worth knowing before touching the shell:
`defaultControls({ zoom: false, rotate: false })` — **the stock OL zoom buttons
and north arrow are deliberately off**; a single `ScaleLine({ minWidth: 100 })`
is the only OL control on screen; `defaultInteractions({ altShiftDragRotate:
false, pinchRotate: false })` — the map cannot be rotated;
`keyboardEventTarget: document`; `maxTilesLoading: 48` (rate-limit
countermeasure, see the tiles doc). The view is `minZoom: 3`, `maxZoom: 20`,
`constrainResolution: true` (integer zoom levels only), default projection
EPSG:25833, default centre `[396722, 7197860]`.

### 4.2 The atom inventory

Grouped by owner; this is the state a replacement has to keep, rename or
subsume.

- **Map core** — `mapAtom` (`src/map/atoms.ts`, which also holds the
  `DEFAULT_PROJECTION` / `DEFAULT_ZOOM_LEVEL` / `DEFAULT_CENTER` constants) and
  `trackPositionAtom` (`src/map/geolocation/atoms.ts`). Zoom and full-screen
  are read off the OL view and the DOM rather than mirrored into atoms.
- **Background** — `backgroundLayerAtom`, `standardVariantAtom`,
  `hybridOverlayAtom`, `hybridContoursAtom`,
  `activeLidarModelAtom`, `activeLidarStyleAtom`, `activeLidarProjectAtom`,
  `lidarPickerOpenAtom`, `lidarCyclingAtom`, `lidarAutoDatasetAtom`,
  `activeFlyfotoProjectAtom`, plus
  the viewport project list. The flyfoto acquisition list is *not* an atom —
  nothing draws its footprints, so it is component state in
  `useFlyfotoControls`.

  Eight of those are **halved** (§5.8): `backgroundLayerAtom`,
  `standardVariantAtom`, `hybridOverlayAtom`, `hybridContoursAtom` and the four
  LiDAR/flyfoto dataset
  atoms are each the `focused` facade over an `{ a, b }` pair from `halved()`,
  exported under the name they always had. Everything reading them keeps
  working unchanged; the
  two stack effects reach past the facade to `.a` and `.b`. `halved()` also
  registers a seeder, so a pair added later is copied A→B on entry for free.
- **Sammenlign** — `compareOnAtom`, `compareFocusAtom` and the derived
  `focusedHalfAtom` (which of the two the ribbon writes; always `'a'` with the
  curtain down) in `src/map/compare/halves.ts`, and `compareSplitAtom` (0–1,
  where the divider is) in `src/map/compare/atoms.ts` (§5.8). None are
  persisted to the URL. `halves.ts` imports nothing but jotai on purpose — the
  background config imports it, so anything else would be a cycle. The split is
  read by the OL render handlers through
  `setCurtainSplit`, so `compareLayerAtomEffect` deliberately does *not* depend
  on it — dragging the divider must not rebuild a tile stack.
- **The funn switches** — `funnHiddenAtom` for the whole group and
  `funnSwitchedOffAtom` (a `Set` of the ids that are *off*) for one member at a
  time, both in `src/localities/atoms.ts` and both read by `useFunnVisibility`
  (§8.6). Two atoms rather than one for the reason `sketchGroupShownAtom` is
  not `sketchShownAtom`: the group flag and the members are different
  statements, and switching the group back on has to restore the composition
  that was up. Neither is persisted to the URL; the member set is cleared when
  the lokalitet closes or swaps.
- **The ground group** — four in `src/map/groundOverlay.ts`, all read by
  `VisningControl` and none persisted: `groundShownAtom` (the ground preset's
  own switch), `visningShownAtom` (the ids of the Views currently on the
  ground — a set, like `sketchShownAtom`, because several may be up at once),
  `visningOpacityAtom` (per-View fade in percent, missing meaning opaque) and
  `visningGroupShownAtom` (`[Visning ▾]`'s label toggle). The same group/member
  split as the funn and sketch switches, for the same reason, and all four are
  reset by `useLocalityWorkspace` when the lokalitet closes or swaps. They live
  with the stack rather than in `src/localities/atoms.ts` because what they
  describe is the map's `zIndex: 1` composite, which outlives any one lokalitet
  surface (§10.1).
- **Theme layers** — `activeThemeLayersAtom` (a `Set<ThemeLayerName>`), plus
  `heritageDetailsAtom` / `heritageRenderAtom` / `heritageOpacityAtom` in
  `src/map/layers/heritage.ts` for how the Kulturminner overlay is drawn.
- **The heritage eye** — `heritageHiddenAtom` (`src/map/layers/heritage.ts`),
  read by `themeLayerEffect`, which hides the layers without touching the
  selection; `shownThemeLayersAtom` is the two combined, i.e. what is actually
  drawn (§5.9). Not persisted to the URL.
- **Chrome** — `mapToolAtom`, `overlayOpenCountAtom` / `anyOverlayOpenAtom`
  (`src/ui/overlayAtoms.ts`, incremented by every `Popover` and `Dialog` so the
  keyboard layers can stand down).
- **Ribbon / workspace** — `ribbonToolAtom`, the derived `workspaceModeAtom`,
  `localityDetailsOpenAtom`, `bilderStripOpenAtom`, `funnOutsideAtom`
  (`src/localities/toolAtoms.ts`), `bottomSlotAtom`
  (`src/shell/bottomSlot.ts` — the portal target for the bottom edge, a DOM
  node rather than a value, §8.7.2) and `groundHandleAtom`
  (`src/shell/groundHandle.ts` — the slice of `useGroundMode` the lokalitet
  row's Terreng and Sammenlign buttons render from, §8, published across the
  sibling gap the same way `beholdOfferAtom` is).
- **Search** — query, results, selected result, marker, infobox visibility.
- **Feature info** — the clicked-position readout and the Kulturminner popup,
  plus `infoToolAtom` and the two derived `heritageClickArmedAtom` /
  `infoClickArmedAtom` (`src/map/featureInfo/infoTool.ts`), which decide what a
  map click asks — the heritage overlay answers on its own, the point readout
  waits for the tool (§7.1). Not persisted to the URL.
- **Drawing** — three, all in `src/funn/session.ts`: `drawRequestedAtom` (the
  pen was pressed, and a `DrawRequest` rather than a boolean — which of the two
  things the pen makes is being made, `mode: 'funn' | 'sketch'`, plus the
  geometry to open on when a funn is being re-drawn and the stored scene to
  open on when a sketch is), `funnSessionAtom` (the map is frozen and the
  surface is live, holding the frame and the request that opened it), and
  `funnSceneAtom` (what is currently drawn).
  Three more sit with the overlays rather than the session, all in
  `src/map/sketchOverlay.ts` and all view state that is never stored:
  `sketchShownAtom`, the set of sketch ids currently on the map — a set rather
  than an id because several may be shown at once (§9.3) — plus
  `sketchOpacityAtom` (per-sketch fade in percent, missing meaning "as drawn")
  and `sketchGroupShownAtom`, `[Skisse ▾]`'s own label toggle, which is a flag
  of its own precisely because it is not the same statement as every member
  being off.
  The asymmetry between the first two is load-bearing and §9.1 explains it;
  only the second may be used to decide that something else is inop. This used
  to be the largest cluster in the app — `src/settings/draw/atoms.ts`, 375 lines
  of tool, colour, width, line style, point style, text style, measurement
  toggles and undo/redo stacks — and Excalidraw owns all of that now (§15).
- **Lokaliteter** — `activeLocalityAtom`, `localityPlacementAtom`
  (`src/localities/placement.ts` — the rectangle being placed before there is a
  record under it, §5.6; mutually exclusive with `activeLocalityAtom` by
  construction), `funnDraftActiveAtom`,
  `adjustingLocalityAtom`, `selectedFunnIdAtom` / `hoveredFunnIdAtom` (written
  from the `Funn ▾` list and from the map, §8.6), content caches. Plus
  `recreateViewAtom`
  (`src/shell/useRecreateView.ts`) — a *command* atom rather than state: it
  holds a `ViewSpec` only long enough for the hook mounted beside the control
  hooks to apply it, then clears itself.
- **LiDAR extract** — no atoms. `src/lidarExtract/` holds run status and the
  result canvas as component state in `LidarExtractDialog`, and the selection
  rectangle went with the picker carousels (§8.9.3): the rectangle extracted
  is the lokalitet's own.
- **Auth** — `currentUserAtom`, `roleAtom`, `isAdminAtom`, dialog open state.

### 4.3 URL persistence is hand-rolled

`src/shared/utils/urlUtils.ts` owns it: a `NKUrlParameter` string union, getters
that parse and validate, and a writer that mutates the URL with
`history.replaceState` (never `pushState` — **the back button does not undo map
navigation**, by omission rather than decision). There is also a migration path
for the legacy Norgeskart `#!?` hash format.

Live parameters: `lat`, `lon`, `zoom` (written on every map `moveend`),
`backgroundLayer`, `hybrid`, `contours`, `lidarModel`, `themeLayers`,
`heritageDetails`, `heritageRender`, `heritageOpacity`, `sok`, `markerLat`,
`markerLon`, `showSelection`, `lok`.

`backgroundLayer` carries the Standard cartography as well, because a variant
*is* a layer name (§5.10) — so there is no second parameter, and
`standardVariantAtom` seeds itself from that one on a cold load rather than
letting the two disagree about a shared link.

The three `heritage*` ones are written from `themeLayerEffect`, not from their
setters, so a link always describes what is on the map; each is *removed* at
its default rather than written, keeping a shared URL down to what the sender
changed. `heritageDetails` is read with `getUrlParameter` and split by hand
rather than with `getListUrlParameter`, because that helper cannot tell an
absent parameter from an empty one and "no sublayers" is a state the picker can
reach.

`lok` is the odd one out and the only one that can *fail*: every other
parameter names a setting, and this one names a record. It carries the
lokalitet's six-character code rather than its PB id, and
`src/localities/shareLink.ts` owns both directions of it — see §8.13, which is
where the reason each half is shaped the way it is lives. The one thing worth
repeating here: the boot code is read at **module import**, not during the
first render, because the writer deletes `lok` whenever nothing is open and on
a cold load nothing is.

Dead entries still in the union: `rotation`, `drawing`, `printTool` have no live
writers, and `projection` is read but never written. Not persisted at all,
though arguably they should be: the active LiDAR **style** and **project**.
Sharing a link to "this terrain, styled this way" is still not possible — the
lokalitet half of that gap closed with `lok`, the styling half did not.

---

## 5. The ribbon

`src/shell/Ribbon.tsx` and the components around it. **Four thin rows at
most**, and nothing with a body goes in any of them:

| Row | Component | When |
|---|---|---|
| 1 — the map | `RibbonGlobalRow` | always |
| 2 — settings for the ground on screen | `RibbonSettingsRow` | that ground has something to adjust |
| 3 — the lokalitet | `RibbonLocalityRow` | a lokalitet is open |
| 4 — the funn being drawn | `RibbonFunnDraftRow` | a funn draft is open |

Rows 1 and 2 render from the same component: both run off `useLidarControls` /
`useFlyfotoControls`, which are mounted once and only there.

There used to be four, and the rule that came out of deleting two of them is
about **bodies, not rows**. What made the old bar unusable was a tray at
`max-height: min(42vh, 380px)` and tool rows at `min(52vh, 460px)` — five
hundred pixels of chrome over the very ground the panels were describing — so
both moved out of the bar (§8). A row that cannot grow past one line costs
~40 px and keeps a control next to the thing it names, which is why the
settings strip is capped by contract (§5.1) rather than by a `max-height` that
would merely make it scroll.

Rows 2 and 3 are **context strips**, not surfaces. Nothing in either grows a
body *in the bar*; row 3 is identity on the left, then the two popovers over
what the rectangle holds, then the verbs that are part of the work loop, then
the exits, with the rest behind an overflow menu. A fourth row appears under it
while a funn draft is open (`RibbonFunnDraftRow`, §8.5) — one line, no body,
which is what the rule permits.

`LocalityRibbon` renders the lokalitet row and is the **one** mount point for
`useLocalityWorkspace` — that hook opens two PocketBase realtime subscriptions
that reload the whole list on every event, so a second call site doubles both.
It also renders the draft row, portals whichever surface owns the bottom edge
into the shell's bottom slot through `bottomSlotAtom` (§8.7.2), and mounts
`FunnCallout` (an `ol/Overlay`, so it is in the map's DOM rather than the
shell's), rather than hoisting an 850-line hook to a common ancestor and making
every one of its callbacks nullable: one React tree, several places in the
DOM.

`data-chrome="top"` on the bar is how framing code learns how much of the map it
covers (§3.1). Measured rather than a constant, because rows 2–4 come and go and
the rows wrap on narrow screens. The old TopBar's answer to "fourteen controls
do not fit on a phone" was `overflowX: auto` on the whole bar, which made the
pulldowns inside it clip; that is gone.

### 5.1 Row 1 and its settings strip

Left to right, and the order is the argument: find a place, choose what the
ground looks like, overlay the heritage record on it, then act on what you are
looking at. Row 1 answers **what am I looking at**; the strip under it answers
**how**, for whichever ground row 1 has selected.

| Control | What it does |
|---|---|
| `RibbonSearch` | Place/address/property search field; results render in the left slot (§7) |
| **Kart** (1) | Background mode: an ordinary map, in one of five cartographies (§5.10) |
| **LiDAR** (2) | Background mode: hillshade stack |
| **Hybrid** (3) | LiDAR stack + transparent roads/rail/place-names on top |
| **Flyfoto** (4) | Background mode: NiB ortofoto (§5.5) |
| **Kulturminner** + its eye | One split control: the noun opens a popover over the five RA sources, kulturminner2's three sublayers, how they are drawn and how strongly; the eye puts the overlay on the map or takes it off (§5.9) |
| **Stedsinfo** (I) | Arms the point readout: while it is on, a click asks the registers about that spot (§7.1). Off on arrival. It does *not* gate the Kulturminner popup — a visible heritage feature answers a click either way |
| Mål | Popover with the measure tools |
| Mine lokaliteter | Opens the localities card (signed in only) |
| Ny lokalitet | Proposes a rectangle seeded from the visible map, to move and size before `Opprett` writes it (signed in only, §5.6) |
| `RibbonAccount` | Sign in / account menu |

**Terreng and Sammenlign are not in that table, and their absence is the
point.** Both are on the *lokalitet* row now (§8.1): they read a rectangle, and
the only rectangle in the app belongs to a lokalitet. Terreng is still the
fifth ground and digit `5` still selects it — with nothing open, pressing `5`
frames the visible map into a lokalitet and enters Terreng in it, or raises the
sign-in dialog. Sammenlign has no digit and therefore no entrance at all
without a lokalitet open, which is deliberate: `C` switches focus between the
two halves and has never been a way of raising the curtain.

The five grounds are **one ring**, in digit order, driven by
`useGroundMode` (`src/shell/useGroundMode.ts`). Underneath they are three
different mechanisms — a background-layer atom, a modifier flag, and a rectangle
to analyse — and the buttons used to speak all three separately, with Terreng in
a different group that *disappeared whenever a lokalitet was open* because the
lokalitet row carried a second copy of the verb. Two controls for one surface disagreeing
about which rectangle "Lagre" keeps is why there is one now. One list, one
index, one setter; `GROUND_MODES` is the render order and the digit order at
once, and `GROUND_KEYS` in `useBackgroundCyclingKeys` is positional against
**the array**, not against what row 1 draws — which is what lets Terreng's
button live on another row while `5` keeps meaning Terreng.

Terreng belongs in that ring even though it is not a background: it does not
replace the background, it covers it. Leaving therefore costs nothing and
returns you to exactly the dataset and style you left — 1→5→1 is free where
1→2→1 is a screenful of tile requests.

**The settings strip belongs to the ground on screen**, and follows the ring:

| Ground | Strip |
|---|---|
| Kart (1) | **None.** Its one control, the Karttype pulldown over the five cartographies, hangs off the `Kart` button itself as a caret (§5.10); W/S still walks the ring |
| LiDAR (2), Hybrid (3) | Dataset pulldown — **Automatisk** (§5.7), the national mosaic, or one of ~1936 per-project datasets ranked by relevance to the viewport · style pulldown (the active dataset's WMS styles, with a "flere stiler" second tier), only when the dataset publishes more than one · DTM/DOM segment · **Høydekurver** switch, Hybrid only |
| Flyfoto (4) | Acquisition pulldown — the seamless mosaic or any acquisition covering the viewport, newest first · period chips (Alle / 2010– / 1990–2009 / 1960–1989 / –1959), which narrow both that list and the W/S ring (§5.5) |
| Terreng (5) | Visualisering pulldown — the eight relief views, each with its own explanation as a tooltip, also the W/S ring (§10) · DTM/DOM segment · **the sliders the current visualization uses**, two to four of azimuth / altitude / exaggeration / radius / Transparens, inline as label · track · readout (§10) · the resolution readout. No actions: keeping the render is `Behold` on row 2 (§8.9.2) and the rectangle is the lokalitet's, so "Juster området" owns it |

**The strip is on the bar for four grounds out of five, and absent under
Kart.** It was a fixture for a while. The argument for that was real — a line
of chrome appearing and disappearing as you walk the ring changes the whole
bar's height under the pointer and moves every control below row 1 — but it
priced the cost wrong: the height only changes on 1↔2, a deliberate press,
never on W/S *inside* a ground. What the fixture was buying under Standard was
a 40 px row carrying one pulldown and a subject label that repeated the lit
button above it, and 40 px of a bar that floats over the terrain is not free
either. So Standard's pulldown moved onto the `Kart` button (§5.10) and the row
went with it. The other four bring two to six controls each and earn the line.

One exception, and it is the A|B switch: with the compare curtain up the strip
stays even under Kart, carrying the switch and the subject label and nothing
else (§5.8) — "Høyre — Kart", which is the phrase that is wanted. Without it
there would be no way to aim the ribbon at the other half while reading an
ordinary map.

`RibbonSettingsRow` splits the two questions deliberately. `ground.modifiers`
picks the **controls**, because they act on a stack and Hybrid is a modifier on
the LiDAR stack rather than a stack of its own; `ground.mode` picks the
**label**, because telling someone in Hybrid that they are adjusting "LiDAR"
describes the plumbing rather than the map.

`groundModifiers()` in `useGroundMode` is the single mapping, and both the
strip and the W/S ring (§5.3) read it. It is keyed on the *mode*, never on
which background layer is loaded, because those two answers differ for exactly
one ground and it is the one the mapping exists for: Terreng covers the
background rather than replacing it, so `isLidarBackground` /
`isFlyfotoBackground` stay true underneath a terrain render. A bar driven off
those predicates — as it was — offers ortofoto acquisitions from 1937 while the
user is reading a hillshade. The two control hooks own *how* their ring works
and cannot see Terreng from where they sit; whether they are on screen or asked
for a key is decided in `useGroundMode`.

Two constraints on the strip that are load-bearing rather than stylistic:

- **One line, by contract.** Anything a ground needs beyond that goes in a
  popover anchored to a control already on the strip, the way the dataset
  pickers do. A subject whose controls stop fitting is the signal to move
  something into a popover, never to let the strip grow — that is how the
  five-hundred-pixel bar happened the first time. Terreng is the one subject
  that can push past the line, and it does it by **wrapping** rather than by
  adding a row: its two to four sliders are on the strip, because they have to
  stay visible while they are being dragged — what you are watching is the
  terrain under them (§10) — and a popover would cover it. That is within the
  rule, which forbids a body rather than a second line of the same thin row,
  and it is cheaper than what it replaced: the sliders had a dedicated row
  until they were flattened onto one line each, so what now costs a wrap on a
  narrow window used to cost a row on every window.
- **Not registered with `anyOverlayOpenAtom`.** The strip is chrome, not an
  overlay. Counting it as one would disable 1–5 and W/S/A/D (§5.3) exactly
  while someone is using the controls those keys are the shortcut for.

Changing the ground *beneath* a terrain render therefore means leaving Terreng
first. That is the accepted cost: the Transparens slider fades the render
towards whichever ground you entered from, which is the comparison it is for.

The dataset and style pulldowns are still the most complicated things here:
each row needs a two-line label, a relevance badge, an on-hover map preview of
the project footprint, and a tiering split ("mindre relevante" / "flere stiler"
collapsed behind a second disclosure), plus a spinner while the viewport query
is in flight. They are `src/shell/lidar/*` and `src/shell/flyfoto/*` over the
shared `Pulldown` and `ModeButton`; the state and the ring logic live in
`useLidarControls` / `useFlyfotoControls`, the rendering in the pickers.

The **"Flyfoto ↗" external link is gone**: it navigated out of the app to do
worse than what the Flyfoto mode now does in place.

### 5.2 Modes vs modifiers

A distinction the UI encodes and a redesign should preserve, because it keeps
the control count down: **Standard / LiDAR / Flyfoto are modes; Hybrid,
DTM/DOM, the style pick and the Standard cartography are modifiers.** Hybrid
is not a background of its own — it is `hybridOverlayAtom`, a flag on top of
the LiDAR stack, so the dataset picker, style picker and keyboard cycling all
keep working underneath it, and activating it from Standard turns the national
mosaic on rather than becoming a fourth mode. Same for DTM/DOM. Modelling
either as a mode would multiply the mode buttons and break cycling.

The five Standard cartographies are the same call, made again in 2026-09: they
answer one question (*an ordinary map, to know where I am*) drawn five ways, so
they are a pulldown and a W/S ring, not five more buttons — exactly like LiDAR
datasets and ortofoto acquisitions. Amtskart is the interesting one to have
resisted promoting, since it is the only pick that changes *what century* the
map is from; it stays a variant because you read it the same way you read the
topographic map, and because the comparison it is for — the 1890s survey
against a hillshade of the same hillside — is what the curtain is already for
(§5.8).

Terreng's eight visualizations are the same call a third time, made in
2026-09-11 when there stopped being five of them. One question — *what does the
shape of this ground look like* — answered eight ways. The wrinkle worth noting
is that the argument had to survive "a client-side render has no dataset":
Terreng's ring walks its own arithmetic rather than a list of published
products, and it turns out the ring was never about datasets, only about there
being one question with many answers (§10).

**Hybrid is nonetheless a button in the ground ring, and that is the one
deliberate exception.** It is a modifier by mechanism and one of the five things
you flip between by intent, and splitting the ring to say so would cost more
than it explains. The distinction is unharmed where it does work: DTM/DOM and
the style pick stay on the settings strip, and picking Hybrid still activates
the LiDAR stack underneath rather than replacing it.

Switching to Flyfoto deliberately leaves `hybridOverlayAtom` alone rather than
clearing it: it is a LiDAR modifier, inert in flyfoto mode, and switching back
should return you to the stack you left.

**Høydekurver is a modifier on a modifier**, and the only control on the strip
keyed on `ground.mode` rather than `ground.modifiers`. The contour groups ride
inside the hybrid overlay's own GetMap, so in plain LiDAR there is no request
for them to join and the switch would move without changing the map; it is
rendered in Hybrid only. Its state (`hybridContoursAtom`, `?contours=true`)
survives a trip through plain LiDAR untouched, for the same reason hybrid
survives a trip through Flyfoto. What contours add over the hillshade is a
number: relief shading says the ground is steep, a contour says it drops forty
metres, and only the second can be written down in a report.

### 5.3 The map keyboard: grounds, and cycling within one

One `document` keydown listener, with `[]` deps and a mutable ref per handler —
the lists they close over are rebuilt on every render, so the alternative is
re-attaching the listener continuously.

**Across grounds:**

- **1–5** — select the ground outright, in `GROUND_MODES` order. Four of the
  five buttons are on row 1 and in that order; the fifth, Terreng, renders on
  the lokalitet row (§8.1), so with a lokalitet open the digits and the buttons
  still line up and with none open `5` is the only entrance Terreng has. It is
  not a refusal: **pressing `5` with nothing open places the lokalitet** —
  signed in, a rectangle is proposed exactly as "Ny lokalitet" proposes one
  (§5.6) and Terreng is entered in the record `Opprett` makes, in edit; signed
  out, the sign-in dialog comes up. `Avbryt` there leaves nothing behind, and
  in particular does not arm Terreng for whichever lokalitet is opened next.
  Reading relief is the one thing here no WMS can do for us, so the
  answer to "there is no rectangle" is a rectangle, not a shrug — and the bill
  is stated rather than hidden: computing relief now needs an account, because
  it now needs somewhere to put the result.
- **Hold X** — peek at the ground you were on before, snapping back on release.
  Reading relief against a photograph means flipping dozens of times, and a
  hold-to-compare is the cheapest form of that.
- **H** — hide/show the funn, the same switch as the `Funn` label on the
  lokalitet row (§8.6). The
  one key here written straight against an atom rather than through a
  registered handler: there is a single boolean and no mode owns it, so there
  is nothing for a component to contribute. It is a press rather than a hold
  because judging a bump against a 1937 photograph takes longer than a key can
  comfortably be held down.
- **I** — arm/disarm Stedsinfo, the click-the-map-for-a-readout tool (§7.1).
  Written straight against `infoToolAtom` for the same reason H is.
- **C** — flip which half of the compare curtain everything else describes
  (§5.8); a no-op when the curtain is down. Written against `compareFocusAtom`
  directly, for the same reason H is. It is what keeps the curtain usable from
  the keyboard at all: with it, "the 1937 flight on the right against 2024 on
  the left" is `C W W C`.

**While a rectangle is being placed** (§5.6) a fourth keyboard layer is up, from
`useLocalityPlacement`: **Escape** is Avbryt and **Enter** is Opprett. Same
terms as every other layer here — capture phase, inert while something is being
typed into or an overlay is open — and mounted with the placement row, so it is
gone the moment the session ends. The ground keys keep working underneath it:
framing a rectangle against LiDAR relief and then against a 1937 photograph is
exactly what placing it is for.

`PEEK_KEY` is **not** the backtick, which was the obvious pick: on the
Norwegian layout it is a dead key and arrives as `key: "Dead"`, unusable for
hold-and-release. Three more things the peek needs and would be broken without:
`event.repeat` is already discarded (the autorepeat of a held key must not
re-enter `peekStart`), the keyup listener is *not* guarded the way the keydown
is (whatever took focus in between, the peek has to end or the map is stranded
on a mode nobody chose — `peekEnd` is a no-op when no peek is running, which is
what makes that safe), and `window.blur` ends it too, since alt-tabbing with the
key down lands the keyup somewhere else. `useGroundMode` keeps "the previous
mode" in refs rather than state, and a peek deliberately does not become the
thing to peek back to.

**Within one ground:**

- **A / D** — previous / next LiDAR style, top tier only, wrapping at both ends.
- **W / S** — previous / next dataset in **the active mode's ring**: the five
  cartographies in Standard (§5.10), LiDAR projects in LiDAR mode, ortofoto
  acquisitions in flyfoto mode (as narrowed by the period chips, §5.5), the
  eight visualizations in Terreng (§10). In LiDAR mode
  a press also pins the dataset (§5.7) — walking the ring is the user choosing,
  and otherwise the auto resolver would take the background back on the next
  pan and W/S would feel broken.
- **E** — toggle DTM / DOM. In Terreng too: it has the same pair on its strip,
  and it is the same question about the same laser data.

Terreng was the exception here until 2026-09-11 — "a client-side render has no
dataset ring", which was true of five visualizations on a segmented control and
false the moment there were eight and they became a pulldown. What it walks is
not a dataset in the sense the other three mean: one elevation grid, eight ways
of drawing it. A/D have no analogue there and stay unhandled.

W/S generalising across modes is the point of the flyfoto work: walking
2024 → 1963 → 1937 over the same ground with one key is what makes a temporal
stack readable at all. With the curtain up they walk the *focused* half's ring,
which is what makes the same trick work across the seam — and they needed no
change to do it, because the atoms behind the rings are the ones that route
(§5.8).

None of them open the corresponding pulldown. That is deliberate: cycling exists
so you can walk through relief styles while *watching the terrain*, and an open
pulldown (or a drawn footprint polygon) covers the thing you are looking at.

Hence two separate flags rather than one. `lidarPickerOpenAtom` decides whether
project **footprints are drawn**; `lidarCyclingAtom` decides whether the
viewport project list is **kept fetched**. Cycling arms the second without the
first. (`lidarAutoDatasetAtom` is now a third thing wanting the list fetched —
§5.7 — which is why the first W/S press usually finds it already warm.) `lidarCyclingAtom` expires `CYCLING_IDLE_MS = 90_000` after the last
keypress, or immediately on leaving LiDAR mode. The project ring *is* that
fetched list, so the first W/S press after an idle period only kicks off the WFS
query — the dataset chip shows a spinner — and the next press actually walks the
ring.

In DOM mode, A/D is a deliberate no-op rather than a one-entry ring: DOM
publishes exactly one style, and `activeLidarStyleAtom` keeps holding the user's
DTM pick so it returns when they switch back. Walking a single-entry ring would
overwrite it.

The listener itself is **not** in the ribbon. It lives in
`src/map/useBackgroundCyclingKeys.ts` and is mounted at the shell root by
`useMapSideEffects`, because it registers with `[]` deps: a host that unmounts
(a collapsing ribbon row) would re-register and flip its position in the
capture chain relative to the other keyboard layers. Row 1 publishes only the
behaviour, via `useRegisterBackgroundCycle` and `useRegisterGroundKeys`, and
what it publishes for cycling is `ground.cycle` — `useGroundMode` dispatches to
the ring named by `groundModifiers(mode)` (§5.1), a switch with a case per
modifier family and no `default`, so adding a fifth would fail the build rather
than silently swallow the keys. The rings are *routed*, not chained past each
other: neither hook
tests the mode any more, because neither can see Terreng, and W/S falling
through to a LiDAR background under a terrain render spends a screenful of tile
requests per keypress on ground nobody is looking at. There is exactly one
registered handler of each kind; two registrations would silently mean the last
one mounted wins.

The extract viewer's guard sits at that same dispatch rather than in each hook,
for the same reason one level up: it covers the whole map, so no ground has
anything to show. It does not stop 1–5, which stay a way of setting up what you
will see on the way out.

It follows the §1 discipline: capture phase, handled keys stopped with
`preventDefault` + `stopPropagation` + `stopImmediatePropagation`, and the same
input / `[data-scope]` guard as `useWorkspaceKeys`. Both listeners additionally
consult `anyOverlayOpenAtom` (`src/ui/overlayAtoms.ts`) — a focus-independent
second check, because the `[data-scope]` walk starts at `event.target` and only
reaches the attribute if the overlay actually took focus.

### 5.4 Internationalisation

The TopBar put exactly four strings through `t()` and hardcoded the rest. The
ribbon puts **all** of them through it, under a `ribbon.*` namespace
(`mode`, `lidar`, `flyfoto`, `heritage`, `layers`, `search`, `terrain`) in all
three locales, with the lokalitet surfaces under `localities.*`.

The remaining hole is `src/search/**`. It calls `t()` — the section headings,
the pagination row, the coordinate-swap warning all go through it — but it
leaks Norwegian bokmål around the edges regardless: the `"${placeType} i
${municipality}"` joiner in `PlacesResults`, `'Ja'`/`'Nei'` in
`FeatureInfoSection`, the thrown `'Ingen matrikkelreferanse funnet'` in
`PropertyInfo`. The three locale files also still largely describe upstream
Norgeskart features.

The decision is still open and should be taken deliberately: either commit to
three locales and finish `src/search/**`, or drop to Norwegian-only and delete
i18next. A full i18n stack that one surface half-bypasses is the worst of both.

**One word for fading a layer: Transparens** (`Transparency` in `en`). There
were four sliders doing the identical thing under three different Norwegian
names — *Toning* on a bilde laid into the rectangle, *Dekkraft* on a terrain
render, *Dekkevne* on the heritage overlay and again on a drawing colour — so a
user who learned one control learned nothing about the next. The keys are
`*.transparency` throughout.

**They count transparency, so 0 % is opaque.** The word names the gap, not the
cover, and a slider that reads `Transparens 100 %` under an image you can see
perfectly is a control arguing with its own label. What is *stored* is still
opacity everywhere — the atoms, `groundOverlay.ts`'s `opacityByKey`, the
`#rrggbbaa` alpha,
`?heritageOpacity`, `layer.setOpacity` — because that is what OpenLayers and
CSS take; every surface flips at the point it prints the number, and so does
`describeHeritageRender`, since a caption that disagrees with the control it
records is worse than no caption.

### 5.5 Flyfoto as a background mode

Two layer names, `flyfoto` (the seamless best-available mosaic) and
`flyfotoProject` (one acquisition, served off NiB's ImageServer rather than a
WMS). Neither has a static config entry and `flyfotoProject` stays out of
`VALID_STARTUP_LAYERS`, since its acquisition starts null; the plumbing,
including why `esriMosaicNone` is load-bearing, is `docs/map-layers.md`.

The acquisition list comes from `fetchFlyfotoProjectsForBbox` refetched on
moveend while the mode is active. **No licensing notice for viewing** —
browsing NiB imagery as a background is what the old external link already
did; the notice gates *grab-and-keep* (§8.8), which is a different act.

**The period chips** (`src/shell/flyfoto/eras.ts`, `FlyfotoEraPicker`) are the
mode's one filter, and they sit on the strip beside the acquisition chip rather
than inside its pulldown. The complete list is the problem the filter exists
for: an Oslo-sized bbox intersects on the order of a hundred acquisitions, and
the two flights that answer "what was here before the road" are buried under
twenty years of near-identical modern omløp. Ranking cannot help the way it
does for LiDAR — the index returns no geometry, so there is no coverage ratio,
and every row is equally relevant to the screen. What differs is *when*.

- **Four periods, not ten decades**, and they are breaks in the archive rather
  than round numbers: `2010–` the digital omløp at 0.1–0.25 m, `1990–2009`
  colour, `1960–1989` the systematic national coverage, `–1959` the early
  flights. Labels are the ranges themselves, so only "Alle" is translated.
- **W/S walks the filtered list.** A filter the keyboard ignored would be worse
  than none: the point of picking `–1959` is that S then steps between the two
  pre-war flights instead of through eighteen modern ones to reach them. The
  count badge on the acquisition chip counts the same filtered list, so the
  chip and the key never disagree about how much there is.
- **An empty period is disabled, never hidden** — the row must not reflow under
  the pointer while panning, and "there are no pre-war flights here" should be
  answerable without clicking. The *selected* period is exempt, or a pan could
  strand the user on a filter with no neighbour to click back to; the pulldown
  then says which of the two nothings it is, since one of them is one click
  from being undone.
- Undated rows appear only under "Alle". A period is a claim about when, and a
  row that cannot support the claim should not answer it.

### 5.6 Ny lokalitet — place the rectangle, then create

Pressing it writes nothing. A rectangle appears on the map, seeded from what
you can see, and a one-line row appears under row 1; you move and size the
rectangle against the terrain you are framing, and `Opprett` is what creates
the record.

```
├ NY LOKALITET · 620 × 480 m · 29,8 ha   Flytt og endre …   [Opprett] [Avbryt] │
```

It used to create on the press, straight off the viewport. The rectangle that
produced was always wrong by a little — and by the time you could see that, it
had already cost a stedsnavn lookup, a WFS query and a three-image starter set
over the wrong ground, with the reshape ("Juster området") still to do. Placing
first makes the first rectangle the authored one and `Avbryt` free: there is
nothing to undo, because nothing was written.

The pieces:

- `localityPlacementAtom` (`src/localities/placement.ts`) holds the pending
  `{ id, bbox, then }`. An atom rather than component state because two
  unrelated places read it — `Ribbon` decides whether the row exists,
  `localityLayer` stops opening neighbouring lokaliteter while it is set — and
  because "who holds the pending rectangle" wants one answer.
  `useStartLocalityPlacement` is what both entrances call: it raises the
  sign-in dialog for a guest, closes
  whatever lokalitet was open (its edit buffer survives in `localStorage`
  exactly as it does for `Lukk`), clears `mapToolAtom` and sets the atom.
- `RibbonPlaceLocalityRow` is the surface, in the `RibbonFunnDraftRow` idiom —
  one line, no body. A floating card would be the one surface guaranteed to
  cover the ground being framed.
- `useLocalityPlacement` is the session, mounted once by that row. The
  authoritative rectangle is the atom's, written on each finished gesture; the
  one the row prints is the live one, so the readout follows the hand mid-drag
  while nothing downstream ever sees an unclamped extent. `Escape` = Avbryt,
  `Enter` = Opprett, on a capture-phase listener with `useWorkspaceKeys`'
  guards (§8.4).
- `useBboxHandles` (`src/localities/useBboxHandles.ts`) is the gesture itself —
  drag the interior to move it, a corner to take two sides with you, an edge to
  take one. Lifted out of `useLocalityAdjust`, which is now a thin wrapper over
  it, so placing and "Juster området" are one gesture with two entrances.

  One `Pointer` interaction of our own, not OL's `Translate` + `Modify` pair it
  started as. `Modify` moves the single vertex under the hand, so a corner drag
  was a trapezoid until release and the rectangle was rebuilt in `modifyend`
  from the dragged corner plus the opposite one — and its fixed set of vertex
  handles is why there was nothing to grab along an edge. Here a grab names
  *which sides move* (two for a corner, one for an edge, all four for a move),
  and every frame rebuilds the extent from the pointer plus the sides that did
  not move, through `clampBboxSize`. So the corners stay square throughout, the
  drag *stops* at the size band rather than overshooting it and being pulled
  back, and the body and the handles cannot disagree about what the hand is on
  the way two interactions separated by a `CORNER_GRAB_PX` condition could. The
  eight handles are drawn (`rectangleStyle`) and the cursor names the axis —
  otherwise nothing on screen says an edge can be taken hold of.

**The seed.** `viewportBbox` insets the visible map, then
`clampBboxSize(seed, 'centre')` brings it into the band. Each of the four edges
takes **whichever is larger, the chrome in front of it (`chromeInsets(map)` plus
`CHROME_MARGIN_PX`, §3.1) or a proportional inset** (8 % of the dimension, at
least 48 px). With nothing floating over the map that is exactly the old
symmetric rectangle; with the ribbon up and a strip along the bottom, the top
and bottom edges move in to clear them. The proportional floor is not just
cosmetic — at ≥8 % it also guarantees `transformExtent`'s corner-only
reprojection cannot clip something the user could see inside the box.

- **Inset pixel corners through `map.getCoordinateFromPixel`**, not
  `calculateExtent` with a ratio. `calculateExtent` is symmetric about the view
  centre and the chrome is not — a ribbon on top, a strip along the bottom, a
  card down the left — so no symmetric ratio clears it without over-insetting
  the opposite edges. Pixels are relative to the map viewport element, which
  every surface floats over, so the measured chrome insets map 1:1 onto the
  pixel insets. Rotation is locked off, so two corners describe the rectangle.
- **A floor on the result.** Chrome plus insets can leave nothing worth framing
  (a short window with a carousel up); under `MIN_SIDE_PX` `viewportBbox`
  answers `null` and the press toasts instead of entering placement.
- **No zoom guard any more.** The old one refused the press when the viewport
  spanned more than 25 km; there is nothing to refuse now that the seed is
  clamped, so zoomed out to the whole country you get the largest allowed
  rectangle on the middle of the screen. `MAX_SPAN_M` and
  `localities.createTooLarge` are gone.

**The size band** — `src/localities/bboxLimits.ts`, `MIN_SIDE_M = 50`,
`MAX_SIDE_M = 1500`. Both numbers are read off what the producers can render,
not off what the map will let you frame:

| side | extract px @ 0.25 m | canvas | WMS tiles | stored m/px |
|---|---|---|---|---|
| 50 m | 200² | 0.2 MB | 1 | 0.25 |
| 1500 m | 6000² | 144 MB | 9 (27 for a starter set) | 0.25 |
| 3000 m | 12000² | 576 MB | 36 (108) | 0.5 |

1500 m is the largest rectangle whose **finest LiDAR extract still fits the
store at its own resolution**: `renderFigureBlob` caps a figure at
`MAX_STORED_PIXELS` = 40 Mpx (§8.10) and √40 Mpx × 0.25 m is 1581 m. Past it
every kept extract is quietly coarser than the source it names. 50 m is where a
figure's caption panel stops being shorter than the image it captions; below
that the thing being framed is one object, and one object is a *funn*.

Three things about the band that are easy to get wrong:

- **It is measured in EPSG:25833, not in the view projection.** The view is
  URL-selectable and can be `EPSG:3857`, where `getMetersPerUnit()` answers 1
  while a metre at 60° N is really half of one — the old `MAX_SPAN_M` check was
  out by 2× there. 25833 is also the projection every producer renders in, so a
  rectangle bounded there is the raster that actually gets built, bounded.
- **The ceiling ratchets down, it never snaps.** Nothing migrates existing
  records and the old guard allowed 25 km, so a resize is clamped to whichever
  is larger, the band or the rectangle as it stood when the gesture started.
  You may always shrink, never grow past the band, and a rectangle already past
  it can only come down. Without that, nudging one corner of an old 5 km
  lokalitet would destroy it.
- **It is a clamp everywhere except one place.** A drag stops at the limit (and
  the row says which limit, so the number is taught rather than merely
  enforced); `growToFitDrawing` — "Utvid området", which unions the rectangle
  with a funn drawn outside it — *refuses* with a toast instead, because a
  clamped union would put the drawing back outside the rectangle it was grown
  to hold. `copyLocality` is exempt: a fork carries its original's rectangle
  whatever size that is.

**The commit.** `createLocalityFromBbox` is unchanged — the stedsnavn lookup
still runs before the write (§8.3), it just runs on a rectangle somebody chose.
On success the record is set active, `editingLocalityIdAtom` and
`pendingStarterLocalityIdAtom` are set in the same batch, `ribbonToolAtom` is
armed if the placement was started by Terreng (§10), and the placement atom is
cleared last. On failure the session stays up rather than throwing the placing
away.

Those two atoms in one batch are the whole hand-off: **`Opprett` lands you in
edit with the starter set already running.** The record was made by an act of
authorship, so the stance that follows it is edit (§8.1), and the three images
are fetched without being asked and written straight through, so the rail fills
with pixels rather than with frames waiting for a `Lagre` (§8.9.1). That is why
the placement row's verbs are `Opprett` / `Avbryt` and edit's are `Lagre` /
`Avbryt` / `Avslutt`: creating and editing are two different acts, and the only
one with a point of no return is the first. The workspace still opens only after `createLocality` resolves: "Juster
området" builds its extent from the bbox in the closure when `adjusting` flipped
true, so an optimistic placeholder record would have it edit a stale rectangle.

A placement and an open lokalitet are **mutually exclusive by construction** —
starting one closes the other, committing one opens the record it made — so the
bar never carries two sets of exits.

The bbox stays **authored, not derived**: the viewport only seeds it.

### 5.7 Automatisk — the LiDAR dataset following the viewport

The national mosaic and a per-project dataset are good at different scales: the
mosaic is a seamless **1 m** grid over the whole country, a project is **0.25 m**
over one municipality. Zoomed out, a project buys nothing but a coverage hole;
zoomed in, it is four times the ground resolution, which for reading earthworks
is the difference between seeing a ditch and not. Neither is "the right
dataset" — the right one depends on how close you are standing, which is a
question the app can answer for itself.

So the dataset pulldown's first row is **Automatisk**, and it is the default.
`lidarAutoDatasetAtom` is a *pin* flag, not a fourth dataset: while it is set,
the resolver in `useLidarControls` writes through the same
`selectNational` / `selectProject` the pulldown uses, so style clamping, the
background stack and the keyboard ring behave identically whether a dataset was
chosen or resolved. **Any explicit pick clears it** — a pulldown row or a W/S
press — and the *Automatisk* row sets it again.

Pressing the **LiDAR** or **Hybrid** mode button is not a pick: entering the
mode has to put *something* on screen, but it says nothing about which dataset,
so `enterLidar` leaves the flag alone and resolves once up front. Resolving up
front rather than landing on the mosaic and letting the resolver correct it a
beat later is worth the extra branch — two swaps in a row is two screenfuls of
WMS requests for one keypress. When the answer isn't known yet (the coverage
list is only fetched inside LiDAR mode, so on entry it never is) it starts on
the mosaic, which always covers, and the resolver refines when the list lands.

The rules are `src/map/layers/config/backgroundLayers/lidarAuto.ts`, as one
pure `chooseAutoDataset`. Two hystereses, because a background swap here is a
cross-fade plus a fresh screenful of WMS requests, not a cheap redraw:

- **Scale.** Engage per-project at ≤ 1 m/px, release above 2 m/px, hold in
  between. Metres per pixel rather than a zoom level because the view is
  EPSG:25833 — and because the threshold is a fact about the *source grids*:
  at 1 m/px the national mosaic is at its Nyquist limit and a 0.25 m project
  has nothing more to show. Zoom steps are factor-2, so the release band is
  the smallest hysteresis that exists.
- **Coverage.** Engage when the top candidate paints over half the screen,
  release the incumbent below 35%. Far above the picker's own `minAreaRatio`
  (0.1): worth *listing* is a much lower bar than worth switching to unasked.

The candidate is always `viewport.primary[0]` — the top row the pulldown would
have shown. Nothing cleverer, deliberately: a picker whose first row is not
what "automatisk" chose is a picker nobody can predict. That also means the
LiDAR filter panel (`minYear`, density grandfathering) tunes auto too.

**Showing it.** The chip keeps naming the dataset actually on screen — that is
the fact you need while reading terrain — and carries a `bolt` glyph when the
name got there by itself. Inside the pulldown, *Automatisk* is the **active**
row and its meta line names what it has settled on; the row it settled on gets
the same `bolt` as a `PulldownItem` `mark` rather than a second accent bar. Two
accented rows would leave it ambiguous which one a click undoes.

**Cost.** Auto needs the coverage list for as long as LiDAR mode lasts, where
the pulldown and the W/S ring only needed it during an interaction — so
`wantsViewport` in `lidarFootprintsLayer` grew a third term, and two things
keep that affordable: `refresh` declines to fetch *on auto's behalf alone*
above `AUTO_ENGAGE_M_PER_PX` (out there the answer is the mosaic and no round
trip is needed to know it), and moveend is debounced 250 ms. The per-project
footprint responses are immutable and memoised for the tab, so panning around
one region settles to no network at all.

Auto is off on the compare curtain's B half and stays off: a term of a
comparison that follows the viewport is not a term. Which also means the A
half's resolver pauses while the ribbon is pointed at B — §5.8 has why that is
accepted rather than fixed.

### 5.8 Sammenlign — the curtain

Flipping grounds with 1–5 answers "what does this look like in LiDAR". It
cannot answer "is that bump in the ortofoto the same bump as in the relief" —
that needs both on screen at once and in register. **Sammenlign** keeps the
ordinary background stack across the whole map (the *A* half) and clips a
second stack to the right of a draggable edge (the *B* half).

It is **not** one of the five ground buttons and has no digit key: it does not
answer "what does the ground look like" but "against what". It reads the ring's
current and previous mode to choose a sensible other half — entering lands on
the ground you were last on, which is almost always the one you just flipped
away from, i.e. the comparison you were already making by hand.

**Its button is on the lokalitet row** (§8.1), beside Terreng, and it used to
sit in its own group beside the ring on row 1. It is a read tool, so it renders
in both stances and for a reader in full; what it needs from the ring reaches
it across the sibling gap on `groundHandleAtom`. Two consequences follow, and
both are accepted rather than worked around:

- **The curtain cannot be raised with no lokalitet open.** `C` is only the
  focus switch and has never raised it. Comparing two grounds is something you
  do *to a place*, and the place is the lokalitet.
- **Closing the lokalitet tears the curtain down** — `useLocalityWorkspace`'s
  close/swap cleanup calls `leaveCompareAtom`. Not tidiness: the only control
  that can lower the curtain leaves with the row, so without this a visitor
  could strand a second live tile stack on screen with no way to close it,
  which is Kartverket's request budget doubled, silently and indefinitely
  (`docs/wms-proxy-and-tiles.md`).

**One control surface, pointed at one half at a time.** The button is the whole
of Sammenlign's own UI. Everything that describes a ground — the five mode
buttons, the dataset and style pulldowns on the settings strip, DTM/DOM,
hybrid and its contours, and the W/S/A/D/E rings — acts on whichever half the
**A|B switch** names, and
that switch is the first control on the settings strip whenever the curtain is
up. `C` flips it from the keyboard.

That is a deliberate replacement for the first version, where B had a ground and
nothing else: one pulldown here naming standard/LiDAR/hybrid/flyfoto, and both
halves reading the same dataset atoms. It could not express "the 1937 flight
against the 2024 flight", which is the comparison the mode exists for. The
alternative fix — a second set of pickers for the B half — is two of every
control on a bar whose governing rule is *bodies, not rows*, plus two pickers
free to disagree about what they are naming.

Underneath, every piece of ground state is **two primitives and a facade**
(`src/map/compare/halves.ts`). `halved(initial)` returns `{ a, b, focused }`;
the modules that own the state keep exporting the facade under the name the app
already imports, so `useLidarControls`, `useFlyfotoControls`, the pickers, the
style clamping and the cycling rings did not change at all — point the focus at
B and the same controls describe B. What has to know about halves is exactly
four things: `backgroundLayerAtomEffect` (pinned to `.a`),
`compareLayerAtomEffect` (pinned to `.b`), the screenshot caption (which reports
the whole map, so both), and the switch itself.

Consequences worth stating:

- **B is seeded from A on the way in**, through a registry every `halved()` call
  writes itself into — so a pair added later cannot be forgotten and open the
  curtain on a `null` acquisition. The only difference between the halves is
  then whatever the user changes, and focus lands on B because that is the half
  they have just brought into existence.
- **Automatisk is cleared on B.** A half that follows the viewport is not a
  fixed term of comparison. Its A-side counterpart keeps working, but *pauses*
  while focus is on B — the resolver in `useLidarControls` reads the facade, so
  it sees B's `false`. It self-corrects the moment focus returns, because every
  input to that effect changes value; this is an accepted artefact rather than
  something to engineer around, and pinning the resolver to `.a` would be worse
  (it would fight the pulldown the user is holding).
- **The A|B switch rides on the strip**, ahead of the subject label, because
  it governs what that label even names: "Høyre — Flyfoto" is one phrase read
  left to right. The strip is a permanent fixture now (§5.1), so there is no
  longer a focused half that can take the way back to A off the bar with it.
- **`previous()` records focus flips too**, so hold-X while comparing peeks the
  focused half back to whatever the ring last showed — including the other
  half's ground. Harmless, and not worth a second history.

**One resolver, two stacks.** `resolveStack(layerName, opts)` in
`backgroundLayers/stack.ts` is the whole "what does this mode put on the map"
rule — topo base where a service is transparent outside coverage, the faded
national mosaic under a per-project dataset, the hybrid overlay on top —
returning *configs*, synchronously. `buildStack` is the half that awaits. The
background effect and the compare effect are both callers, so the B half gets
the topo base and the faded fallback it needs without a second copy of the
rule. Splitting resolve from build is also what lets each caller decide what a
stale run may do before anything on the map is touched.

**`bg.` and `cmp.`.** `LayerNamespace` prefixes both the layer id and the reuse
signature. The id keeps `swapBackgroundLayers`' outgoing sweep off the B half
(`isBackgroundLayer` is a strict `startsWith('bg.')`), and the signature stops
`buildOrReuseBackgroundLayer` handing A and B the same layer instance — the two
stacks routinely resolve to the same topo base, and one instance cannot be in
the map twice with two different clips.

**The clip is on the canvas, the seam is in the DOM.** Each B layer gets
`prerender`/`postrender` handlers that `save()` / `clip()` / `restore()` around
a rectangle from the split fraction to the right edge, translated through
`getRenderPixel` — the context is in device pixels and carries whatever
transform OL is mid-frame with, so raw canvas coordinates drift during an
animated zoom. `CompareCurtain` draws only the visible line and the grip, which
line up because the shell and the map viewport are the same rectangle. The
fraction lives in an atom for React and in a module-level variable for the
render handlers, because OL calls those, not us — the same split as the terrain
overlay's.

**Entered and left, not persistent.** Two live stacks are roughly twice the
GetMap requests and Kartverket rate-limits per source IP across every visitor
of a deployment, so leaving tears the B stack down and nothing writes the mode
to the URL: a shared link should not silently double someone's request budget.

**The B half swaps gaplessly too.** `installCompareLayers` uses the same
pattern as `swapBackgroundLayers` — outgoing `cmp.` layers are dimmed to
`OUTGOING_OPACITY` immediately and removed on the next `rendercomplete`, with a
timeout backstop, and an in-flight retirement is cancelled if another change
arrives first. Both constants are exported from `backgroundLayers/utils.ts` so
there is one answer for both stacks. The under/over split matters here for a
reason particular to the curtain: pushing the whole incoming stack on top would
put B's *topo base* over the outgoing dataset, and the right half would flash
plain topo mid-swap. Under-layers go beneath the outgoing ones, over-layers on
top, exactly as in the background effect.

**One deliberate limit: Terreng is not offered as a B half.** It is a
client-side render over the whole map rather than a background, so it has no
clippable stack. The button stays in the ring while focus is on B — disabled,
not hidden, so the five positions and the digits keep meaning what they mean —
and a render already up on the A side stays up: relief on the left against a
photograph on the right is one of the better things this mode does, and the
`cmp.` layers sit above the terrain overlay's `zIndex` so the curtain reads
correctly over it.

### 5.9 Kulturminner — one control with a seam in it

**Kulturminner** (`castle`) in row 1, with an eye welded to its right edge
(`src/shell/heritage/HeritageControl.tsx`, split by `EyeSplit`, whose one
caller it now is — §8.6 for where the other went). The labelled half opens the settings `Popover` and
carries a `CountBadge` of how many sources are on; the eye puts the overlay on
the map or takes it off.

**It used to be two buttons** — a `castle` that toggled `heritageSites` and an
**Oppsett** (`tune`) beside it holding the panel — and the split was in the
wrong place. The first could only ever say *one* of the five sources while the
count of how many were on lived on the second, so with three services ticked
the button labelled `Kulturminner` was a switch for one of them: press it and
two stayed behind, on a map whose only remaining explanation was a number on
the neighbouring control. Now the noun names the whole overlay, the badge is on
the noun, and on/off is the eye.

**The eye has three states and one press.** Shown → hide; hidden → show; and
with *no source ticked at all* it arms the overlay instead of raising an empty
blind, turning on `heritageSites`. That third case is what keeps the merge from
costing anything: the route to the heritage record for someone who has never
opened the panel has to be one press on a control named after it, and without
it that person would have to know which of five Riksantikvaren services to
tick. Its label is the verb and changes with the state, which is also its
accessible name.

**Hiding is a blind, not a switch** — `heritageHiddenAtom`
(`src/map/layers/heritage.ts`), read by `themeLayerEffect`, which calls
`setVisible(false)` on the theme layers rather than removing them. Emptying
`activeThemeLayersAtom` instead would take the five checkboxes, the badge and
the `themeLayers` URL parameter with it, and bringing them back would be a
guess about what had been on. Three consequences worth stating: the URL keeps
describing the selection while the map shows none of it; the tile cache
survives, so unhiding is instant; and because `isRendering` in
`featureInfoService` is `Layer#isVisible`, a click cannot ask RA about a
register the reader cannot see. An info panel *already open* about a heritage
feature stays — you may well have hidden the drawing in order to read it — but
nothing new arrives while the eye is down.

**Ticking a source in the panel raises the blind.** Otherwise a checkbox
answers with nothing on the map and no visible reason why.

`shownThemeLayersAtom` (`src/map/layers/atoms.ts`) is the derived "what is
actually drawn", and everything that *describes* what a reader can see reads
that rather than the selection — today that is the figure caption on a
screenshot (§8.10), which must not name a layer that put no pixels in the
image. Not URL-persisted, on the same grounds as the funn eye: a link shared to
show someone a heritage feature must not arrive with the register hidden.

The panel has four parts, top to bottom: the five RA services as
`PulldownCheck` rows; kulturminner2's three registers (lokaliteter,
enkeltminner, sikringssoner) indented under it; how they are drawn; and a
Transparens slider for the whole overlay.

**A popover, not a row on the settings strip.** The strip belongs to the ground
on screen and follows the ground ring (§5.1). The heritage overlay is not a
ground — it is the thing you read the ground *against*, and it stays on while
you cycle LiDAR datasets underneath it. Giving it the strip would mean the
strip's subject changed on its own, so the controls under your cursor would be
for something else by the time you reached them. It would also need a
`rowSubjectAtom` and a three-state button to say which subject the strip is
showing, for a surface that is opened rarely and read once.

**The three sublayers are indented, and only appear while their source is on.**
They belong to kulturminner2; offering them next to a switched-off source
invites the reasonable guess that ticking one turns the source on.

**Rendering is one axis, not two.** Outlines / filled and the five vern subsets
sit in one list under two headings. That is not a UI simplification — it is the
WMS: `STYLES` takes a single value per `LAYERS` entry and RA publishes no
filled variant of any subset, so "filled *and* only the automatically protected
ones" is not a request that exists. Two controls would promise it. The tables
behind this, and the sublayer/style pairs each render expands to, are in
`src/map/layers/heritage.ts`, read off live GetCapabilities and confirmed with
GetMap probes rather than inferred.

**Outlines is the default**, where the service's own default fills enkeltminner
in cyan. The register is here to be read against the relief, and a filled
polygon is an opaque lid over the one thing the app exists to show. For the
same reason the Transparens slider tops out at 80 % rather than 100: a fully
invisible overlay that still counts as "on" is a state nobody can debug from
looking at the screen. The atom is still opacity and `MIN_HERITAGE_OPACITY` is
still 0.2 — the floor is a ceiling only in what the control prints.

**Reshaping happens in `themeLayerEffect`, not at construction.** The effect
reads the three atoms, so any change re-runs it; the add/remove diff is a no-op
on those runs and a reshape pass afterwards calls `source.updateParams` — but
only when `LAYERS`/`STYLES` actually moved, since `updateParams` invalidates
the tile cache and re-requests the whole screen. Selecting nothing hides the
layer rather than sending a request whose only possible answer is a transparent
tile. `createThemeLayerFromConfig` also takes the pair as an override, so a
layer switched on while the settings are already off default is built correct
instead of built wrong and corrected a frame later — at RA's MapServer that
difference is a screenful of GetMaps.

**Saved images carry it.** `describeHeritageRender` (`src/figure/specs.ts`)
puts the render, the omitted sublayers and any transparency on the
screenshot's caption. "Outlines of the automatically protected sites only" and
"every register, filled" are different claims about what the blank ground in
the picture means, and only one of them says nothing was recorded there (§8.10).

### 5.10 Standard — five cartographies of the same ground

**The button reads `Kart`** (`Map` in English); the ground, the mode key, the
atoms and this doc still call it Standard. The label changed because "Standard"
named it by contrast with the other four — the *not*-LiDAR, *not*-photograph
one — which only means anything to someone who already knows the other four
exist. `Kart` says what it is to someone who has just arrived, and the four
buttons then read as four kinds of thing rather than as one default and three
alternatives.

Standard is the one ground with **no settings strip**. Its single control, the
**Karttype** pulldown (`src/shell/standard/StandardVariantPicker.tsx`), is a
caret welded to the `Kart` button's right edge — the same seam as `EyeSplit`,
one object with two hit targets. It walks the ring in `STANDARD_VARIANTS`:

| Variant | What it is |
|---|---|
| Topografisk | The ordinary vector-drawn topographic map. The default, and what Standard used to mean outright |
| Gråtone | The same drawing in grey — the one to put coloured funn, heritage polygons and a terrain render on top of |
| Rasterkart | The printed series' own cartography, scanned: heavier line work, the old typography |
| Sjøkart | The nautical chart — depths, soundings and skerries, i.e. the only variant that says anything below the waterline |
| Amtskart | The county map series, first sheet 1826 and publication stopped around 1917 |

Four of the five are WMTS renderings out of the same tile cache, so switching
between them is a tile fetch and nothing else; the capabilities document is
cached **by URL** rather than by layer name, so the four share one 35 kB fetch
instead of one each. Amtskart is a WMS (`wms.historiskekart`, layer `amt1`) —
the historical maps are not in the tile cache.

**Amtskart is the reason this section exists.** Farm names, mills, ferry
crossings, the road that is now a track and the tract that has since been
cleared, surveyed before the twentieth century rearranged them, in register
with a hillshade of the same hillside. Two things follow for the UI:

- **It is drawn transparent over a topo base.** The series has a hole the size
  of Nordland — publication stopped before that county was ever mapped, which a
  GetMap probe confirms (Bodø and Mosjøen come back empty, Narvik and Tromsø
  are drawn). Bare, that reads as a broken app rather than as a map nobody
  drew, so `amtskart` is in `NEEDS_TOPO_BASE` like the LiDAR layers.
- **It names itself in a saved figure.** `GROUND_LABEL_KEY` maps all five
  variants to their own label rather than to "Standard": a screenshot over an
  1890s survey and one over the current topographic map are different
  documents, and the caption is the only place the file says which (§8.10).

Three things follow from the pulldown hanging off the button rather than off a
strip, and they are the whole of what the move changed:

- **The active cartography is no longer written on the bar.** It is in the
  caret's tooltip (`ribbon.standard.triggerTip`), in the list's active row, and
  — the reason that is enough — on the map: the five look nothing alike, in the
  way two LiDAR acquisitions of the same hillside do.
- **The list opens from any ground**, which the strip could not do; it only
  existed while Standard was already up, so "give me the nautical chart" from
  LiDAR was two presses. Picking a row therefore goes through
  `ground.select('standard')` before it applies the variant (`onPickGround`).
  Setting the background alone would leave a pick made from Hybrid with the
  hybrid overlay still switched on over a topo base, and one made from Terreng
  changing the ground under a render nobody can see through.
- **`useStandardControls` has no `standDown`**, unlike the other three control
  hooks. Theirs exists because an unmounted popover never fires its own
  open-change callback; this one lives on a button that is on row 1 whatever
  ground is up, and closing it when Standard stops being the ground would undo
  the point above.

The pulldown has no count badge, no spinner and no relevance tier, unlike the
LiDAR and ortofoto ones. Nothing is queried — all five are national products,
the same five everywhere, known at build time — and the only ordering decision
is the rule and the hint above the amtskart row, derived from its position in
`STANDARD_VARIANTS` so the list and the W/S ring cannot disagree.

`useStandardControls` keeps two pieces of state where the other grounds keep
one: `backgroundLayerAtom` is what is on the map, `standardVariantAtom` is what
Standard *means*. They agree while Standard is the ground and diverge on
purpose while you are elsewhere, which is what makes pressing 1 come back to
the map you left instead of resetting to topo — the same promise the LiDAR
dataset and the ortofoto acquisition already make.

---

## 6. Map panels and controls

### 6.1 The card slot

`src/map/overlay/MapToolCards.tsx` renders **one** card at a time from
`mapToolAtom`: `'localities'` → `LocalitiesPanel`, `'measure'` → nothing
(measure lives in a ribbon popover; the enum member is vestigial and the switch
falls through to `undefined`). There is one real card left, so the slot is a
`MapToolCard` shell around a single branch.

`MapToolCard` is the shared shell: white card, `max-height: 100%` against the
slot's definite height (§3.1), `pointer-events: auto` against the slot's
`none`, a heading and a close IconButton. Width is the slot's — the old
`maxWidth: 345px` was a second guess at the same number `.left` already
enforces. The `hideHeader` prop went with the port: declared and handled, never
passed.

The card slot no longer arbitrates with the lokalitet workspace: the workspace
is in the ribbon, so search and the cards simply render, and `mapToolAtom` only
has to keep the cards exclusive with each other.

### 6.2 The theme picker, and where it went

There used to be a second card here: `src/settings/map/themes/MapThemes.tsx` +
`SubTheme.tsx`, upstream's generic machinery for browsing categories of theme
layers with expandable subthemes, a per-subtheme "add all", an active-layer
`CountBadge` in a bespoke card header and a performance warning at fifteen
active layers. This fork has **one category with five layers**, all from
Riksantikvaren, so every one of those capabilities was scaffolding around a
list of five checkboxes — and it spent the left card slot, on top of the map,
to hold it.

It is gone (`MapThemes`, `SubTheme`, their CSS and `types.ts`, plus
`useThemeLayers`, `MapLayersCardHeader` and `MapTool = 'layers'`). What
replaced it is §5.9: a popover on row 1 that offers the five sources *and* the
three things the register can actually be asked beyond on/off.

Selecting a theme layer still promotes it to `setZIndex(10)`, above everything
else.

### 6.3 What does not exist

Worth stating, because their absence reads as an oversight and is at least
partly a choice: **no zoom in/out buttons** (mouse wheel, pinch and keyboard
only), **no north arrow / rotation reset** (the map cannot rotate), **no
coordinate readout** on the map itself (the InfoBox shows one for a clicked
point), **no map legend**, **no opacity control for the *background*** (opacity
there is used internally by the stack; the heritage overlay does have one,
§5.9), and **no geolocation button** — `trackPositionAtom` and
`trackPostitionAtomEffect` are fully wired but nothing ever sets the atom
`true`, so the "where am I" feature is dead code
with no entry point. For a field-adjacent tool that is a genuine gap; a rewrite
should either add the control or delete the effect.

---

## 7. Search

`src/search/SearchComponent.tsx` plus `atoms.ts`, `hooks.ts`, `searchApi.ts`,
and the `infobox/` subtree.

It searches place names, addresses and cadastral properties (matrikkel), with a
filter control to narrow the source. The **query field** is `RibbonSearch` in
row 1; the **results** are `SearchComponent` in the left slot below it, over the
map. Splitting them that way keeps the bar a bar — a results list is a list
over the map, not chrome. Selecting a result drops a marker, opens the InfoBox
with the result's details, and flies the map there.

`src/search/results/**` is on `src/ui`: one `SearchResults.module.css` shared by
all seven files rather than one each — they are a single visual surface, and
splitting the row away from the list it sits in would mean reading two files to
change one row. Each result group is a controlled `Section`, with
`SearchResults.tsx` holding the open set (all four open on arrival); a row is a
`<button>` inside its `<li>`, so it is keyboard-reachable even though the list
as a whole still is not. A road's house numbers expand into a sibling `<li>` of
chips, which is why the row separator is `:not(:first-child)` rather than
`.line + .line`. Place names are the only paged result set, so their prev/next
row is inline rather than a kit primitive (§12).

Three things to fix rather than port:

- **Every selection lands at a hardcoded zoom 15** (`src/search/atoms.ts:162`),
  regardless of whether the result is a farm building or a municipality.
- **The result list is tab-reachable but not navigable.** Every row is a real
  `<button>` since the port, so Tab and Enter work; there is still no arrow-key
  navigation, no Escape to dismiss, no focus management and no
  `role="listbox"`/`role="option"`.
- **Partial `t()` coverage** — Norwegian leaks around the edges of the
  translated strings (§5.4).

`searchApi.ts` also carries the one direct-to-origin call in the app: an ArcGIS
identify against `hoydedata.no` for the elevation readout, which is why that
host is in the Caddyfile CSP. Two `//TODO` comments live there (hardcoded `sr`
parameter, numeric-parameter validation) and are code notes, not doc material —
they stay.

### 7.1 Feature info

**It is a tool now, and it is off on arrival.** Stedsinfo — the ribbon toggle
beside Mål, or `I` — arms the readout; until it is armed, clicking the map does
nothing at all *except* answer for a heritage feature, on which see below.
Until 2026-09-11 every click on the map queried stedsnavn,
matrikkel, elevation and every visible WMS, dropped a marker and opened a panel
over the terrain. That makes the map's primary gesture a question nobody asked:
reading relief means clicking around constantly — to pan from, to check a
coordinate against a readout — and each of those clicks cost a panel to dismiss
and a request to the registers. Arming is cheap and one press; asking by
accident is not.

**The Kulturminner popup is outside the tool.** A click on a heritage feature
that is on the map opens its popup whether or not Stedsinfo is armed. Putting
it behind the tool was one gate too many: switching the overlay on is *already*
the act of asking for the heritage record, so a mark drawn at your request that
will not say what it is until you find a second, differently named control is
two controls for one surface — the failure §1 is about. The distinction that
replaces it is **asked for versus asked about**. The register you switched on
answers; a point you merely clicked does not volunteer its stedsnavn, its
matrikkel and its elevation until you say you want them. What stays behind
Stedsinfo is therefore the whole point readout — the coordinate marker, the
InfoBox, the elevation — including the fall-back marker for a heritage click
that *missed*: a miss is not a request for a coordinate.

`src/map/featureInfo/infoTool.ts` holds the three atoms and is the whole of the
policy:

- `infoToolAtom` — the button and the key. Writing `false` also clears the
  feature-info panel and a *coordinate* selected result; a search result is left
  alone, since the panel is its surface too and the search did not come from
  this tool. It no longer clears the Kulturminner popup either, for the same
  reason the popup no longer waits on it — the tool would be closing somebody
  else's window, and the popup has a close button.
- `heritageClickArmedAtom` — nobody else owns the click: neither measure
  (`mapToolAtom`) nor the drawing surface (`funnSessionAtom`). Suspension rather
  than disarming — leaving measure or putting the pen down restores the readout
  as it was found. On its own it is the whole gate on the popup. The drawing
  half is belt and braces since §9: a transparent canvas over the whole map
  takes every pointer event, so no click reaches OpenLayers while it is up.
- `infoClickArmedAtom` — that, **and** the tool is on. What the point readout
  reads.

It takes two handlers to produce one panel: `useFeatureInfoClick`
(GetFeatureInfo, the Kulturminner popup) and `useMapClickSearch` (the coordinate
marker and `selectedResultAtom`, which is what actually opens the InfoBox). The
second answers to `infoClickArmedAtom` alone; the first tests both atoms,
because it is the one that produces both kinds of answer. It also bails early
when unarmed and no heritage layer is showing, so an unarmed map sends no
GetFeatureInfo at all. `useMapClickSearch` used to bail on *any* `mapToolAtom`,
so the localities card suppressed the readout as a side effect of being open; it
no longer does.

The **armed** map carries a `crosshair` cursor, since a mode with no cursor of
its own is a mode you forget you left on. An unarmed map with the overlay on
does not, and deliberately: the cursor says "every click here asks a question",
which is true of the tool and not of a map where only the marks answer.

The two surfaces below are one more than a user needs:

- `src/search/infobox/InfoBox.tsx` + `FeatureInfoSection.tsx` — the right-column
  panel, showing coordinates, elevation, and WMS GetFeatureInfo results for the
  clicked point.
- `src/map/featureInfo/KulturminnerPopup.tsx` — a separate popup
  specifically for Riksantikvaren features, rendered as a sibling of the whole
  shell.

The panel is a title bar over a stack of controlled `Section`s, with the open
set in `InfoBoxSections.tsx` (all closed on arrival, except that feature info
opens itself on a single hit). Two details are deliberate: the fold button
**hides** rather than unmounts, because `PropertyInfo` draws the property
outline on the map and clears it on unmount — folding the panel away to look at
that outline is the point of folding it away; and the layer list inside feature
info is single-open and resets to the first layer on every new click, since
with several layers under the cursor it reads as a menu rather than a report.
The eight files share one `InfoBox.module.css`, as the results panel does.

`featureInfoService.ts` (595 lines) does the actual GetFeatureInfo dispatch and
parsing, including the `msGMLOutput` XML path that the Kulturminner layers need
(they are configured with `infoFormat: 'application/vnd.ogc.gml'`; left unset
the WMS returns HTML and the parser can only wrap it as an unhelpful
"HTML-respons mottatt" placeholder). Unifying the two presentation surfaces is
obvious rewrite work; the service underneath them should be left alone.

### 7.2 The Kulturminner popup reads its card as a glyph row

A heritage card is a name, and then a **row of icons**. `kategori`,
`vernestatus`, `datering` and `kommune` used to be four labelled `label: value`
lines with a 100 px label column, which is four lines and a column spent on
values that are almost always one word out of a closed list — so a click that
answered with three lokaliteter needed a scroll before the first `informasjon`
was on screen, and `informasjon` is the field worth reading. Now each is one
16 px glyph; hover, focus or a screen reader gets `Vernestatus: Automatisk
fredet`. The one exception is `(hover: none)`, where a glyph nobody can hover
over is a blank and the chips carry their text instead.

What decides whether a field can be a glyph is how big its vocabulary is, and
that was measured rather than guessed — a sweep of 14 dense areas returning
~1300 features, recorded in `src/map/featureInfo/heritageVocabulary.ts`:

- `lokaliteteskategori` / `enkeltminnekategori` — 12 values. One glyph each,
  and it is the card's **leading** icon, since it says what kind of thing this
  is before the name does.
- `vernetype` — 20 values, mapped onto the same five vern buckets the
  Kulturminner pulldown filters by (§5.9), so a chip's colour means what the
  filter means. An unmapped label gets a sixth, deliberately neutral `ukjent`
  rather than being folded into `uavklart`: "the register says unclear" and "we
  did not recognise what the register said" are different claims.
- `datering` — 66 values, mostly period names and year ranges. One clock glyph,
  value as text.
- `lokalitetsart` / `enkeltminneart` — **159** values, and the informative one.
  No glyph can carry that, so it stays text, as the card's subtitle, or as its
  title when the record is unnamed. That last part is why the word
  "Kulturminne" no longer repeats down a multi-hit popup.
- `fylke` — does not exist *in kulturminner2*. Not once in 1300 features, which
  is why "beliggenhet" is a pin and a word. Brukerminner do serve it, and there
  the chip takes both, since a kommune name alone is ambiguous nationally.

**The other four registers serve the same facts under other names, and the card
reads all of them.** kulturminner2 and `freda_bygninger` share one vocabulary;
`kulturmiljoer`, `sefrak` and `brukerminner` each brought their own, and a card
that looked up only the first left a brukerminne showing the register's name
("Brukerminner"), one kommune chip, and nothing else — no title, no text, no
link, even though the service had served all three. The field lists at the top
of `KulturminnerPopup.tsx` (`NAME_FIELDS`, `DESCRIPTION_FIELDS`, `ART_FIELDS`,
`DATERING_FIELDS`, `ID_FIELDS`) are the translation, and every one was read off
a live GetFeatureInfo rather than guessed:

| | name | description | art | datering | id |
|---|---|---|---|---|---|
| kulturminner2, freda_bygninger | `navn` | `informasjon` | `lokalitetsart` / `enkeltminneart` | `datering` | `lokalid` |
| kulturmiljoer | `navn` | `informasjon` | `kulturmiljokategori` | — | `lokalid` |
| sefrak | `objektnavn` | — | `bygningstypetekst` | `tidsangivelsetekst` | `askeladdenid` |
| brukerminner | `tittel` | `beskrivelse` | — | — | **none** |

Three consequences worth keeping:

- **A brukerminne has no id at all**, so `identityOf` falls back to its
  kulturminnesøk URL, which ends in the record's uuid. That is the only thing on
  the wire that separates two of them — without it the `*ikoner` dedupe collapsed
  every brukerminne in a click into one, and a spot with three showed one. A
  record with no identity *whatever* gets a per-feature key, so it can never
  dedupe against a sibling. The URL is a grouping key and never printed: the
  card's id corner shows only ids the register owns.
- **A served link is always shown**; only the *synthesized* `askeladden?kid=`
  URL keeps the "real POI" guard, since a kid built from a sikringssone's id
  404s. Suppressing served links for the non-kulturminner2 kinds took away a
  brukerminne's only exit.
- **The leading glyph and its tooltip name the register** for the three that
  aren't kulturminner2 (`house`, `landscape`, `person_pin_circle`) — "Enkeltminne"
  over a SEFRAK building is the wrong noun — and a brukerminne's `opprettet_av`
  / `opprettet` become chips, because who reported it and when is that
  register's standing, in the place vernestatus holds elsewhere.

**A shown link is not the same as a link that works.** The
`linkkulturminnesok` on a kulturminner2 or freda_bygninger record resolves
through `kulturminnesok.no/ra/lokalitet/<id>`, and a large minority of the
register simply is not in Kulturminnesøk's index — 3 of 7 lokaliteter around
Gimsø in Skien, 4 of 18 around Borre, with nothing on the WMS wire to tell
them apart from the ones that are. A miss is quiet: the resolver answers 200,
echoes the raw id into the URL, and the page renders a blank entry. So the
card **asks**, through `/kms/*` (`wms-proxy-and-tiles.md`), and marks the link
— muted, dotted underline, an `info` glyph, and a tooltip saying Kulturminnesøk
has no entry; `(hover: none)` gets the sentence written out under the row, the
same trade the chips make.

Marked, not hidden, and that is the whole decision. The record is real and the
URL is Riksantikvaren's own statement about where it lives; a missing page is a
fact about Kulturminnesøk's index, and hiding the link would hide that fact
too. The probe is also allowed to fail: `useKulturminnesokStatus` starts at
`unknown`, so the link renders immediately and is only ever *decorated* later
— a dead probe costs the mark, never the exit. Brukerminner (uuid links) and
SEFRAK (no link at all) fall outside the resolver's URL shape and are left
alone rather than guessed at.

Two contingencies for `informasjon`, which runs from empty to several
paragraphs: it is **open** and clamped to four lines rather than hidden behind
a button, and the `Mer` toggle appears only when the clamp actually bit —
measured, because a character count and a line clamp disagree at the popup's
width and a `Mer` that expands nothing is worse than no `Mer`. The nested
enkeltminne list is a disclosure, open only when a single card answered the
click.

---

## 8. The lokalitet workspace

A **lokalitet** is an authored rectangle: an area to explore, not a claim that
something is there. It holds **funn** (individually named drawn features) and
**bilder** (kept LiDAR extracts, terrain renders, map screenshots, flyfoto,
uploads). The bbox is authored, never derived from its content — if a drawn funn
escapes the rectangle, the workspace offers to grow it rather than silently
resizing.

The workspace is the only route to drawing, LiDAR extract **and terrain
analysis**. There are no standalone `draw` / `lidarExtract` / `newFind` map
tools, and since §12's step 15 there is no standalone Terreng either: reading
relief is reading *a rectangle*, and the only rectangle in the app is a
lokalitet's, so pressing Terreng with nothing open frames one (§5.3).
**Measure** is the one exception left, and it earns it by being ephemeral —
it leaves nothing behind, so there is nothing for a rectangle to hold.

That is a reversal, and it is worth naming as one. The rule used to be
*reading the ground is not an act of ownership*, and its consequence was a
signed-out visitor who could compute relief over any rectangle in Norway. The
cost of the change is exactly that: **relief now needs an account.** What was
bought with it is one rectangle instead of two, one save path instead of two,
and a `Lagre` that can no longer create a lokalitet nobody asked for. The
principle that replaces it is narrower and holds better: *reading is not
writing* — every read tool on the lokalitet row is available to a reader in
full, in both stances, and only its exits escalate (§8.1).

### 8.1 Anatomy

There is no workspace *panel* and no dock. The state is one controller hook,
`src/localities/useLocalityWorkspace.ts`, and the presentation is two ribbon
rows, the bottom edge of the map, a popover, a map callout and the dialogs:

| Region | Component | Contents |
|---|---|---|
| Identity, the work, the exits | `RibbonLocalityRow` (the lokalitet row) | four zones — see below |
| What the rectangle holds | `FunnList`, in the `[Funn ▾]` pulldown on that row | the funn index |
| The funn being drawn | `RibbonFunnDraftRow` (row 4); the pen is `FunnSurface` over the map | title, save state, *Utvid området* — §8.5, §9 |
| The selected funn's note | `FunnCallout` (an `ol/Overlay` on the map) | title, status, note, beside the shape — §8.6 |
| The images | `BilderStrip` / `BilderCarousel` / `BilderPicker` (bottom slot) | the same rail in both stances — read-only in show, the write verbs and drag-to-reorder in edit; a picker run borrows the slot — §8.7.2, §8.9.3 |
| Dialogs | `LocalityDialogs` | Detaljer, the two `Hent ▾` selection dialogs and the flyfoto licensing notice |

**The row is five zones in three grid cells**, and each zone answers one
question (`docs/lokalitet-view.md` §5.1–5.5):

| Cell | Zone | Question | Present when | Contents |
|---|---|---|---|---|
| left | identity | *what am I looking at* | always | the literal word `Lokalitet:`, the name (click to rename in edit, click to zoom in show), the short code chip (click to copy), the visibility badge, the banner slot |
| left | the contents | *what did someone put here* | always | `Skisse ▾` (only when there are sketches) · `Funn ▾` · `Bilder ▾`, all with a count badge |
| left | the work | *what can I do to it* | **edit only** | Nytt funn · Behold · `Hent ▾` · Skjermbilde |
| centre | the ground tools | *what does this ground look like* | always | Terreng · Sammenlign |
| right | the exits | *how do I get out of here* | always | deepest-first — see the depth table below |

**A grid of `1fr auto 1fr`, not a flex row** (`RibbonLocalityRow.module.css`).
The `auto` column is what puts Terreng and Sammenlign on the row's own
midpoint instead of on the midpoint of whatever the lokalitet's name leaves
over — a control that walks sideways as you move between sites is one you have
to look for. The side cells are `min-width: 0`, or an over-long name grows its
column and takes the centre with it. Below 48 rem the grid collapses to a flex
row with the exits pinned right by an `auto` margin; the cells are real
elements, so the grouping survives the collapse.

**The centre is set apart by kind of tool, not to fill three columns.**
Terreng and Sammenlign interrogate the ground and the data answers; everything
in the left cell is a statement about the *record* — what it is, what is in it,
what you can put in it next, read left to right — and the ground tools are the
odd group out, which is why they get the middle to themselves. The right cell
holds only the ways out, which is what a right edge is for.

Inside the left cell the contents come **before** the write verbs, so the pair
keeps its place when the verbs appear and disappear with the stance: pressing
`Rediger` must not move `Funn` out from under the pointer. `.identity` is
`flex: 0 1 auto` for the same reason — it used to take the row's slack, and
growing would now push the two zones after it out to the cell's far edge.

**The contents zone is turning into the layer row** (`docs/lokalitet-view.md`
§13.1). The end state is four `[thing ▾]` groups — Visning · Bilde · Skisse ·
Funn — left to right in the map's own z-order, so the row teaches the stack.
`src/shell/LayerGroup.tsx` is that control and **three of the four wear it**:
`[Visning ▾]` (§10.1), `[Skisse ▾]` (§9.3) and `[Funn ▾]` (§8.6). The label
takes the group off the map, the caret opens a pulldown, and every member has a
switch. Visning is leftmost because it is the ground and everything else is
over it; Skisse sits left of Funn because sketches are `zIndex: 2` and the funn
layer is 5. `[Bilde ▾]` lands between Visning and Skisse.

Three properties of it that are not obvious from the screen. **The label
toggles and the caret opens.** That is the opposite polarity to `EyeSplit`, and
re-clothing `Funn` is what settled it: on an index the everyday press is "show
me the list", on a layer group it is "take this off so I can see what is under
it", and the lokalitet row is a row of layer groups. `EyeSplit` stayed for its
one remaining caller, `Kulturminner` on row 1 (§5.9), and the seam CSS stayed
duplicated rather than shared — with the two idioms one per row and pointing
opposite ways, a shared frame would couple two things whose only remaining
likeness is that they are both a button with a chip welded to it.

**Opacity is a raster idea, so it is per group rather than per member of every
group.** Skisse's members each carry a transparency slider; Funn's do not, and
the reason is not expedience — the funn are one vector source drawn as a cased
outline over a 0.12 fill, i.e. marks on the ground rather than a covering of
it, so the verb for "this one is in my way" is its switch
(`docs/lokalitet-view.md` §13.10 step 4). `LayerMember.opacity` is optional for
the same reason read the other way: [Visning]'s ground preset is a raster and
still has no slider here, because the background is a *stack* of tile layers
and the grounds that can be faded are faded from the settings strip, where all
their other modifiers are.

**A member row can carry one verb.** `LayerMember.action` puts an icon button
at the row's right edge, outside the switch's hit area because a `<button>`
cannot nest one and because the verb moves the map. It has exactly one user:
`Gjenskap` on each View in [Visning] (§10.1).

And **nothing in the group writes** (`docs/lokalitet-view.md`
§13.8): a switch is *what I am looking at now*, which is not the same statement
as `hidden`, which is curation. So there is no stance gate anywhere in
`LayerGroup` and a reader gets it at full function. A group with no members is
**absent**, not disabled — `[Skisse ▾]` is not on the row in a lokalitet with
no sketches, and a permanently dead button teaches nothing.

**The component is the button and the frame; the body is the caller's.**
`children` is a render prop taking `close`, and the ordered member list with
its switches and sliders is a second export, `LayerMembers`, which is what
[Skisse] passes. That split is what let [Funn] keep `FunnList` — inline rename,
a status menu, a row menu, tombstones with `Angre` — instead of flattening it
into a generic member row, while still dismissing the pulldown when you pick
one. Nothing in `LayerGroup` knows what is in the group.

The ground tools and the contents are present in **both** stances, because
reading is not writing — the same argument that makes show mode absolute about
the write verbs is what keeps `Funn` and `Bilder ▾` out of them. The count
badges are what make a popover an acceptable home for the list at all: *how
many funn are in this rectangle* is on the row whether anything is open or not,
so consulting the index is a choice rather than a tax.

**The exits are a stack, and the deepest thing in flight owns the zone**
(`docs/lokalitet-view.md` §5.3). Everything shallower is hidden while a deeper
thing is open, which is what stops one row offering to end two different things
with two buttons that both say `Ferdig`:

| Depth | When | Contents |
|---|---|---|
| 2 | a funn draft is open | `[Ferdig med funn]` `[Forkast funn]` |
| 2 | Juster området is on | `[Bruk]` `[Angre]` |
| 1 | edit, nothing deeper | `[Lagre]` `[Avbryt]`* `[Avslutt]` `[⋮]` |
| 0 | show, and you may edit | `[Rediger]` `[Lukk]` `[⋮]` |
| 0 | show, and you may not | `[Lag min kopi]` `[Lukk]` `[⋮]` |

\* **Depth 1 is three buttons on two axes, and `Avbryt` is conditional.**
`Lagre` and `Avbryt` are about the *buffer* — commit it, throw it away — and
`Avslutt` is about the *stance*. Neither buffer verb ends the session any more
(§8.11), so an author can save five times in an afternoon without being thrown
back into show and having to press `Rediger` again, and `Avbryt` is rendered
only while there is something to discard: a button offering to undo nothing is
a button that has to be read before it can be ignored. Leaving with a dirty
buffer asks, and the question has three answers — *Bli værende*, *Forkast og
avslutt*, *Lagre og avslutt* — because an author on their way out usually meant
the third one.

Both depth-2 pairs are two buttons because both now have something to undo
*to*. `Forkast funn` used to be offered only for a new funn — autosave had
already overwritten the old shape by the time a geometry edit closed, so there
was nothing left to restore — and the transaction (§8.11) is what made the
promise good for both: the pre-edit geometry sits in the buffer, and discarding
puts it back. `Juster området` gets a **nested** undo of its own for a
different reason: the rectangle it changes is the one thing edit does *not*
buffer (§8.11), so `[Angre]` restores a stashed `bboxBefore` rather than
riding on `Avbryt`, whose grain is the whole session.

There is no `[←]` back arrow: leaving is an exit, exits are on the right, and
one lokalitet should not have two ways out at opposite ends of the same row.
Edit tints the row (`.rowEdit`) — the zones already differ, so the tint is the
confirmation rather than the signal. `Del` waited for `?lok=CODE`, which now
exists, and landed in the `⋮` menu rather than on the row itself (§8.13) — it
is one clipboard write, and the exits zone is for exits.

The two depth-0 rows are **one slot, filled two ways**: `mayEdit` decides which
verb a lokalitet offers, and a reader gets `Lag min kopi` (§8.12) rather than a
greyed `Rediger`. Signed out there is neither — the copy is a write like any
other, and it needs somewhere to put the new record.

The `[⋮]` menu is on the row in **both** stances, and it is how a reader opens
Detaljer. Its two writing items (`Juster området`, `Slett`) are gated on
`canEdit` inside it, so in show it holds three entries: `Zoom til
lokaliteten`, Detaljer and `Del` (§8.13). Zoom is there unconditionally
because the name — the fast way to it — means *rename* in edit, and a verb
that changes homes with the stance is a verb you have to hunt for. `Del` is
unconditional for a different reason: a reader sharing on a lokalitet they
were shown is the ordinary case, and a link grants nothing the recipient did
not already have.

The **banner slot** takes the space the old summary line (`3 funn · 12 ha`)
occupied, holds at most one sentence, and answers only *whose is this and what
state is it in*. Three sentences compete for it, and the rank is fixed:

1. *Gjenopprettet ulagret arbeid fra 14:32* · **Forkast** — a buffer that came
   back off disk (§8.11).
2. *Lager din kopi… (3 av 7 funn)* — a fork being written right now (§8.12).
3. *Delt av X — du leser*, for a reader.
4. *Du redigerer Xs lokalitet som administrator*, for an admin **in edit**.
5. *Kopiert fra X (Y)* · **Åpne originalen** — you are in a copy (§8.12).

Ranks 1 and 2 are the two that are *news*, and they are the two that get colour
(`.bannerAlert`); the rest are standing facts the reader already knows and can
go on knowing a few seconds longer. Rank 5 is last precisely because it is
permanent: a copy is a copy forever, so its line must never be what you read
instead of "somebody is editing this out from under you".

The design (§5.7) keys rank 4 on being an admin at all, which would print "Du
redigerer" at somebody who is only looking; the stance test is deliberate.
Deliberately not a notification area — everything else stays next to the thing
it is about.

**Terreng and Sammenlign are read tools, and that is why they are here**
(`docs/lokalitet-view.md` §8). Both read a rectangle — one asks what shape the
ground is, the other asks it to hold still beside another ground — so both
render in **both** stances and in full for a reader, gated on nothing. Only
their exits write, and those escalate on their own: keeping a terrain render is
`Behold`, which is `canAdd` like every other write verb (§8.9.2).

The machinery did not move with the buttons. `useGroundMode` and the four
control hooks stay mounted once in `RibbonGlobalRow` — row 1 and the settings
strip run off the same objects, and a second mount would mean a second DEM —
and row 1 and the lokalitet row are siblings in separate error boundaries, so
there is no parent to pass anything down from. `RibbonGlobalRow` publishes the four
members these buttons need (`mode`, `half`, `previous()`, `select()`) on
`groundHandleAtom` (`src/shell/groundHandle.ts`), through a ref so the atom
changes only when `mode` or `half` does; `cycle` and the peek stay behind,
where the keyboard is registered. Same gap and same direction as
`beholdOfferAtom`. A `null` handle means row 1 has not rendered yet or crashed
inside its own boundary, and the two buttons are simply absent.

Splitting the old panel up removed the `key={locality.id}` remount that used to
reset its `useState`, which is why the state had to move into the controller
first. What stays component-local is the half-typed name in `LocalityName`,
still keyed on `locality.id` for exactly that reason.

`LocalityRibbon` is the single mount point for the controller (§5), renders
the draft row, decides which of the four surfaces owns the bottom slot, and
mounts the callout: the hook holds two PocketBase realtime subscriptions that
reload the whole list on every event, so a second call site would double
both.

#### Who may do what — `access`, `stance`, `canEdit`, `canAdd`

Two axes, not one (`docs/lokalitet-view.md` §1). `access: 'owner' | 'admin' |
'reader'` is a **fact about the record**; `stance: 'show' | 'edit'` is a
**choice made inside it**, held in `editingLocalityIdAtom` and reset by
opening anything else.

**Nothing in show writes.** Not disabled verbs — *absent* ones: the write-verb
zone does not render, the name renames nobody (it zooms to the rectangle
instead), the `⋮` menu holds only zoom, Detaljer and `Del` — none of which write —
and its fields are
read-only, and the bottom edge is a rail with
no delete, no reordering, no hide-from-exhibit and a read-only caption rather
than the same
rail carrying all four; funn are not editable, and N / U / B do nothing. Reading, putting an image on the map and taking it off again,
the whole layer row, `Gjenskap` in [Visning]'s pulldown and downloading a
figure all stay, because none of them leaves a trace. The one way to write is
to press `Rediger` first, which costs nothing: no fetch, no write, the map
does not move.

Stance is per session and never stored on the record. Every lokalitet opens in
show — including your own, including from a link — with one exception: a
**brand-new** one opens in edit, because a rectangle placed thirty seconds ago
has nothing to show. There is one creator now — `useLocalityPlacement`'s
`Opprett` (§5.6) — and it says so by setting `editingLocalityIdAtom` in the same
batch as `activeLocalityAtom`. Keying that atom on the record *id* rather than
using a boolean is what makes "opens in show" hold by construction rather than
by clearing a flag in the right order.

The controller folds the two axes together so the surfaces below it read one
boolean each. Permission comes from PocketBase's rules, which are two:

| | update / delete | create |
|---|---|---|
| PB rule | `owner = @request.auth.id \|\| @request.auth.role = "admin"` | `@request.auth.id = owner && locality.owner = @request.auth.id` |
| May | `mayEdit` — owner *and* admin | `mayAdd` — owner only |
| Published | `canEdit` = `mayEdit && stance === 'edit'` | `canAdd` = `mayAdd && stance === 'edit'` |

Only `mayEdit` is published alongside them, for the one decision that is about
what you *could* do rather than what you are doing: whether the right zone's
first slot holds `Rediger`.

So an admin may rename somebody's lokalitet, retitle and delete its bilder,
change a funn's status or geometry, reshape the rectangle and throw the whole
thing away — but may not put new content in it, because the create rules also
demand the *parent's* owner. Their overflow menu is Juster området and Slett;
Nytt funn, Behold, Ta skjermbilde, Flyfoto and Last opp are not there.
Showing an admin a button the server would 403 is the same lie as hiding one it
would obey, pointing the other way.

A reader — signed in, looking at a public lokalitet that is not theirs — gets
neither, and the banner says *Delt av …* whenever `access !== 'owner'`. That
test is attribution, not permission: an admin can change the record and it is
still somebody else's. A reader's one verb is `Lag min kopi` (§8.12), which
writes a *new* record and so needs neither `mayEdit` nor `mayAdd` on this one;
a slot that would hold a button that cannot work is left empty rather than
filled with a disabled one.

**Absent applies to verbs; text fields go read-only instead.** Sted, Kommune,
Matrikkel, Beskrivelse and a bilde's caption are content, not buttons — hiding
them in show would hide the record — so they render as `readOnly` rather than
`disabled`, and `.control:read-only` (`src/ui/Field.module.css`) drops the
border and background instead of dimming. This changed with stance: a
`:disabled` field at 0.55 opacity used to be a thing only readers saw, and once
show became the default stance for owners too it would have greyed out every
lokalitet's own text on arrival, which reads as broken rather than as
read-only. The one control still merely disabled is Synlighet's `Segmented`,
where the value *is* the widget.

Terrenganalyse's **Lagre** used to be the one unguarded write — with somebody
else's lokalitet open it targeted that lokalitet and failed with a toast. It
does not exist any more. Keeping a terrain render is `Behold` on the lokalitet
row (§8.9.2), gated like every other verb in that zone, and the terrain strip
carries no actions at all (§10). Forking somebody else's rectangle instead of
being refused is §8.12.

### 8.2 The subjects, and Detaljer

There was a dock — a fixed 360/400 px column down the right of the map holding
the live tool, then Funn, Kulturminner and Detaljer as collapsible sections,
with a second `TerrainDock` beside it before Terrenganalyse's knobs moved onto
the ribbon (§10). It is gone (`docs/lokalitet-view.md` §6), and §15 records
what went with it. The argument that killed it is the one that killed the old
tray: a column costs a fixed slice of the *width* of the very ground it is
describing, and it charges that rent whether or not you are reading it. Three
of its four occupants were things you consult, not things you watch.

So each one went to a surface priced like the use:

| Was a dock section | Is now | Because |
|---|---|---|
| the live tool band | `RibbonFunnDraftRow` (§8.5), and since §9 the tools themselves are Excalidraw's own, on the canvas | it *is* watched, continuously, while you draw — so it belongs where the hand is, and the hand is on the map |
| Funn | `FunnList` in the `[Funn ▾]` pulldown on the row, with a count badge | consulted; the count is the part you want at a glance, and a badge carries that without the list |
| Kulturminner | nothing — deleted outright (§15) | the register it listed is already the map's headline overlay, clickable; a second, text-only copy of it inside a lokalitet was a duplicate wearing the same word |
| Detaljer | a `Dialog` off the `[⋮]` menu | set once and stopped looking at; the one surface here you want *modal*, because you are typing prose into it |
| a funn's note | `FunnCallout`, an `ol/Overlay` beside its shape (§8.6) | it is about a place, and a list row is not a place |

The count badge is load-bearing, not decoration — see §8.1. *How many funn
are in this rectangle* was legible in the dock without opening anything, and a
popover that hid the number would have been a straight regression. Since
`[Funn ▾]` became a layer group the badge counts what is *on the map* rather
than what exists (§8.6), which is the same number in every case but the one
where you have just switched something off.

`LocalityDetails` opens with the location group: **Sted**, **Kommune** and
**Matrikkel** as ordinary text fields, then **Koordinater** and **Areal** as
read-only facts. Nothing in it has a Lagre button — like Beskrivelse, each
field commits on blur (Enter blurs, Escape reverts without blurring, or the
stale draft in the closure would be saved anyway), into the transaction's
buffer (§8.11). Since that landed the missing footer is load-bearing rather
than merely tidy: the only `Lagre` there is lives on the row behind this
dialog, and a second one here would be a competing promise about when the
change lands. It is offered in **both**
stances and renders itself read-only without `canEdit`, which is why `[⋮]` is
on the row in show mode at all.

The three fields are pre-filled at creation from the public registers
(`src/localities/localityContext.ts`, §8.3) and are the user's afterwards. The
only thing that overwrites them is the `canEdit` **"Hent stedsdata på nytt"**
button below the facts, which re-asks for the rectangle as it now stands —
"Juster området" would otherwise leave all three describing the old one, with
retyping as the only recourse. Koordinater is not a field: it is computed from
the bbox on every render (`formatBboxCentre`), so it cannot go stale at all.
Sted, Kommune and Matrikkel are also matched by the Lokaliteter panel's search
box, which is most of why they are fields rather than a paragraph of
Beskrivelse.

### 8.3 Auto-naming a new lokalitet

A rectangle placed with "Ny lokalitet" arrives already called something —
`createLocalityFromBbox` awaits `fetchLocalityContext(bbox)` and writes the
nearest significant stedsnavn as the record's `name`, falling back to "Uten
navn" only when the register has nothing (open sea, across the border, service
down). The lookup happens **before** the record is written, not as a patch
after: creating first would open the ribbon on "Uten navn", auto-focus its
rename field — which fires on exactly that name — and then change the text
under the user's cursor.

That is also the whole rename contract. Row 2's name field still opens by
itself for a record named "Uten navn", so a nameless lokalitet still asks to be
named; an auto-name good enough to keep does not shove a cursor at you. Click
it to change it, like any other.

It runs **at the commit**, which is the placement step's one effect on this
section (§5.6): the lookup is now spent on a rectangle the author framed
deliberately rather than on whatever the screen happened to show. The ordering
argument above is untouched — still before the write, still awaited.

`fetchLocalityContext` never rejects and never takes longer than 6 s, and the
one place that calls it — `createLocalityFromBbox`, behind
`useLocalityPlacement`'s `Opprett` — disables the button while it runs. Both
entrances arrive here through the same placement session: the `Ny lokalitet`
button, and pressing Terreng or `5` with nothing open (§5.3). The second is why
`create` hands the record back rather than returning `void`: the commit has to
arm `ribbonToolAtom` afterwards, and only on success, or a failed create would
leave `'terrain'` armed for whichever lokalitet is opened next. Which registers it asks, and how the
placename is ranked, is out of scope here — see the header comment in
`src/localities/localityContext.ts`.

`src/localities/ui.tsx` is gone: its vocabulary moved into `src/ui/` and is now
shared with the shell. `WorkspaceSection` became `Section`; `NoteInput`,
`Segmented` and `ConfirmPopover` kept their names. `ConfirmPopover` still
exists specifically to replace `window.confirm`, which cannot be styled and
blocks the event loop while the map keeps rendering behind it. The
`BadgePalette` / `ButtonPalette` colour maps are token classes now instead of
kvib `colorPalette` strings, and still keep funn status colours consistent
between the list and the map.

### 8.4 Keyboard

`src/localities/useWorkspaceKeys.ts`, capture phase, one `document` listener,
bails on repeats, modifier keys, and anything typed into an input, textarea,
select, `contenteditable`, or inside an open popover/dialog/select (matched via
`[data-scope="popover"]` etc. — `src/ui`'s `Popover` and `Dialog` set those
attributes for exactly this, and §12 records why the convention outlived the
library it came from). Both also
consult `anyOverlayOpenAtom`, since the attribute walk only reaches anything if
the overlay actually took focus.

| Key | Action |
|---|---|
| ↑ / ↓ | Move funn selection (only when `navigable`); in **show**, zoom to each as you land on it |
| ← / → | Walk the filmstrip (only when `stripNavigable`) |
| Enter | Zoom to selected funn (only when `navigable`) |
| N | Arm drawing / put the pen down — the same toggle as the lokalitet-row button the key is advertised on |
| U | Toggle the LiDAR-uttrekk dialog |
| B | Screenshot |
| Escape | Close / back out — **except while a funn draft is open** |

N, U and B are **edit-only**, gated on the same `canAdd` as the buttons they
are advertised on: a keystroke that writes is still a write, and an invisible
shortcut is the easiest place for "nothing in show writes" to spring a leak.

**A picker run swallows the keyboard whole.** While one is up (§8.9.3) the
handler takes ← / →, Enter/K, Delete/X and Escape for the run and returns
before any of the rows above are consulted — the images you are walking are
the proposals, not the collection, and `N` arming the pen behind a modal-ish
surface is not what the key meant. `Esc` ends the run rather than backing out
one level, which it can afford to do because nothing in the run is unsaved:
keeping writes on the press.

Escape otherwise backs out deepest-first, in the same order the row's right
zone is stacked: picker run → extract dialog → Juster området (as `Angre`) →
funn selection → **edit** → close the lokalitet. Leaving the stance before
leaving the record is what stops one press from throwing away both.

At the edit step it is `Avslutt`, and **only when the buffer is clean**
(§8.11). Over a dirty transaction Escape has no honest meaning: it would have
to pick between `Lagre` and `Avbryt`, and a stray keypress does not get to make
that choice — nor to raise the three-answer exit confirm the button raises,
since a dialog opened by a fumbled keystroke is one more thing to read before
it can be dismissed. It does nothing at all instead, and the three buttons are
right there.

`navigable` is off only while drawing: picking a different funn out from under
the pen is never what the arrow meant. It does **not** require the funn
popover to be open — the point of the keys is that they are the way to walk
the collection without one.

**In show, ↑ / ↓ are a tour.** Each step zooms the map to the funn it lands on
(`docs/lokalitet-view.md` §6), which turns the two keys into "walk me round
this site" for a reader who has no list open and no reason to open one. In
edit they only move the selection, because there the selected funn is the
thing you are about to act on and moving the map under a pen is hostile.

`stripNavigable` is narrower — the strip has to be unfolded, no draft open, and
more than one image in it. Anything less and ← / → fall through to
OpenLayers' `KeyboardPan`, which is what they mean when there is no strip to
walk. They move the rail and nothing else — selecting a frame stopped touching
the map at `docs/lokalitet-view.md` §13.10 step 6 (§8.7.1) — and the selected
frame scrolls itself into view.

That Escape carve-out is deliberate: Excalidraw binds Escape to abort the
shape currently being drawn and to drop a selection, and stealing it would
throw away a drawing instead of a keystroke. Under autosave (§8.5) it is also
no longer the data-loss risk it was — everything already drawn is a buffered
record by then.

Row 1's map keys (1–5, hold X, A/D/W/S/E) are a separate listener and keep
working throughout; see §5.3.

### 8.5 Funn autosave

**A funn is a record from the moment its first shape closes.** There is no
Lagre button on the draft and no disabled-until-titled state.

Since §8.11 the record it becomes is a *buffered* one: autosave's destination
moved from PocketBase to the draft, and nothing else about it changed. That is
the whole of the transaction's effect on this section — `useFunnAutosave.ts` is
byte-identical, because it never knew where its two callbacks wrote.

That replaced a commit-or-discard form whose Cancel was called *silently* from
five places — Escape, "Nytt funn" used as a toggle, opening the extract,
starting an adjust, closing the workspace — each of which cleared the draw layer
and threw the drawing away. The trade-off, taken deliberately: a stray click can
leave a junk funn to delete, which is a recoverable annoyance where the old
failure was not.

`src/localities/useFunnAutosave.ts` is the mechanism. It watches the drawing
scene (`funnSceneAtom`, written by the surface on every Excalidraw `onChange`),
debounces `SETTLE_MS = 700` — long enough that dragging a vertex is one save and
not forty — converts the elements to a `FeatureCollection` through the session's
frame (§9.2) and then either creates the record or patches its geometry.
`useLocalityWorkspace` supplies both callbacks and holds the one the hook
returns (`flush`) in a ref, because the halves point at each other.

Six rules in there are load-bearing:

- **An empty scene is never a delete.** Putting the pen down takes the surface
  away, and a scene that serialized to "no features" on the way out would erase
  the funn. Removing one is the list's job.
- **One write at a time.** Two creates in flight is two funn, so a second change
  during a request sets a dirty flag and re-arms the timer instead.
- **The first scene after arming is a baseline, not a change.** "Rediger
  tegningen" round-trips the record's `FeatureCollection` back through
  `geometryToScene` (`src/funn/geometry.ts`) and opens the surface with those
  shapes already in it — and that arrival must not immediately re-save the
  geometry it just loaded. Nor must the pen going down over an empty canvas.
  The hook answers both by taking its baseline from the first scene it sees
  after the session arms, rather than from a `rebind()` the caller has to
  remember to make: there is no third way in, so there is nothing for a caller
  to know that the arming effect does not.
- **Every exit flushes first.** `stopDraft`, `openLidar`, `toggleAdjusting`,
  deleting the drafted funn, and the workspace's unmount cleanup all call the
  flush *before* the session ends — and so does `Lagre`, which would
  otherwise commit a buffer that is up to 700 ms behind the pen.
- **The drafted funn stays hidden while the pen is on it.**
  `hideFunnOnLayer(id)` sets a module-level id in `funnLayer.ts`, not a one-time
  style pass: every buffered patch re-renders that record's features from
  scratch, and without the id the saved copy would sit under the Excalidraw
  strokes drawing the same shape twice — once in orange vectors, once in a
  hand-drawn line. `hideFunnOnLayer(null)` lifts it.
- **Titles are never empty.** The create names the funn `Funn n`
  (`localities.funn.autoName`) rather than blocking on one being typed — a funn
  you can rename is worth more than a funn you have to name — and the draft
  band's title field reverts rather than clearing it.

The receipt used to be a **toast carrying an "Angre"**, which is what let the
first shape commit without asking. The transaction retired it: `Forkast funn`
is now offered on both arms of the draft (§8.1) and `Avbryt` sits behind that,
so an undo of the last create is one of three ways back and the loudest of the
three. `src/ui/Toast.tsx` keeps its optional `action` — the picker runs use it.

**The draft is accordingly not a form, and it is not one surface either.**
There is nothing to submit, so what is left splits by what it is for.
`RibbonFunnDraftRow` (ribbon row 4) carries the *identity* — the title,
committing on blur like a row in the list, and beside it the state word. That
word is *"Lagres med lokaliteten"*, never "Lagret": saying a thing is saved
when it exists only in this tab is the transaction's one unforgivable lie.
The *pen* is not a second surface at all any more: Excalidraw brings its own
toolbar and puts it on the canvas, over the map it is drawing on, so
`FunnDrawBar` and the whole of `DrawControls` behind it went with `src/draw/`
(§9, §15) and the bottom slot has one occupant fewer to arbitrate (§8.7.2). The
exits are on neither: they are depth 2 of the lokalitet row's right zone
(§8.1), because a draft is a thing you are inside of, and the row is where
this app says how to get out.

The note went to the map (§8.6). It is the one field that is *about a place*,
and it was the field the old dock band was worst at: a textarea in a column on
the right, describing a shape on the left, with the shape's own extent as the
only thing that could tell you which one it meant.

**Grow-to-fit is an inline warning on the draft row, not a modal.** Drawing past the edge
of the rectangle is worth remarking on and not worth stopping the pen for.
`funnOutsideAtom` is a **flag**, not the union bbox it used to hold: it is
written while the pen is moving, and re-publishing a rectangle that grows with
every frame of a drag would re-render the row per frame to say the same thing.
"Utvid området" recomputes the union at press time — `sceneExtentToBbox4326`
over the live scene (§9.1) — which also means it cannot grow the rectangle to
fit a shape since moved back inside.

### 8.6 How a lokalitet and its funn draw on the map

**A frame around the ground, never a tint over it.** Relief shading is the thing
being read, and an interior fill — even at 4 % — is the loudest object on a grey
hillshade. So `localityLayer.ts` draws no fill, a thin line cased in white so it
survives both dark relief and bright ortofoto, corner brackets to say "this one
is open", and the name in a chip pinned to the top-left corner instead of a
haloed word across the middle of the view. `funnLayer.ts`'s default is the same
treatment: white casing under an orange stroke, fill at 0.12.

One catch worth not rediscovering: the rectangle keeps a **1 % white fill**.
OpenLayers hit-detects a polygon's interior by re-executing its fill and testing
the alpha byte, so dropping the fill entirely would make a rectangle clickable
only within a few pixels of its edge — and clicking one is how you open it.

`useFunnPointer` (mounted in `useMapSideEffects`) completes the link the list
already had in one direction: hovering or clicking a funn *on the map* writes
`hoveredFunnIdAtom` / `selectedFunnIdAtom`, so the two views of the same set stay
pointed at the same thing whichever one you touch. Clicking past a funn is
deliberately **not** a deselect — the click may well be aimed at the background,
and losing the highlight on every pan-nudge would make it useless. The hover
handler keeps the last id in a local and writes only transitions; it fires on
every mouse move over the map.

**The note is a callout on the map.** `FunnCallout` is an `ol/Overlay`
anchored to the top-centre of the selected funn's extent, `bottom-center` with
a 12 px offset, so it stands over the shape it is about the way a label stands
over a feature on a paper map. It holds the title, the status badge, a close
button and the note, and it appears in both stances — reading what somebody
wrote about a mound is not editing it.

- **It reads the extent from the layer, not from the record.** `geometry` is
  EPSG:4326 in the record and the anchor has to be in the view's projection;
  `getFunnExtentOnLayer(id)` returns what is actually drawn, which also means
  the callout follows a shape being edited instead of hanging over where it
  used to be.
- `stopEvent: true`, because it holds a button and a scrollable note; `autoPan`
  so selecting a funn near the top edge does not put its note off screen.
- The note is clamped to four lines. It is a glance at the map, not the record
  — a long note is read in the funn list, and the callout that tried to hold
  one would cover the ground it is pointing at.
- **`funnHiddenAtom` takes it down with the layers.** It is part of the
  drawing: the whole point of the eye is an unobstructed look at the relief,
  and an overlay that survived the flag would be the loudest thing left on
  screen.

**`[Funn ▾]` is a layer group, and its label is the switch.** Restraint in the
styling only goes so far: a cased outline sitting exactly on the bump you are
judging is still on it, and the point of the curtain and the digit keys is to
look at the *ground* in two acquisitions. `funnHiddenAtom` — pressing the word
`Funn` on the lokalitet row, or key **H** — takes the funn layer and the
selection halo off through `useFunnVisibility`
(`src/localities/funnVisibility.ts`). The caret beside it opens the index.

That is the duties of the two halves **swapped**: until `docs/lokalitet-view.md`
§13.10 step 4 the label opened the list and an eye welded to its right edge did
the hiding. Nothing about what either press *does* changed — what changed is
which half does it, so that the four groups the contents zone is becoming
(§8.1) all speak one polarity. `EyeSplit` and its polarity survive on row 1's
`Kulturminner` (§5.9).

- **`setVisible(false)`, never removal.** Everything the glance must leave
  alone hangs off those layers: the hydrated features, two realtime
  subscriptions, the selection, and `funnLayer`'s idea of which funn is hidden
  because the pen is on it (§8.5).
- It re-applies on the layer collection's `add` as well as on the flag, because
  each layer is created by its own hook and one arriving while the funn are
  hidden would default to visible.
- **`startDraft` lifts the flag** — the group flag, and not the per-member
  switches. Drawing with the existing funn invisible is
  how you end up drawing the one you already have, and the group flag is the
  one a keystroke can set over everything at once; switching off one named row
  is a deliberate statement about a funn you have just looked at, so the pen
  does not undo it. The shape being drawn is
  never in the set to begin with: it is Excalidraw's, on a canvas above the map
  rather than on a layer in it.
- Not persisted to the URL, on the same grounds as the compare curtain: a link
  shared to show someone a funn must not arrive with the funn hidden.
- **The button is lit while the funn are *on the map*.** The eye lit while they
  were hidden at first, on the argument that the unusual state is the one
  worth a colour. That argument is right about which state needs marking and
  wrong about which colour marks it: on this ribbon accent means *engaged* —
  a tool armed, a ground selected, a popover open — so an accent-filled eye
  read as "the eye is on", the exact opposite of what it meant. Polarity beats
  emphasis, and the polarity survived the swap: hidden is the `Funn` button
  going dark, which is what every other layer switch on the row does.
- **The tooltip is the verb; the accessible name is the noun.** `ModeButton`
  sets `aria-pressed`, so naming the button after what a press *does* would
  announce "Skjul funn på kartet, pressed" — the failure the eye avoided by
  carrying no `aria-pressed` at all. A toggle whose tooltip flips therefore
  passes its stable noun as `ariaLabel` and lets the pressed state say the
  rest. That prop exists for `LayerGroup` and has no other caller.

**Switching one funn off is a style, not a layer.** The funn are a single
vector source, so `funnLayer.ts` keeps `switchedOffFunnIds` beside the pen's
`hiddenFunnId` and resolves both in one `styleFor(id)` — the invisible style
for either reason. Three things follow, and they are the reason the two are
separate states rather than one:

- **A resumed draft cannot clear your switches, and a switch cannot outlive the
  pen.** `hideFunnOnLayer(id)` still owns exactly one id and still means "the
  pen is on this one" (§8.5); `funnSwitchedOffAtom` owns the rest and is
  cleared when the lokalitet closes or swaps.
- **The halo is gated on the same predicate.** `funnHighlightLayer` clones
  geometry rather than reading the funn layer's styles, so a switched-off funn
  that happened to be selected would otherwise keep its halo — the one thing
  left on screen pointing at the shape you just took off it. It asks
  `isFunnOnMap(id)` and re-runs when the set changes.
- **The badge counts what is on the map** — the index, minus tombstones, minus
  whatever is switched off, and nothing at all while the group is off. That is
  a change of meaning with almost no change of number, since every funn is on
  unless you switched it off, so "is there anything in this rectangle" is still
  answered at a glance (§8.2).

`EyeSplit` remains a shared component in name only: `src/shell/EyeSplit.tsx`
holds the geometry, the hairline and the `joinedRight` contract with
`ModeButton` for its one caller, `Kulturminner` (§5.9). It was not folded back
into `HeritageControl` because the geometry and the polarity are the parts that
were hard to get right, and they read as rules in a component and as styling in
a call site.

**This used to be `Skjul merker`, on row 1, and it also hid the lokalitet
rectangles.** Two things were wrong with that. It was grouped beside
Sammenlign by an argument about comparing ground, and when Sammenlign left for
the lokalitet row the switch stayed behind — three rows away from the count of
what it hid. And it was global by an argument that had stopped being true: the
funn layer only ever holds the *open* lokalitet's funn, and a signed-out
visitor loads no rectangles at all, so for half the app it was a dead button.

The two halves went separate ways. The funn half became part of the button that
lists them — one visual object, two hit targets — and it is that rather than an
item inside the list because hiding the funn is what you do *while* dragging the
compare curtain, and that has to stay one press. Which half is which has since
reversed (above); what did not change is that it is one press from the row.

One property of the original arrangement *was* dropped, deliberately: the count
used to stay legible while the funn were hidden. It now goes out with them,
because the badge on a layer group answers "how much of this am I looking at"
rather than "is there anything here" — the second question belongs to `Bilder
▾` and to the rail. Opening the pulldown still answers both, and the state that
loses the number is one the user just pressed for.

The rectangles have no switch at all now. A lokalitet that is not the open one
draws faint instead — dashed, half-alpha casing and frame, its name chip at
45 % (`styleFor` in `localityLayer.ts`) — which answers the same complaint
without a control to find, and leaves the rectangle clickable, so opening a
neighbour is still a press on it. The open one keeps its full-strength frame
and corner brackets: it is the boundary of what you are working in, and it is
a frame rather than a fill, so it is not the thing in your way.

### 8.7 The attachment pipeline

Several producers converge on one sink, and that convergence is the part worth
preserving. Since the View/File split (§8.7.4) they converge in **two** places,
and which one a route takes is decided by its `kind`:

```
Views (extract | flyfoto | sketch | scene) — a row of parameters, stored as one:

  starterPack.ts           ─┐
  row 2 "Behold" (§8.9.2)   │
  the flyfoto grab          ┼─→ createAttachmentSpec()   — meta, no file
  "Behold skissen" (§9.3)   │             │
  "Oppsett" (§10.2)        ─┘             │
                                          │  afterwards, in the background:
                                          └─→ pinQueue.ts → renderSpec()
                                              → renderFigureBlob() (§8.10)
                                              → pinAttachment()

Files (screenshot | upload) — bytes, with nothing behind them:

  screenshot.ts            ─┐
  lidarExtract "Behold"     ┴─→ renderFigureBlob() → createAttachment()
  "Last opp"                 ──→ createAttachment()  — the one exception

Both land in `attachments`; the bottom edge sees them over realtime.
```

Every producer of bytes hands a **canvas**, not a blob, so the figure stage has
somewhere to draw a caption; only "Last opp" bypasses it (§8.10). The pin queue
is a producer like any other and goes through the same stage — a pinned View
and a File are the same kind of artifact once they exist.

`kind` is one of `extract | screenshot | upload | flyfoto | sketch | scene`;
terrain
renders reuse `extract` with the visualization recorded in `meta.style`, which
is why adding terrain analysis needed no migration. `meta` also carries source
key/label, `metresPerPx`, bbox, `imageRect` (§8.10), `renderedAt` (§8.7.4),
for flyfoto the `projectName` / `year` / `photoDate` that the strip captions
from ("Flyfoto 1937"), for a sketch the `frame` and the Excalidraw `scene`
itself — which is why `meta` is sized at 2 MB rather than the 10 kB the other
kinds need — and for a scene its layer order, their fades and the ground under
them (§10.2). Files are `protected` in PocketBase, so the strip fetches
short-lived file tokens for thumbnails — a new UI must keep doing that or every
thumbnail 403s.

Four more fields sit on the record and belong to the exhibit or to the
sketch rather than to the image: `sort` (int) and `hidden` (bool), which are
§8.7.3, and the two uncascaded relations `funn` (→ finds) and `over`
(→ attachments), neither of which means quite what it did. `funn` was "what a
sketch is about", seeded and uneditable (§9.3); since §13.10 step 9 it is
**which funn this bilde belongs to**, on every kind, with an editor on the card
and the pulldowns grouped by it (§10.3) — a widening that cost no migration,
because the column is the same. `over` is still which bilder a sketch is a
layer on, and on a scene the other sense the word already had: the bilder it is
an arrangement *of* (§10.2).

#### 8.7.1 The image on the map — and why it is not the rail's

**There is no lightbox.** A picture of a place you are currently looking at
does not raise the question a lightbox answers. What the app does instead is
put the image back on the map at the rectangle it is of, so the 1937 ortofoto
fades over today's hillshade with the funn drawn on top; in a lightbox it is a
picture of somewhere you are no longer looking. That argument is unchanged and
is the whole reason this section exists.

**What changed is who presses it.** Picking a frame in the filmstrip (§8.7.2)
used to *be* the gesture — **selecting was pinning** — and the map held one
image at a time, arbitrated against the live terrain render. The layer row
(`docs/lokalitet-view.md` §13) replaced all of that in two steps, and as of
§13.10 step 6 the rail has no ground verbs left at all:

| was, on the card | is, on the lokalitet row |
| --- | --- |
| picking a frame laid it down | picking a frame moves the cursor, and nothing else |
| `Vis i ruta` / `Ta av ruta`, one image | a switch per member in [Visning] and [Bilde] (§10.1), several down at once |
| `Transparens` on the rectangle's corner (§8.7.5) | a fade under each member's switch |
| `Gjenskap` on the card | the trailing verb on each View row (§10.1) |
| a note under the selected card when the pin would not load | `LayerMember.warning`, on the switch that is claiming the layer is up |

So the detail panel under the rail is now the record and nothing about the map:
badges and provenance line, the caption field (`readOnly` unless `canEdit`,
commits on blur), the sketch's own eye (§9.3 — it presses the same set [Skisse]
does, so the card and the row cannot disagree), `Åpne originalen`, and in edit
the curation verbs and `PinRetryButton` (§8.7.4). Step 7 added one more verb to
that panel and it does not reopen the question: `Plasser i ruta` (§8.7.2)
writes a rectangle onto the record, which is a curation verb with a geometry in
it, and what it produces is a row in [Bilde] rather than a layer on the map.
Step 8 added the other exception that proves the rule: `Legg ut igjen` on a
scene's card (§10.2) does not put *that* record on the ground — a scene is not
a layer and has no switch anywhere — it puts the whole row back the way the
record says it was. It is a read, so it is on the card in both stances. Step 9
added `Hører til`, the funn picker (§10.3), which is the same kind of verb as
`Plasser i ruta`: it writes a relation, shows and hides nothing, and what it
changes on the map is only the *order* the member is painted in, because the
pulldown it appears in is grouped by the answer.

Three consequences of the separation, each of which had been paid for
elsewhere:

- **The cursor and the map are independent.** `focusBilde` and `selectBilde`
  differ only in that a press toggles; neither touches the ground. The old rule
  changed what you were looking at as a side effect of reading a caption,
  refused silently on the cards it could not place, and could hold one image.
- **Folding the rail away costs nothing.** `Bilder` pressed shut used to put
  the pinned image down and remember it in a ref, because an overlay whose only
  control has been folded away is stranded. [Bilde] is on the row and stays
  there, so the fold is a fold: the cursor stays where it was.
- **`Bilder` stopped lighting.** It was `active` for "a bilde is on the ground",
  which is the only thing about it that changed what you were looking at. Four
  group labels now answer that about layers they own, so the button is the
  drawer it looks like — a badge, a disabled state on an empty lokalitet, and
  no light.

**The pixels.** Getting a record onto the ground is
`src/localities/groundView.ts` and its one hook, `useGroundView(key, rec)`,
with `src/shell/groundMembers.tsx` holding the two halves both ground groups
need identically — `GroundMember`, one mounted component per member that is on
the map, and `useLayerFailures`, which is how a switch learns that nothing
arrived. Shared rather than written twice because the *rules* are what is
shared: a member on the map is a component that is mounted, and a switch that
is on over a layer that never came has to say so.

- **It decodes the original file**, never a thumbnail, and hands it to
  `setGroundOverlay(key, …)` with `meta.bbox25833` as the extent and
  `meta.imageRect` as the crop. It has to be the original: `imageRect` is in
  the original file's own pixels and nothing records the figure's overall size,
  so a thumb cannot be scaled back to the ground without a guess, and a guess a
  pixel out is half a metre out on the map.
- **A View with no file is rendered instead** (`docs/lokalitet-view.md` §13.10
  step 2). `groundView.ts` dispatches a `ViewSpec` over the same four producers
  the pin queue uses and puts the raw canvas down at the spec's own rectangle —
  no figure, so no caption panel on the map. It is `renderSpec`'s sibling
  rather than `renderSpec` itself, precisely because that one makes the
  captioned artifact. A File has no such fallback, which is what `failed`
  means: a View whose upstream has nothing over this rectangle, or a File whose
  bytes will not decode.
- **Eligibility is checked in the list, not on the map.** `ws.viewItems` is
  `extract` or `flyfoto`; `ws.fileItems` is either File — `screenshot` or
  `upload` — with bytes and a `bbox25833`. A File needs both because it has
  nothing to produce from, and a View needs neither because it has. The one
  thing a list of switches must not contain is a switch that cannot do
  anything. An upload has no georeference of its own, so it is in `fileItems`
  only once `Plasser i ruta` (§8.7.2) has given it one — which the
  `bbox25833` test was already enforcing before the kind test widened.
- **There is no resolution ladder, and that is measured rather than assumed.**
  `docs/lokalitet-view.md` §13.2 argues for live rendering from sharpness — a
  pasted figure is a fixed number of pixels, so zooming stops helping. It does
  not hold here: `renderFigureBlob` fits a figure to 40 Mpx (§8.10) and a
  lokalitet is 50–1500 m per side (§5.6), so 1500 m of LiDAR at its native
  0.25 m/px is 36 Mpx and a terrain render is capped at 3000 px per side long
  before that. **A pinned figure is already the source's own pixels.** The one
  exception is a flyfoto over the largest rectangles — 1500 m at NiB's 0.2 m
  target is 56 Mpx, fitted to 0.237 — and re-stitching a whole acquisition to
  recover 18 % is not a trade worth making on a zoom notch. Adding one later
  means measuring again, not citing §13.2.
- **The shared group.** Every member paints into the same `zIndex: 1` overlay
  as the live terrain render, and since `docs/lokalitet-view.md` §13 that
  overlay is a **stack**: the render at the bottom, [Visning]'s Views over it,
  [Bilde]'s Files over those. A 1937 ortofoto faded over today's relief is the
  ordinary case, and the arbiter that used to make two of them take turns is
  gone (§10, §15).
- **A member whose record leaves needs no sweep.** `viewItems` and `fileItems`
  apply the same filters `bilderItems` does, so a deleted or concealed record
  leaves the pulldown, its `GroundMember` unmounts and the pixels go with it.
  The id left in the `shown` set lists nowhere and is emptied when the
  lokalitet closes or swaps.

**Gjenskap** puts the *map* back the way it was when the image was made, and is
the primitive `docs/lokalitet-view.md` §4.2 asks for rather than a button:
`src/localities/viewSpec.ts` reads a record's `meta` into a `ViewSpec`
(`lidar` | `terrain` | `flyfoto`) purely, `recreateViewAtom` carries it, and
`useRecreateView` — mounted in `RibbonGlobalRow`, the one place the four
control hooks live — applies it. Two later builds are written on that split:
a View is stored as a spec before it is pixels (§8.7.4), and a forked lokalitet
carries its original's views without its files (§8.12).

- **`Gjenskap` does not render.** It moves the map, and that is all it has ever
  done — which matters more now that a View may have no pixels at all.
  `docs/lokalitet-view.md` §4.2 reads as though `Vis i ruta` on an unpinned View
  *is* `Gjenskap`, i.e. that walking onto a spec should recreate it. The
  machinery to render one now exists, so what kept the two apart was never
  capability: it is that switching a View on is a Kartverket fetch and a render,
  which is a deliberate press in a pulldown and not something a rail should do
  per card as you walk it. Since step 5 the rail does not list Views at all, so
  the question is [Visning]'s.
- **Absent, not disabled** — the rule `Gjenskap` was built on, and it survives
  its move: a screenshot or an upload yields `null` from `viewSpecOf`, and
  rather than a dead button it simply has no row in [Visning] to hang one on.
  When a spec exists but the dataset behind it does not any more — a LiDAR
  project withdrawn from the WMS catalogue, an acquisition no longer listed for
  the bbox — the attempt toasts and leaves the map alone.
- **Restoring a terrain view is a method on the hook**
  (`useTerrainAnalysis.restoreView`), not six setter calls from outside,
  because the radius setter routes to one of two stored radii according to the
  *current* visualization — which a caller cannot see until the next render.
- **← / → walk the images again.** The lightbox's arrow keys came back with the
  filmstrip, on the terms in §8.7.2.

#### 8.7.2 The bottom edge — one rail, two stances

`docs/lokalitet-view.md` §4.3. The images are the lokalitet's content, not a
panel about it, so they sit **along the bottom of the map** rather than in a
column beside it: a rail is the shape of "walk a curated sequence", and a
sequence read left to right does not move the ground under it the way a
scrolling grid in a 360 px column does.

**The slot has two occupants, one per stance**, and which one is mounted is
decided in `LocalityRibbon` (`ws.canEdit ? BilderCarousel : BilderStrip`)
rather than by branches inside one component. A third surface, `BilderPicker`,
**borrows** the slot for the length of a picker run (§8.9.3) rather than being
a co-occupant of it — one surface at a time is the whole rule, and a run is
transient by construction:

| | show — `BilderStrip.tsx` | edit — `BilderCarousel.tsx` |
|---|---|---|
| shape | a rail of 88×64 frames, a detail line under it | the same |
| hidden records | absent | present, dashed and marked |
| caption | `readOnly` (§8.1) | editable, committed on blur |
| the map | nothing — picking a frame moves the cursor (§13.10 step 6) | the same |
| order | none | drag a frame along the rail, or `arrow_back` / `arrow_forward` in the detail row |
| conceal, delete | absent | in the detail row |
| place an upload (§13.5) | absent | in the detail row, uploads only |
| which funn it belongs to (§13.6) | a badge on the detail line | the badge, plus `Hører til ▾` in the detail row |
| both | Åpne originalen, ← / →, `bottom_panel_close` | |

**Edit used to be one large card at a time**, on the argument that judging a
caption off an 88×64 thumbnail is judging it blind. That is true of looking at
one image and false of arranging a set: curating an exhibit is mostly deciding
what follows what, and a reorder you cannot watch happen is a reorder you have
to go and verify. So both stances are the rail, `BilderRail` in
`bilderCommon.tsx` renders it for both, and the big look at one picture is the
image's own switch on the layer row — in [Bilde] for a File, [Visning] for a
View (§10.1) — which lays it on the ground it is of, at full size, which the
180 px letterbox never was; failing that, `Åpne originalen`.

Three things that read as arbitrary until you try the alternative:

- **The write verbs are absent from the rail, not disabled on it.** That is §2
  of the lokalitet-view doc, and it is the reason the two surfaces are still
  two files even though they now look alike. A single component with
  `canEdit &&` scattered through it is how a greyed-out delete button ends up
  on a stranger's lokalitet — and the shared geometry does not weaken that,
  because what the two files hold is the verb row, not the layout.
- **Walking the rail does not touch the map, in either stance** (§8.7.1). It
  did in both until `docs/lokalitet-view.md` §13.10 step 6, and the two verbs
  it carried are [Bilde]'s pulldown now. `focusBilde` and `selectBilde` are
  what is left, and they differ only in that a press toggles.
- **`Plasser i ruta` is on the card, and it is not a map verb.** The rule step
  6 left behind is *do not add a map verb back to a card*, and the upload
  opt-in (`docs/lokalitet-view.md` §13.5, §13.10 step 7) does not break it:
  pressing it shows nothing and hides nothing, it writes `meta.bbox25833` —
  an edit of the same kind as a caption or a concealment, which is why it sits
  with those and is buffered into the transaction like those. What it buys is a
  *switch*, and the switch is [Bilde]'s (§10.1). The undo,
  `Fjern plasseringen`, deletes the key and the member with it. `canEdit`
  rather than `canAdd`: it is an update, so an admin may place one.
  `PlaceUploadButton` in `bilderCommon.tsx` is absent on every other kind —
  they all already know where they are, and offering to invent a rectangle for
  an extract that was cut to one is offering to make it worse.
- **`Hører til ▾` is on the card for the same reason, and it is the first verb
  in the row.** Filing an image under a funn (§10.3) is what decides where the
  card *sits* — a chip on its badges line, and a heading in [Bilde] or
  [Skisse] — so it leads the verbs rather than sitting among the curation
  arrows. `BildeFunnPicker` is absent on a lokalitet with no funn, because
  "belongs to the lokalitet" is then the only answer there is. In show the
  answer is still visible, as the badge: it is part of what the exhibit says.
- **Only edit passes `onReorder`.** `BilderRail` takes it as an optional prop
  and `BilderStrip` omits it, so drag is not a thing show has and suppresses —
  the hook is never armed there at all.

The shared vocabulary — the tokened-URL dance, the meta line, the caption
field, the pin face (§8.7.4), the provenance line
(`metaLineOf`, which [Visning]'s rows read too, so the card and the pulldown
cannot disagree about what an image is) and Åpne originalen —
is `src/localities/bilderCommon.tsx`, and since the two stances are one shape
the geometry is shared too: `bilderCommon.module.css` owns the whole bottom
edge, and neither surface has a stylesheet of its own.

- **The slot.** `bottomSlotAtom` (`src/shell/bottomSlot.ts`) publishes an
  element the shell owns and the ribbon portals into: the surface belongs to
  the shell, the controller behind it is mounted exactly once from the ribbon,
  and the two are on opposite sides of the tree.
- **It is a flex child of `.overlay`, after `.row`**, exactly like `.ribbon`
  before it — not an absolutely positioned bar. In flow, the slot's own height
  shortens `.row`, so the left and right slots end where the strip begins with
  no media query and no z-index fight; floated, every card in those slots
  would have had to be told how tall this one is.
- **`data-chrome="bottom"`.** The strip declares its edge like every other
  surface and `chromeInsets` measures it on demand (§3.1); folding it away
  makes it a zero-size element, which the measurement already skips.
- **One occupant, deepest first.** Three surfaces want this slot — a picker run
  (§8.9.3), the edit carousel, the filmstrip — and exactly one gets it, chosen
  by depth in `LocalityRibbon` rather than by the slot. There used to be a
  fourth, `FunnDrawBar`, and **drawing yielded the images**; Excalidraw carries
  its own toolbar on the canvas (§9), so the pen no longer asks for the bottom
  edge and the rule lost its deepest case. Enforcing what is left at the portal
  is what keeps it readable as two lines of boolean in one file instead of
  three components each guessing about the other two.
- **Selecting points the rail, and that is all it does** (§8.7.1). The rail is
  `Frame`s at 88×64 with a kind mark; the selected one carries a ring and
  scrolls itself into view, which is what makes a keyboard step legible.
- **A sketch's frame is the one that carries an eye** rather than a ring.
  A sketch is transparent (§9.3) and lives in its own group at `zIndex: 2`, so
  any number can be up at once; pressing the eye adds or removes the id from
  `sketchShownAtom`, which is the same set [Skisse] presses. It used to be the
  one card that did not pin, and is now the only card with a map verb on it at
  all — the other kinds' verbs went to the row, and the one that arrived after
  them, `Plasser i ruta`, is a record edit rather than a map verb.
- **Edit selects for you, without pinning.** Show is legible with nothing
  active; edit is entered in order to change something, and a surface that
  opens with no subject makes you pick one before you can. So `BilderCarousel`
  lands on the first image whenever nothing is active — on arrival, and again
  after the selected record is deleted. Through `focusBilde`, so the ground
  stays whatever the user last put there; the press-to-pin rule is about
  presses.
- **← / →** are bound only while `stripOpen && !draftActive` and there is more
  than one image, so OpenLayers' `KeyboardPan` keeps horizontal panning
  whenever walking the strip would be meaningless.
- **`bilderStripOpenAtom`** (`toolAtoms.ts`) is module-level: this fold takes
  a slice of the map's *height*, so it is a gesture made in order to see the ground, and having the
  next lokalitet undo it would be worse than having no fold at all. It starts
  **open**, unlike a tool.
- **Two controls put it back**, and they are the same atom: the row's
  `Bilder ▾` (§8.1, the read tools — present in both stances) and the strip's
  own `bottom_panel_close`. The row's toggle carries the count and is disabled
  when `hasBilder` is false.
- **Folding it does nothing to the map, and that is new.** Folding used to put
  the pinned image down and clear the selection, and unfolding used to put both
  back from a ref across the fold — `Bilder` as one gesture with two halves.
  `docs/lokalitet-view.md` §13.10 step 6 deleted the whole mechanism, because
  the whole of it was the hook undoing something it was doing to itself. The
  reason it existed was real: `Bilder` could be pressed shut with a 1937
  ortofoto still over the hillshade and nothing left on screen that named it or
  could take it off. That cannot happen now — what is on the ground is
  [Bilde]'s pulldown, which is on the lokalitet row and stays there whatever
  the bottom edge does — so there is nothing to drop, nothing to remember and
  nothing to give back. The cursor stays where it was and unfolding shows the
  same card selected.
- **The row's `Bilder` is no longer lit at all**, and that goes with the same
  deletion. It used to light for "a bilde is on the ground" rather than "the
  rail is open", on the argument that the rail starting open would otherwise
  put an engaged-looking button on every lokalitet you walked into while the
  map underneath was untouched. Four group labels on the layer row answer that
  question better than one light on a drawer could: each says which of its own
  members are down, and the count is on the badge. So the button is a plain
  toggle for the bottom edge with the image count on it, and whether the rail
  is open needs no light of its own — it is a bar across the bottom of the
  screen.
- **`hasBilder` is published by the hook**, not recomputed per surface —
  `bilderCount > 0 || starterBusy || canAdd` — so the row's toggle and
  the portal cannot disagree about whether there is a strip. A reader on an
  empty lokalitet gets no bar at all; an owner in edit gets the bar with the
  empty prompt in it.
- **Neither surface has an add-tile.** Every route in is on the lokalitet row
  — `Behold` (§8.9), the two pickers, Skjermbilde and the `⋮` upload — so the
  bottom edge is only ever about images that already exist.

#### 8.7.3 Curation — exhibit order, concealment, and the derived cover

`docs/lokalitet-view.md` §4.4. A lokalitet's images accumulate in the order the
work happened, which is rarely the order that explains the site. Two fields fix
that, and neither of them is a cover field.

- **`attachments.sort` is an opaque ordering key, not an index.** Newly created
  records get `Date.now()`, minted inside `createAttachment` itself
  (`src/api/attachments.ts`), and that is the whole reason it is opaque: two of
  the producers — `Behold`, and the pickers' keep — never hold the
  attachment list, so "one more than the largest" is not a number they can
  reach. "Later than everything that already exists" is a number a clock knows.
  The list query is `sort: 'sort,created'`; `created` is what makes the order
  *total*, and without it PocketBase may return two equal-`sort` rows either
  way round — a rail that reshuffles on every realtime event.
- **A move costs one PATCH.** `reorderBilde` writes the moved record a value
  *between* its two new neighbours and leaves every other record alone — into
  the draft since §8.11, and out to PocketBase as one PATCH at `Lagre`. This is
  not micro-optimisation: `useLocalityContent` reloads the whole list on every
  realtime event, so renumbering forty records to move one card would be forty
  reloads of forty records. The fallback, when there is no integer left between
  the neighbours, is a full renumber to multiples of `SORT_STEP` (1000) — and
  it is reached in exactly two situations, neighbours one apart and the first
  move on a lokalitet whose records all predate the field and so all carry `0`.
  Both self-heal.
- **The renumber values stay far below any clock reading**, deliberately. That
  is what keeps an image created *after* a hand-arranged exhibit landing at the
  end of it rather than in the middle.
- **Existing lokaliteter changed order** when this landed: the list was
  `-created` (newest first) and is now the exhibit (oldest first), because
  every pre-existing record carries `sort = 0` and the tie breaks on `created`.
  Nothing is lost, but a lokalitet somebody knew looks reversed until they move
  something.
- **`attachments.hidden` is "keep it, do not show it".** The alternative is
  deleting your working renders to make the exhibit tidy, and the seven
  renders you rejected are the evidence that you checked. Hidden records are
  filtered out of the filmstrip and are *in the carousel*, dashed and faded —
  a curation control whose effect you cannot see is not one.
- **That makes positions stance-dependent, so ordering never uses them.**
  `bilderItems` (what the bottom edge walks) is the filtered list; every
  ordering call indexes into the hook's unfiltered `attachmentItems`. In edit —
  the only stance that can reorder — the two lists are the same array, so the
  rail may hand `reorderBilde` its own index; in show they are not, and an
  exhibit order that depended on who was looking would not be an order.
- **The cover is not a field.** It is `coverBildeId` — the first non-hidden
  record in exhibit order — computed where it is needed, on the same argument
  as the centre coordinate (§8.3): a stored `cover` relation and a `sort`
  column can disagree, and then the exhibit has two first images. Moving a
  card to the front is the only way to make it the cover; there is no verb.
- **§4.6's terrain seed is a second derivation, not the same one.** Entering
  Terreng over a lokalitet seeds from the first non-hidden record in exhibit
  order *that is a terrain View* (`coverTerrainSpec`), because the cover is
  usually the extract and a lokalitet whose first image is a flyfoto still has
  knobs worth seeding from. Curation moves it exactly the way it moves the
  cover, which is the property that matters; the doc's phrase "the cover
  terrain render" reads as one derivation and is two.
- **A move is dragged or stepped, and the arrows are not the fallback.**
  `docs/lokalitet-view.md` §4.4 asks for drag-to-reorder on the rail; that read
  as impossible while the rail was show's occupant only, since §2 of the same
  doc says nothing in show writes. Now that edit is a rail too (§8.7.2) the
  conflict is gone: `useRailReorder.ts` drags a frame to its place, and
  `arrow_back` / `arrow_forward` in the detail row make the same move for the
  keyboard and for touch. Both stay, because HTML5-style drag is neither
  keyboard- nor touch-operable and the exhibit order is content.
- **The drag is Pointer Events with capture, and it excludes touch.**
  `pointerType === 'touch'` returns immediately, because on a horizontally
  scrolling rail the horizontal drag gesture already belongs to scrolling and
  a `touch-action` that took it away would cost more than it bought. Movement
  arms only past a 4 px threshold, so a press that turns out to be a click
  still selects; `setPointerCapture` on the frame is what makes the rest of the
  gesture arrive without window listeners, and it is released in both `up` and
  `cancel`. `Esc` cancels a live drag, captured and with `stopPropagation`, so
  it does not also close the lokalitet.
- **The insert mark lives inside the frame, at its edge.** `.frame` is
  `overflow: hidden`, so a marker drawn in the gap between two frames would be
  clipped by both; the rail instead marks the frame the drop lands before or
  after, `data-side="left|right"`.
- **The drop index is computed in *rest* space** — the list with the dragged
  record already taken out — which is exactly the set of frames still on
  screen during the drag, and exactly what `reorderBilde` expects. That
  correspondence is why the computation needs no off-by-one anywhere; the
  frames the pointer is being compared against *are* the gap list.
- **The borrowed tail is not part of the exhibit** (§8.12), so it does not
  drag and it does not count. `reorderBilde` clamps into the own-records
  range regardless, which is why `arrow_forward` disables on `ownCount - 1`
  rather than on the length of the rail: counting the whole rail leaves the
  last one enabled on a move that would then be refused.

#### 8.7.4 The View/File split, and the pin queue

`docs/lokalitet-view.md` §4.1.1, §4.1.2. **The record is the spec. The file is
a pin on it.**

Half the images in a lokalitet are not really images. A LiDAR extract, a
terrain render and a flyfoto grab are each a short row of *parameters* —
dataset, style, model, knobs, rectangle — and the pixels are what you get when
you hand those parameters to a service. A screenshot and an upload are the
opposite: bytes, with nothing behind them that could make the bytes again.
That is the whole split, and it is **derivable from `kind`**: `extract`,
`flyfoto`, `sketch` and `scene` are Views, `screenshot` and `upload` are Files.
There is no `spec` field and no `isView` field, deliberately — a flag that can
disagree with `kind` is a flag that eventually will.

A sketch (§9.3) is the odd one and belongs on the View side anyway. Its
parameters are not a dataset and a set of knobs — they are a frame and the
elements the user drew — but everything the split is *for* holds: the row is a
few kilobytes rather than a few megabytes, so it buffers in the draft and is
carried by a fork; the pixels are made afterwards by the same queue; and asking
for them again gives back the same drawing at today's resolution instead of the
one it was saved at. What it does not get is `Gjenskap`: there is no view of the
map to go back to, because the figure holds no ground.

A scene (§10.2) stretches the same argument one step further: its parameters
are *other records*, so it is reproducible exactly as far as its members are,
and its pin is a flatten of them rather than a render of a service. That is
the honest depth for something whose whole content is a statement about other
records — and it is what §13.2's rule buys, since a member is a spec or a
File and never "this View, but as its pixels".

A View therefore has three states, and `attachments.file` being optional
(migration `1700000500`) is what allows the first of them:

| state | on the record | what the surfaces show |
|---|---|---|
| **spec** | `meta`, no `file` | the pin face (below) |
| **pinned** | `meta` + `file` + `meta.renderedAt` | the image |
| **stale** | pinned, but the parameters have moved on | (not built — §13 of the design doc) |

Why pin at all, when the parameters can make the pixels again: Kartverket
re-flies projects and withdraws acquisitions from the catalogue, so the same
spec asked twice, a year apart, is not guaranteed to answer the same picture.
The pin is **not a cache** — it is the citable artifact, and `meta.renderedAt`
records when the pixels were made so a figure in a report can be dated. What
the split buys is that keeping an image is now one small `create` instead of a
multi-second fetch-stitch-caption-upload, which is what makes the draft
bufferable (§8.1), a fork cheap, and the picker carousels affordable.

- **`src/localities/pinQueue.ts`** is the renderer, and it is module-level,
  imperative and React-free — same shape and the same reason as
  `map/groundOverlay.ts`. It has to **outlive the surface that started it**:
  closing the lokalitet, folding the bottom edge or navigating to another
  record must not orphan a render that is halfway through fetching tiles. A
  hook would tie its lifetime to a component's.
- **One job at a time.** `drain()` is a single sequential worker. A LiDAR
  stitch is a burst of tile requests against the shared Kartverket edge and
  three of them at once is how the rate limit is found; the starter set enqueues
  three specs in a few milliseconds and they render one after another.
- **The queue renders the *spec's* rectangle, not the lokalitet's.**
  `rectangleOf` reads `meta.bbox25833` off the record and transforms it back to
  4326, falling back to the job's rectangle only when the record has none. The
  design doc does not say which, and it matters: "Juster området" can move the
  lokalitet between the moment a spec is written and the moment it drains, and
  the alternative is a picture of ground the author never asked to keep, under
  a caption naming the extent they did.
- **One writer per field.** The spec writes only what identifies it
  (`sourceKey`, `sourceLabel`, `style`, `model`, `bbox25833`, the terrain
  knobs); the pinner writes `metresPerPx`, `imageRect` and `renderedAt` in the
  same `pinAttachment` PATCH, because none of the three are knowable until the
  pixels exist. Terrain's *effective* SVF radius is written back here too — it
  is clamped against the DEM inside `renderTerrain` (§10), so the number the
  slider said and the number the render used are routinely different.
- **Three end states, and only one of them is a bug.** `empty` means the source
  has nothing over this rectangle — a real answer, and asking again would be
  asking to re-learn it. `failed` means the render threw. Success deletes the
  entry entirely, because the record now has a file and that is the state.
- **Nothing in the path may wait forever** (`src/shared/utils/deadline.ts`).
  `fetch` has no timeout of its own, and a connection that is accepted and then
  goes quiet never rejects — so no retry loop here notices it, because every
  one of them is driven by rejections. With one worker that is not one image
  lost: `drain()` parks on the `await` and every job behind it stays `queued`
  until the page is reloaded, with a spinner on each. Two ceilings answer it.
  `fetchWithin` bounds a single request *including its body read* — `fetch`
  resolves on the headers, so a deadline that ends there would leave the
  multi-megabyte half unbounded — which turns a stalled socket back into the
  transient error the retry loops already handle. `withDeadline` bounds a whole
  render (5 minutes) and the upload that follows it (the same), and it is
  applied around `renderSpec` rather than inside `runJob` so the picker, which
  renders specs with no record behind them, is covered by the same clock: a
  card stuck on `fetching` is the same bug as a card stuck on a spinner.
  Expiry is an ordinary failure, which is the honest state for "we do not
  know, ask again".
- **"Nothing came back" is not "nothing is there."** Now that a tile can be
  given up on for taking too long, that distinction decides whether a card
  offers a retry at all — `empty` is the state that says asking again is
  pointless. So `extractCanvas`, `fetchFlyfoto` and `fetchDem` each return
  `null` only when nothing painted *and* nothing failed, and throw when every
  request errored. A network blip would otherwise have permanently retired
  three starter images as "no coverage here".
- **The UI reads the queue through `useSyncExternalStore`** (`usePinState` in
  `bilderCommon.tsx`) rather than through jotai: the queue is not React state
  and the subscription is per record id.
- **A quiet per-card state, not a blocking spinner** — `docs/lokalitet-view.md`
  §5.6. `PinFace` fills the frame the picture would have filled, so the rail
  never reflows when pixels land, and says one of five sentences: not written
  down yet, being made, not asked for, nothing there, went wrong. Only the last
  gets a verb (`PinRetryButton`).
- **The queue does not run during a transaction, and cannot.** A View kept in
  edit is buffered as a spec under a `draft:` id (§8.11), so there is no record
  for the queue to PATCH — `usePinFace` reads the id rather than the queue for
  those and says *"Hentes når du lagrer"*, and `OpenOriginalButton`'s
  force-pin is absent on them for the same reason. `Lagre` creates the rows and
  enqueues every one it got back, in that order, so the pixels start arriving a
  moment later — in the session that asked for them, since `Lagre` no longer
  ends it (§8.11). The sweep skips `draft:` ids too. The starter set is the one
  View that is never buffered and therefore the one that pins mid-session
  without a commit first (§8.9.1).
- **A pinned record has to be handed back, because realtime is off.** `PinJob`
  carries an optional `onPinned(rec)`, called with the PATCHed record the
  moment it lands. The queue otherwise just forgets the job and lets a realtime
  event refresh the list — but every pin happens in edit by construction (a pin
  is an `update`, and `canAdd` means the edit stance), and edit is exactly when
  both subscriptions are held back. Without the callback the card stays on its
  pin face until the session ends. It is a callback rather than a store the UI
  subscribes to because the queue already has one of those for *states*, and
  the record is not a state.
- **Who may pin.** A pin is an `update`, and §2 says nothing in show writes —
  so the sweep that materialises unpinned specs on an open lokalitet is gated
  on `canAdd` (owner *and* edit stance), and so are both pin buttons. A reader
  over somebody else's spec sees "not fetched yet", which is true; an owner
  materialises it by pressing `Rediger`. The sweep also checks
  `pinAttempted(id)`, so a spec that came back `empty` is not retried on every
  realtime reload.
- **`Åpne originalen` forces a pin, in two presses.** There is no such thing as
  downloading a row of parameters, so an unpinned View has to be rendered
  first — and `window.open` several seconds after the click that caused it is a
  popup and gets blocked. So the button reads `Hent bildet`, spins, and becomes
  `Åpne originalen`; the second press is inside a gesture. `pinNow` jumps the
  queue and is awaitable for exactly this. Rapportpakke (§9 of the design doc)
  will force pins the same way when it is built.
- **A picker keep writes a File-shaped `create`, not a spec.** Same reasoning
  the deleted extract viewer's own `Behold` had, and the same exception:
  a picker card is holding rendered pixels already, so asking the queue for a
  second render of the same parameters would throw them away and re-fetch them.
  `renderSpec` is exported from `pinQueue.ts` for exactly that (§8.9.3); the
  record still carries the full `meta` and a `renderedAt`, so it is a pinned
  View from the moment it exists rather than a File.
- **Closing a lokalitet no longer cancels a running grunnpakke.** The old
  `AbortController` was aborted by the workspace's unmount cleanup; there is
  nothing slow left in the write path to abort, and the queue is deliberately
  outside the component lifetime. Progress on the bottom edge is a plain
  `starterBusy` boolean now — `starterStep`'s "Henter helning_prosent …" stopped
  describing anything the moment the set stopped fetching.

#### 8.7.5 Transparens — twice moved, and now on the switch

The fade for an image on the ground has had three homes, and the third is the
one the other two were reaching for.

It started as `FadeControl` in the detail row of both bottom-edge surfaces,
which was wrong on two counts. **It belonged to the selection, and the
selection is not the image** — the slider rendered only while the card you had
picked was also the card on the ground, so reading a second caption silently
took the fade away from an image that was still up. And **it was at the bottom
of the screen while its effect was in the middle**: fading a 1937 ortofoto off
today's hillshade is a comparison, and a comparison is watched at the thing
being compared.

So it became `BildeTransparency`, an `ol/Overlay` on the lokalitet rectangle's
top-right corner, opposite the name chip. That fixed the second complaint and
only narrowed the first: it was still *one* slider, because the ground was
still one slot.

`docs/lokalitet-view.md` §13.10 step 6 deleted it. The ground is a stack whose
members each carry their own alpha, so the fade is a slider under each member's
switch in [Visning] and [Bilde] (§10.1) — as many as there are layers, each
beside the thing it names, appearing only while that member is on. The map
still holds opacity and the surfaces still print transparency, `100 -` it; the
terrain strip says the same thing the same way. What is left of this section is
the argument, because it is the reason the row's member rows look the way they
do.

Two rules survived the move intact:

- **Opacity is a raster idea.** A vector member gets a switch and nothing else,
  and so does [Visning]'s ground preset — the background is a *stack* of tile
  layers, so one slider there would be three fades, and the two grounds that
  can be faded have that control where all their other modifiers are, on the
  settings strip.
- **A member's fade outlives the member.** `opacityByKey` in
  `map/groundOverlay.ts` is never pruned, so switching a layer off and on again
  finds the fade you left it at.

### 8.8 The flyfoto selection dialog

`Hent ▾ → Flyfoto` → licensing notice dialog → a dialog listing the seamless
best mosaic plus every ortofoto acquisition intersecting the bbox (label = year,
subtitle = photo date + project name). Every row is a **checkbox** and the
footer runs a picker carousel over what is ticked (§8.9.3); `NIB_MOSAIC_KEY`
stands for the mosaic row, which is not a project and has no id of its own.

`FLYFOTO_BATCH_MAX` (8) caps the tick count, and what it bounds has changed:
it used to bound *traffic*, because "Hent alle" fetched and saved every checked
acquisition back to back. The picker fetches one card ahead of the cursor, so
the cap now bounds the **judging** — eight is about as many photographs of one
rectangle as anyone triages in a sitting, and a run of forty is a run nobody
finishes. It is enforced on the way in (further boxes disable) rather than by
silently truncating the run.

The licensing notice gates *every* grab, by product decision, not by accident:
NiB imagery is free for private non-commercial use and publishing is the user's
responsibility, so the notice is the point at which that is communicated. Do not
add a "don't show this again" checkbox without thinking about it.

### 8.9 The four routes an image takes in

`docs/lokalitet-view.md` §4.3. Every one of them is on the lokalitet row, and
none of them is on the bottom edge (§8.7.2).

| Route | What it is |
|---|---|
| the starter set | three readings of the best laser dataset, run without being asked on a lokalitet you just made |
| `Behold` | whatever ground is on screen, kept at the source's own resolution |
| the two pickers | LiDAR-uttrekk and Flyfoto, behind `Hent ▾` — propose a batch of *different* datasets and keep or discard each one (§8.9.3) |
| Skjermbilde and Last opp | pixels, with no view behind them |

**`Oppsett` (§10.2) is deliberately not a fifth row.** It keeps the
*arrangement* of what these four produced rather than another reading of the
ground, and its pixels are a flatten of records that are already here — so it
brings nothing in. It sits beside `Behold` on the row because that is where the
write verbs are, not because it is one of these.

#### 8.9.1 The starter set (grunnpakke)

**It is no longer a menu item.** It runs itself once, on a lokalitet that was
just created — `Opprett` at the end of a placement session, whether that session
was started by the `Ny lokalitet` button or by pressing Terreng with nothing
open, which is the same code path (§5.3, §5.6). Its three images therefore land
over ground the author framed on purpose, which is most of the argument for
placing before creating.
The hand-off is `pendingStarterLocalityIdAtom` (`src/localities/atoms.ts`),
set at creation and cleared by the workspace *before* the run
starts, since the effect re-fires on every image it lands. Deliberately not
"notice the gallery is empty": that would refill a lokalitet somebody
deliberately emptied.

The three images are the ones you would otherwise fetch by hand before starting
to read a rectangle: **the laser, read three ways** —
`skyggerelieff` (the fixed north-west hillshade), `multiskyggerelieff` (every
direction at once, so nothing hides along the sun) and `helning_prosent`
(slope, which shows edges the light misses). All three are Kartverket's own
pre-baked renders of **one** acquisition, saved as the `extract` kind with the
style in `meta.style` (§8.7), so there is no migration.

Since the View/File split (§8.7.4) the pack **writes three specs and returns**.
`planStarterPack` resolves the dataset and the style list; `runStarterPack` in
`useLocalityWorkspace` makes the three `createAttachmentSpec` calls and the
three `enqueuePin`s. `STARTER_STYLES` *is* `TIER_A_STYLES`
(`lidarProjects.ts`) — one list, so the pack and the style ring can never
drift apart.

**Those three writes go straight to PocketBase, not into the draft buffer** —
the one View in the app that does (§8.11). It shares its `meta` block and its
caption with `saveExtractSpec`, which is what `Behold` over the LiDAR ground
calls, but not its destination. Buffered, the pack produced three `draft:`
rows the pin queue will not touch — the queue only ever renders records that
exist on the server — so a brand-new lokalitet opened on three blank frames
that could not be filled short of pressing `Lagre`, which is a strange first
thing to ask of someone who has not typed the name yet. Written through, the
rail fills with pixels while they are still typing. The justification is that
`Opprett` already wrote the lokalitet straight through: the starter set is the
rest of that same act of creation, and `Avbryt` does not take it back for the
same reason it does not un-create the record. Two consequences worth naming:
the pack's records are appended to `attachmentItems` by hand, since realtime
is paused for the session it lands in; and each pin calls back through
`PinJob.onPinned` to swap the pinned record into that list, because nothing
else would — the queue otherwise just drops what it pinned, trusting a
realtime event that is being held back.

Load-bearing choices:

- **The dataset is resolved once, by `planStarterPack`.** Three images cost one
  catalogue lookup and are guaranteed to be three readings of the *same*
  acquisition — which is the only thing that makes flipping between them mean
  anything. `bestLidarSource` takes the first per-project source
  `enumerateLidarSources` returns, or the national mosaic when none covers the
  rectangle.
- **The national mosaic publishes only `skyggerelieff`,** so the plan filters
  `STARTER_STYLES` against `source.styles` and the pack is one image there, not
  three. That filter is not defensive: asking the mosaic for a per-project style
  answers HTTP 200 with `Content-Type: image/png` and a ~100-byte JSON error
  body, which the browser decodes as a broken image. A dataset publishing none
  of the three falls back to its own first style.
- **No flyfoto step and no terrain step.** The pack is one service and one fetch
  path. Ortofoto brought NiB's licensing notice into a press that is otherwise
  all Kartverket — nobody should be asked to accept NiB's terms who has not
  asked for a photograph — and the terrain render brought a second, much slower
  upstream and a set of parameters the user never chose. Both are one press away
  by hand. `docs/lokalitet-view.md` §4.3 is the full argument.
- **Each style is independently fallible.** Failures are counted, not thrown,
  and the toast says how many of the planned images arrived. Since the split
  that count is of *specs written*, not pictures — a style whose render comes
  back empty says so on its own card afterwards (§8.7.4). Nought of three is
  the one case with an error toast of its own: there is no card to say it on.
- **No longer cancellable, and no longer wants to be.** It used to hold an
  `AbortController` aborted by the workspace's unmount cleanup, so that closing
  a lokalitet stopped spending tile requests on it. Three small `create`s have
  nothing worth aborting, and the pin queue that follows them is deliberately
  outside the component lifetime (§8.7.4).
- **Progress renders on the bottom edge**, as one line with a spinner
  (`starterBusy`), above the rail in both stances; the edge
  unfolds itself when a pack starts, and `hasBilder` counts a running pack, so
  the bar is there before the first card is. It is now about a second rather
  than the old several minutes — what has to be seen arriving is the three
  cards, which then fill in.

#### 8.9.2 `Behold` — keep the ground on screen

The general answer to "how do I add an image": dial the ground up the way you
want it, then press one button. What comes out is the rectangle *in that
ground* at the source's native resolution, not a photograph of the screen.
`src/localities/behold.ts` holds the table and the guard.

| Ground | What it writes |
|---|---|
| 2 LiDAR | a spec naming the active dataset, style and model |
| 5 Terreng | a spec of the current visualization and knobs |
| 4 Flyfoto | a spec naming the active acquisition (raises the NiB notice first) |
| 1 Standard, 3 Hybrid | nothing — disabled, tooltip says `Skjermbilde` |

All three arms are Views, so all three are **specs** now (§8.7.4) and the press
is one small `create` rather than a multi-second fetch. That is the point of
doing the split before the pickers: `Behold` is the verb people press dozens of
times in a session.

- **The last row is a refusal, not an omission.** There is no rectangle-fetch
  path for the topo WMS, and Hybrid's overlay is a separate layer the extract
  path cannot see — a `Behold` there would hand back a plain LiDAR hillshade
  labelled as the hybrid view the user was reading. It is *disabled* rather
  than hidden so the row does not reflow as you walk the ground ring.
- **It crosses the tree through an atom.** The button is on the lokalitet row;
  the answer is in `RibbonGlobalRow`, which mounts the four control hooks and
  is a *sibling* rather than a parent. So row 1 publishes a description of what
  its ground could keep (`beholdOfferAtom`) and the workspace decides what to
  do with it — the same split `coverTerrainSpecAtom` crosses in the other
  direction (§10).
- **Only the terrain arm carries a callback, and it is a `describe`, not a
  producer.** The other two are identified by a dataset name the workspace can
  read off the offer; a terrain render is identified by eight knobs that live
  inside `useTerrainAnalysis`, so the hook has to say what they currently are.
  It used to hand back a finished figure — since §8.7.4 it hands back a
  `BeholdSpec` (`kind`, `caption`, `meta`) and produces no pixels at all.
- **The duplicate guard is the `meta` block.** Same source, style, model and
  parameters over the same rectangle is the same image, so the button reads
  `Beholdt` and is disabled while a match exists (`attachmentMatchesKey`, bbox
  to 1 m, floats to 1e-6). Without it a session of scrubbing the azimuth
  slider leaves forty near-identical renders and `hidden` (§8.7.3) becomes
  curation against a mess this made. It counts **hidden records too**:
  fetching a second copy of something the author put away is exactly that
  clutter.
- **The `kind` in the key is load-bearing.** The three producers do not write
  the same fields — a LiDAR extract names its WMS dataset in `meta.sourceKey`,
  a terrain render has no dataset to name and is identified by its knobs, and a
  flyfoto grab says which acquisition it is in `meta.nibSource` /
  `meta.projectId`. Same distinction `viewSpecOf` makes (§8.7.1).

#### 8.9.3 The picker carousels

`docs/lokalitet-view.md` §4.3. Two of the four routes ask for *several* images
at once, and both used to answer by saving all of them. They now open a **run
of proposals** in the bottom slot, one card at a time, each keep or discard —
`src/localities/usePickerRun.ts` for the state machine, `BilderPicker.tsx` for
the surface.

`Hent ▾` on the lokalitet row is the shared entrance: a two-item popover
(`RibbonLocalityRow.tsx`'s `HentMenu`) holding `LiDAR-uttrekk` and `Flyfoto`.
They belong together because they are the same gesture — choose a batch, triage
it — and they are the two rarest things on the row, so a popover keeps it one
line. Each item opens its own selection dialog (§8.8, §10) whose footer starts
the run.

Load-bearing choices:

- **Enumerate everything; fetch one at a time.** `start()` takes the full
  candidate list up front, so the rail and the progress line are honest from
  the first frame. One worker then fetches the card the cursor is on and the
  one after it, sequentially. Twelve proposals cost two requests until you
  walk, and a run you abandon after card three never touched the other nine —
  which is the actual saving over "Hent alle", not the writes.
- **Discarded cards were never records.** Nothing is written until `Behold` on
  a card, and the write happens **on the press** rather than at close. That
  matters twice: `Esc` can then only cancel fetching and can never throw away a
  decision, and the card can show a receipt. The design doc says the kept ones
  "join the collection" when the picker closes, which stays literally true —
  the collection carousel is not on screen while the picker owns the slot.
- **Keeping does not re-render.** The card is holding the produced blob, so
  `keep()` hands *those* bytes to `createAttachment` with
  `{...candidate.meta, ...produced.meta, renderedAt}`. `renderSpec` is exported
  from `pinQueue.ts` for the fetch side, so a picker card and a pin are the
  same renderer with the same filenames (§8.7.4).
- **Duplicates are filtered before the run starts.** A candidate whose
  `BeholdKey` already matches a record (`attachmentMatchesKey`, hidden ones
  included — §8.9.2) is dropped and counted as `skipped` in the header, rather
  than fetched and then refused. The cheapest request is the one not made.
- **`Esc` cancels with a generation counter, not an `AbortSignal`.**
  `renderSpec` does not take one, and threading it through would mean an abort
  path in the stitcher, the DEM reader and the NiB fetch. Instead `start()` and
  `finish()` bump a counter and a landing result whose generation is stale is
  dropped on the floor. The request finishes; nobody is listening.
- **Discarding removes the frame; keeping marks it.** A discarded card leaves
  the rail rather than greying out, so twelve proposals visibly become the four
  you are still considering. A kept one stays with a check on it, because a
  rail that forgets what you kept invites keeping it twice.
- **It does not look like the collection.** A header naming the run and its
  progress, a tally, an accent border and a `Ferdig` button — "these are
  proposals" and "these are yours" must not look alike.
- **`§6`: every image in a lokalitet covers the lokalitet's rectangle.** The
  extract's drawable sub-selection was the one producer that could break that,
  and it went with the demotion rather than surviving as a special case. The
  filmstrip's whole value is that the ground does not move as you walk it; one
  image over a hand-drawn sub-rectangle breaks register for the entire strip.

Keys are in §8.4: ← / → walk, Enter/K keep, Delete/X discard, `Esc` ends the
run. The run also ends itself if `canAdd` goes away underneath it.

### 8.10 Provenance figures — what a saved image carries

`src/figure/` — three files, no UI. Every raster the app keeps or hands out
goes through `renderFigureBlob(canvas, spec)` first, and comes back as a
**figure**: the image untouched, a scale bar and north arrow on it, and a
caption panel under it naming the dataset, the acquisition, the processing
settings, the extent, the rights holder and the licence.

This is not decoration. A relief render is an *interpretation* of the ground —
a hillshade at 315°/35° and one at 135°/20° disagree about whether there is a
mound in a field. A figure that does not carry its own azimuth cannot be
checked by anyone, which is the difference between a picture and evidence, and
reporting a find to Riksantikvaren or a county archaeologist means handing over
the second kind.

| File | What |
|---|---|
| `figure/draw.ts` | canvas primitives: `layoutCaption`, `drawScaleBar`, `drawNorthArrow`, number formatting |
| `figure/figure.ts` | `FigureSpec`, `CREDITS`, `renderFigure` / `renderFigureBlob`, the seven caption rows |
| `figure/specs.ts` | one spec builder per producer: `lidarExtractFigure`, `terrainFigure`, `flyfotoFigure`, `sketchFigure`, `sceneFigure`, `screenshotFigure` |

**Scope: everything but "Last opp".** Both LiDAR extract exits ("Behold" *and*
the PNG download — the download is precisely the copy that ends up in someone
else's report), `Behold` on any ground, the flyfoto grab, "Ta skjermbilde" and
all three steps of the starter set. An upload's provenance is unknown to the app,
so inventing a caption for it would be worse than none.

A scene's figure (§10.2) is the one whose settings line is not a service and
its parameters but *the pictures it is made of*, bottom to top, each with the
fade it was seen through — because that is what was decided. A flatten whose
caption did not say "1937 ortofoto at 40 % over sky-view factor" would be a
picture of an overlap nobody could check. Its credits are the union of its
layers'.

That is also why the one thing the app *does* let itself invent about an upload
says so on its face. `Plasser i ruta` (§8.7.2) writes an extent nobody measured,
so it writes `meta.bboxAssumed: true` beside it and every surface that shows the
placement shows the mark — a badge on the card, a `note` on the [Bilde] row
(§10.1), and the flag itself travels with the record into a copy (`Ta med`
carries the whole `meta`, §8.12) and into the takeout when that is built. An
assumption lost on the way out of the surface that made it is worse than no
assumption.

Load-bearing:

- **The caption is a panel *below* the image, never an overlay.** No pixel of
  ground is covered. The cost is that the file is no longer pixel-registered to
  its bbox, so every attachment records `meta.imageRect` (`{x, y, width,
  height}`) — where the image sits inside the file. Anything that later wants
  to georeference a saved raster reads that, not the canvas size.
  **`imageRect` is in the original file's pixels and nothing records the
  figure's overall size**, so it georeferences the original and nothing else: a
  PocketBase thumbnail cannot be scaled back to the ground from it without
  knowing the scale factor, and guessing one from the thumb's aspect ratio is
  routinely a pixel out — half a metre on the map. A layer member therefore
  always loads the original (`useGroundView`, §8.7.1), never a thumbnail.
  Recording a `figureSize` alongside it
  would lift that restriction; nothing needs it yet.
- **An image narrower than `MIN_FIGURE_WIDTH` (560 px) is matted, not
  squeezed.** Below that the caption wraps until it is taller than the picture.
  `imageRect.x` is the matte offset.
- **The caption is paper; the furnishings are not.** Dark ink on near-white for
  the caption, because these land in reports next to excavation photographs.
  White cased on a translucent dark plate for the scale bar and north arrow,
  because they sit on ground that is black in one visualization and white in
  the next.
- **Every dimension derives from one `figureFontSize(width)`**, so a 600 px
  screenshot and a 4000 px extract come out as the same figure rather than one
  with unreadable text and one you could read across a room.
- **Text wrapping splits on `/ +/`, not `/\s+/`.** `Intl.NumberFormat` groups
  thousands with U+00A0, and `\s` would happily break a coordinate across two
  lines.
- **The north arrow is skipped when the image is under ~6 radii wide or tall.**
  An arrow overlapping the scale bar reads as a mistake, and "which way is up"
  is the one thing a north-up raster can leave implicit. It turns by
  `-rotation`, which is non-zero only for a screenshot of a rotated map.
- **`renderFigure` never throws and never returns a smaller image than it was
  given.** If a 2D context cannot be obtained the source canvas comes straight
  back: losing the picture to save the caption is the wrong trade every time.
- **`renderFigureBlob` fits the image to the store *before* the caption is
  drawn, and hands back the resolution it actually wrote.** A figure has a
  ceiling — `attachments.file` is 50 MB (`1700000600`) — and the client keeps
  itself under it with a pixel budget as the rule (`MAX_STORED_PIXELS`,
  40 Mpx) and a byte budget as the backstop (`MAX_STORED_BYTES`, 50 MB,
  re-encoded at most `MAX_FIT_PASSES` = 3 times, each pass scaling by
  `√(budget / size) × 0.95`). Pixels are the rule because bytes are not
  predictable from them: Kartverket's relief encodes near a byte per pixel
  while a flat-sea flyfoto is a couple of hundredths of one, a spread of some
  250×, so sizing on bytes alone would shrink a picture that was never the
  problem.

  The part that is load-bearing is *where* the fit happens. Downscaling the
  blob afterwards, or anywhere else the caption cannot see, prints a caption
  that disagrees with its own pixels — the image row's `px` count, the m/px
  figure and the length of the scale bar all come off `spec.metresPerPx`. So
  the fit scales the source canvas, recomputes `metresPerPx` from the ratio,
  and renders the caption from that; the return value carries the effective
  `metresPerPx` and **every caller writes that into `meta`**, not the number
  it asked the producer for (`starterPack.ts`, `pinQueue.ts` for terrain and
  flyfoto, `useLocalityWorkspace.ts` for the screenshot). A stored figure
  whose `meta` says 0.25 m/px and whose pixels are 0.4 is unfalsifiable in
  exactly the way §8.10 exists to prevent.

  This was paid for: Kartverket's 2025 reflights took a rectangle from 5 pkt
  to 10 pkt coverage, `nativeResolutionMetersPerPx` stepped from 0.3 to
  0.2 m/px, and 1658 × 1585 m stitched to 66 Mpx ≈ 63 MB. PocketBase answered
  400 `validation_file_size_limit`, and since a pin failure is only a spinner
  turning into a retry, the starter set of every new lokalitet in that
  project simply never arrived. The same fix capped the *ask* as well: the
  10 and 20 pkt tiers now resolve to **0.25 m/px**, which is the data's own
  floor rather than a budget — Kartverket publishes the per-project models on
  a 0.25 m grid and 10 pkt/m² is a 0.32 m mean point spacing — so the finer
  asks were buying no detail that was ever in the laser.
- **`figure/` reads `t` / `i18n` from `'i18next'` directly**, not through
  `useTranslation` — it is called from five places, three of them outside
  React. Precedent: `search/infobox/InfoBoxSections.tsx`,
  `shared/utils/coordinateParser.ts`. Strings live under `figure.*` in all
  three locales; rights holders are proper names and are *not* translated.
- **The screenshot is the one figure whose contents the app does not choose**,
  so its provenance is assembled from live layer state instead —
  `backgroundLayerAtom` + `hybridOverlayAtom` for the ground label and whether
  NiB pixels are in it, `activeThemeLayersAtom` for the overlays and hence
  whether Riksantikvaren is credited. `captureLocalityScreenshot` returns
  `bbox25833` (the *envelope* of four screen corners, so rotation is honest),
  `metresPerPx` straight off the view resolution, and the rotation itself.

  It is also the one place that reads **both** compare halves (§5.8), because a
  screenshot of a split map contains two grounds and naming one of them would
  be a false caption: with the curtain up the ground line reads "LiDAR til
  venstre, Flyfoto til høyre", and NiB is credited if *either* half is its
  imagery.

- **The PocketBase `caption` field is untouched** — still the short human line
  the gallery shows ("Flyfoto 1937"). The long-form provenance lives in the
  pixels, where it survives being downloaded, emailed and pasted into a report.

### 8.11 The edit transaction — `Lagre` / `Avbryt` / `Avslutt`

`docs/lokalitet-view.md` §5.6. **Edit is a transaction over a client-side
draft.** Nothing typed, drawn or curated in edit reaches PocketBase until
`Lagre`; `Avbryt` throws the lot away. Three things are outside it: two
deletions, because a confirmed deletion is a decision rather than a draft
(`Slett lokaliteten` and `Slett bildet`, below), and the starter set, because
it is the tail end of `Opprett` rather than an edit made afterwards (§8.9.1).

**The buffer and the stance are two different things, and there is a verb for
each.** `Lagre` commits and `Avbryt` rolls back; both leave you in edit, with a
fresh buffer opened behind them. `Avslutt` is the only way out. Those were one
press until the session that placed the rectangle before creating it: saving
also ended the stance, so "put the last hour on the server and carry on" was
save · `Rediger` · find your place again, and the pin queue's pixels landed on
a surface you had just been thrown out of. Splitting them costs one button on
the row and buys the thing edit is for — a session you leave when you are
done, not when you last saved.

Two files hold it, and nothing else in the app knows it exists:

| File | What |
|---|---|
| `src/localities/draft.ts` | the pure data layer — the `LocalityDraft` shape, one pure updater per kind of change, the two overlay functions, the counts, and `localStorage` load/save |
| `src/localities/useLocalityDraft.ts` | the React half — recovery on arrival, persist-on-change, `commit()`, `rollback()` |

**A delta, not a snapshot.** The buffer holds the fields that *changed*, keyed
by record id, rather than a copy of the lokalitet. A snapshot would have to be
diffed against the server at commit time to avoid clobbering fields nobody
touched, and it would grow with the lokalitet rather than with the edit.

**What is buffered, and what is not:**

| Change | Where it goes |
|---|---|
| name, beskrivelse, sted, kommune, matrikkel, synlighet | buffered |
| funn title, note, status, geometry | buffered — autosave's destination, §8.5 |
| curation `sort` / `hidden` | buffered |
| the rectangle (`Juster området`) | buffered, with its own nested `[Bruk]` / `[Angre]` |
| a View kept (`Behold`, both pickers, flyfoto) | buffered **as a spec**, under a `draft:` id |
| the starter set's three specs | written **through**, at `Opprett` (§8.9.1) |
| a File made (skjermbilde, opplasting, a picker keep) | written **eagerly**, id tracked, deleted on `Avbryt` |
| a funn deleted | **deferred** — a tombstone; the row greys and comes back on `Avbryt` |
| a bilde deleted | **written through** on confirm, and the buffer forgets the record; only a *failed* DELETE leaves a tombstone |

Files are the exception because they are bytes: buffering a 12 MB PNG in
`localStorage` is not a thing, and holding it in memory for an hour is barely
one. So they are written when they are made, their ids are collected in
`eagerIds`, and `Avbryt` deletes them — which is the one place the transaction
is a compensating action rather than a real rollback.

Load-bearing, in the order the mistakes would be made:

- **The lokalitet's own fields still flow through `activeLocalityAtom`.** Half
  the app reads the rectangle off it — Terreng's DEM, the funn layer, every
  producer's `bbox25833` — and a buffered bbox those never saw would make
  "Juster området refetches the DEM for free" (§10) quietly stop being true. So
  `applyLocality` moves the live record and the buffer keeps `baseLocality` to
  put back. It is the one thing edit changes outside the buffer, and it is why
  `Juster området` needs an undo of its own.
- **The overlays synthesise real record shapes.** `overlayFinds` and
  `overlayAttachments` return `LocalityFindRecord[]` / `AttachmentRecord[]`
  with the buffer laid over the server's lists — new ones minted under
  `draft:`-prefixed ids. No card, list, callout or figure builder learns a
  second type, and none of them can tell the difference. `isDraftId` is the
  only test, and only three places make it: the pin sweep, the pin face and
  `Åpne originalen`.
- **Deferred deletion is published as one `Set`.** `deletedIds` spans both
  collections (PocketBase ids are unique across them) plus `restoreDeleted`.
  The funn row — and a bilde's frame and detail on the one path that still
  produces a tombstone for one, a DELETE that failed — grey, strike through,
  lose every verb but
  `Angre sletting`, and stay where they are — a row that vanished would be
  claiming a deletion that has not happened. The **counts** stay inclusive of
  tombstoned records, so the badge and the rail agree about what is on screen;
  the **cover** and the **pin sweep** exclude them, because both are about what
  the lokalitet will look like afterwards.
- **`Lagre` returns before the pixels exist.** `commit()` plays the buffer out
  in dependency order (locality → find deletes → find patches → new finds →
  attachment deletes → attachment patches → new specs) and enqueues every
  created spec. Each success is removed from a cloned remainder, so a partial
  failure leaves a buffer describing exactly what is left and lets `Lagre`
  retry precisely that — and `saveEdit` returns that verdict as a boolean,
  because `Lagre og avslutt` must not walk out of a commit that half-failed.
- **A `meta` patch is always the whole object, and only sometimes a re-pin.**
  `DraftAttachment.meta` is the one buffered field that is not a curation
  column, and it has two writers: a re-drawn sketch's new scene (§9.3) and a
  placed upload's extent (§8.7.2). PocketBase replaces a JSON field wholesale,
  so both spread the existing `meta` and neither may send a fragment. What
  decides whether the commit also owes the record new pixels is `viewSpecOf`,
  not the presence of the patch: a sketch's figure is now a picture of the old
  drawing and goes back on the queue, while a File has nothing to render from
  and the queue would only mark it `empty` (§8.7.4) and light a failure face on
  a record that is perfectly fine.
- **A `draft:` id is translated in both halves of a scene.** The commit already
  mapped temp ids in the two *relations* — a sketch about a funn invented in the
  same session — and a scene names its members in `over` **and** in
  `meta.layers` (§10.2), so `remapSceneMeta` does the same job on the half that
  lives in JSON. One pass is enough because `newSpecs` is in the order the
  specs were kept and a scene can only name members that already existed when
  it was kept. `copyLocality` (§8.12) needed the identical fix for the same
  reason, one id space over. Both drop what they cannot translate: a layer
  pointing at a record that was never written is not a layer.
- **And in an existing bilde's `funn`.** `DraftAttachment` gained the relation
  at §13.10 step 9 (§10.3), so it is a buffered column like `caption` and
  `hidden` — and it is the one buffered *relation* on a record that already
  exists, which means the attachment patch loop needs the same `resolve` the
  specs get: filing a photograph under a funn drawn in this session is exactly
  the case where the id is still `draft:`. The buffer's `version` is not bumped
  for it; the field is additive and `attachmentBaseOf` supplies it, so a buffer
  written before step 9 merges unchanged.
- **A successful commit reloads both lists.** Realtime is still held back — the
  stance did not end — so the funn and specs the commit just created would be
  nowhere: the buffer the overlay was reading them out of is empty now, and no
  event will put them back until `Avslutt`. `saveEdit` therefore calls
  `reloadFinds()` and `reloadAttachments()` (and `refreshFunnLayer()`, for the
  shapes that were on the map under `draft:` ids). Reloading under an open
  buffer is exactly the thing §8.5 forbids everywhere else; it is safe here and
  only here, because the buffer is empty *because* it was just played out.
- **The buffer survives a crash.** It is written to `localStorage` under
  `tufteseid.draft.<localityId>` on every change — no debounce, because the two
  writes that could be frequent are already debounced upstream (the pen settles
  for 700 ms, text fields commit on blur). On next open it is read **once**,
  keyed on the id alone, and re-entering edit is automatic: a buffer without
  the stance that owns it is work on screen with no way to save it. The banner
  says *Gjenopprettet ulagret arbeid fra 14:32* with a `Forkast` beside it
  (§8.1). This is the part of the section not worth shipping without.
- **Realtime stands down, and says so — but it does not count our own
  writes.** `useLocalityContent` keeps both subscriptions up while paused and
  records what arrived instead of reloading a list the buffer is describing.
  What it records is a *map* of record id → `{ deleted, updated }`, and
  `changedElsewhere` is a comparison against what this client already holds,
  made at read time: an event reporting the `updated` we are already looking at
  is our own echo, and a delete of a record we have already dropped is the
  same. A sticky boolean was wrong twice over once the starter set and the pin
  queue began writing inside a paused session — every new lokalitet's first
  `Lagre` would have toasted *"endret et annet sted"* at the author about their
  own three images — and weighing at read time also makes the answer
  independent of whether an event or its own POST response gets back first.
  Committing over a genuinely changed record still toasts. Last write wins is
  acceptable for one author with two tabs; a silent overwrite is not.
- **The funn layer is told to forget.** `useFunnLayer` runs its own fetch and
  subscription and knows nothing about the buffer, so buffered shapes are
  pushed onto it by hand under `draft:` ids. Both exits call
  `refreshFunnLayer()` — a module-level hook into that effect, sequence-numbered
  so a refresh racing the initial load cannot double-add.
- **The buffer follows the stance, not the entrance.** `Rediger` is not the
  only way into edit — a lokalitet created in this session arrives in it
  already (§8.1) — and stance without a buffer is the one state that loses work
  silently, since every write is a no-op `mutate`. So one effect opens it
  whenever `stance === 'edit'`, and `begin()` is idempotent. That effect is
  also what makes `Lagre` and `Avbryt` survivable as non-exits: both end with
  no buffer and the stance still up, and the next render opens a fresh one with
  a `baseLocality` read off the record as it now stands.
- **Escape got quieter.** With `Ferdig` gone, Escape can no longer mean
  "leave": it closes the deepest thing in flight, and at depth 1 it calls
  `exitEdit` only when the buffer is clean. A stray keypress must not have to
  choose between `Lagre` and `Avbryt`, and must not raise the exit confirm
  either — a dialog a keypress opened is a dialog you have to read before you
  can dismiss it.
- **`Slett lokaliteten` is not deferred.** Deleting the record the transaction
  is *about* has nothing to be rolled back into, so it goes straight through
  and clears the buffer on the way. The confirm it already had is the safety
  net.
- **`Slett bildet` is not deferred either**, and that one was a reversal. The
  deferral cost two things it never repaid: the confirm on the button says the
  action cannot be undone, which the greyed card that followed was quietly
  contradicting; and the only way to make the deletion *happen* was `Lagre`,
  which at the time also ended the session — so pruning an exhibit of twelve
  working renders was twelve rounds of leaving edit and pressing `Rediger`
  again. Splitting the exits has since taken the second half of that argument
  away, and the first half is still enough: a confirm that says "cannot be
  undone" has to be telling the truth. Now
  `removeBilde` awaits the DELETE and then calls `forgetAttachment`, which
  takes the id out of all four arms of the buffer at once (tombstone, buffered
  caption/sort/hidden, buffered spec, `eagerIds`) — each of the four would
  otherwise become a write against a 404 at commit or at `Avbryt`. Realtime is
  stood down in edit, so the record is taken off the list by hand. A **failed**
  DELETE falls back to exactly the old behaviour: the tombstone stays, the card
  greys with `Angre sletting` on it, `Lagre` retries it, and a toast says so.
  A buffered spec is the trivial case — it never reached the server, so
  dropping it from `newSpecs` is the whole operation. Funn deletion stays
  deferred: a funn is geometry you may have spent ten minutes drawing, and it
  is deleted from a list where the next row is one keystroke away.

**Both destructive exits confirm, and both name the work.** `Avbryt` is only
on the row when the buffer is dirty, so its dialog always has a count to
print: *Forkast 12 bilder, 3 funn og 1 sletting?* `Avslutt` leaves silently on
a clean buffer and otherwise asks the same question with one more answer —
*Du har ulagret arbeid: 12 bilder, 3 funn og 1 sletting.* over `Bli værende` /
`Forkast og avslutt` / `Lagre og avslutt`, the last of them the primary. Three
answers rather than two because the two-answer version makes the common case
(save, then go) two presses, and makes discarding the default reading of the
other button. The conjunction comes from `Intl.ListFormat` rather than a
`shared.listJoin` key — it is in the platform, and it is the one bit of that
sentence the three locale files should not have to spell.
(`tsconfig.app.json` gained `ES2021.Intl` in its `lib` for the types; the emit
target is unchanged.)

`exitEdit` rolls back on the way out even when the buffer is clean, which is
also what the recovery banner's `Forkast` now calls: a rollback of nothing
costs nothing, and a buffer left open in show would hold a `baseLocality` the
live record can drift away from.

### 8.12 The copy — `Lag min kopi`

A reader's one verb (`docs/lokalitet-view.md` §7). It forks somebody else's
rectangle into one of your own instead of refusing you a pen, which is what
makes a shared lokalitet useful to the person it was shared with: the argument
someone else made is where you *start*, not something you can only read.

**What comes along, and what does not.** `src/localities/copyLocality.ts`:

| Carried | Left behind |
|---|---|
| `bbox`, `name`, `description`, `place`, `municipality`, `matrikkel` | `owner` — the copy is yours |
| every funn: `title`, `note`, `status`, `geometry` | `visibility` — a copy starts `private` |
| every **View**'s `meta`, `caption`, `sort`, `hidden`, as unpinned specs | every **File** — the screenshots and uploads (§8.7.4) |

The View/File split (§8.7.4) is what makes that table possible. A View is a row
of parameters, so copying it is one small write and the pin queue makes the
pixels again on the other side; a File is twenty megabytes with nothing behind
it, and duplicating a dozen of them through the browser would turn a fork into
a multi-minute upload. So the dialog says so before it starts: *"Funn, område
og bilder du kan gjenskape følger med. Opplastede bilder og skjermbilder blir
liggende hos originalen."*

The name is kept verbatim — no *"(kopi)"*. Attribution is the banner's job, and
it is `derivedFrom` (a relation with **no** cascade delete — a fork outlives its
original) plus `derivedFromLabel`, the original's name and owner frozen as prose
at copy time. Denormalized for the same reason `finds.owner` is: attribution
that vanishes when the original does is not attribution.

Load-bearing details:

- **It is deliberately not a transaction**, unlike edit (§8.11). Every step is
  a create on records nobody else can see, so a half-written copy is a
  lokalitet you can finish or throw away — where a rollback would be the same
  failure with the evidence destroyed. Per-child failures are counted and
  reported (*"3 rader kom ikke med i kopien"*), never fatal, and the banner
  counts progress as it goes because forty funn over a slow link is long
  enough for *is it stuck* to be a real question.
- **The copy does not throw the DEM away.** `useTerrainAnalysis` keys its
  elevation grid on the rectangle (`bboxKey`), not on the record id, so a copy
  with an identical bbox costs one write and no megabytes. What did need
  saying is the **seed** (§10): the knob seeding is once-per-lokalitet, and
  swapping to a copy is a lokalitet change — so the reset is skipped when the
  new record's `derivedFrom` is the one being left, or the tuned azimuth that
  motivated the copy is destroyed by a re-seed the moment it lands.
- **`imageRect` and `renderedAt` are stripped** from each carried spec: they
  are facts about pixels that do not exist yet. `bbox25833` stays, so the pin
  queue renders the spec's own rectangle rather than the copy's current one.
- **`sort` and `hidden` carry**, which is why `NewAttachmentInput` takes them
  at all. The original's arrangement is part of what was being shared.
- **Relations are wired in a second pass**, after every record that is going to
  exist does — a sketch may be a layer on a bilde further down the same list.
  Since §13.10 step 9 the pass runs for **every** carried View, not just the two
  kinds that carry `over`: `funn` means "which funn this bilde belongs to" now
  (§10.3), so a fork that carried the funn and lost which images were filed
  under them would arrive with its exhibit unsorted. The scene needs one thing
  more, since
  its membership is in `meta.layers` as well as in `over` and both halves have
  to name the copy's records or the flatten would be of the original's.
  Untranslatable layers are dropped by both, which is the same sentence twice:
  the Files stayed with the original, so a scene built over one arrives with
  that layer missing until `Ta med` brings the File across — and a File brought
  across later arrives filed under nothing, because by then the id map is gone.

**The Files that stayed behind are still shown.** `useInheritedBilder` lists
the original's Files and appends them to the copy's carousel as borrowed
cards — dashed accent border, a *Fra originalen* badge, a read-only caption,
and exactly one verb: **Ta med**, which fetches the bytes and writes them as a
new attachment of the copy's own, marked `meta.takenFrom`. Elective, per image,
paid for by whoever asked. Four things about that tail:

- They are a **suffix of `bilderItems` and never enter `attachmentItems`**,
  which is what keeps every ordering, cover and pin-sweep call correct without
  learning about them — all of those index into `attachmentItems`.
- The cards appear **only for an owner in edit** (`canAdd`), because their only
  verb is a write and §2 says write verbs are absent in show, not greyed.
- `Ta med` is an **eager, compensated write** like a screenshot or an upload
  (§8.11): the bytes exist the moment it succeeds, and `Avbryt` deletes them.
- The consequence to accept: **they stop resolving if the original is deleted
  or turned private**. §7 asks for a *"Bildet er ikke lenger tilgjengelig"* per
  card, but a copy stores nothing per borrowed file — only the one relation —
  so there is no card left to put it on. The sentence moves to the banner,
  which says it once and withdraws `Åpne originalen` rather than offering a
  link known to be dead.

### 8.13 The share link — `Del`, `?lok=` and `/l/CODE`

`src/localities/shareLink.ts`, plus six lines in the `Caddyfile`. Design:
`docs/lokalitet-view.md` §10.

**The code is the link.** `?lok=K7M2QX` is the parameter and
`/l/K7M2QX` the short URL, and neither needs a redirect table, because the
six-character code already addresses the record (§8.1's row shows it; the
migration that added it says why). So the "short URL" is a `redir` on our own
Caddy — one `path_regexp` on `^/l/([0-9A-Za-z]+)$` into `/?lok=…` — rather than
a service, and the app only ever writes the long spelling, so there is exactly
one form to keep parsing. Deliberately **not** an SPA fallback over
`file_server`: a catch-all rewrite to `index.html` would change what every
wrong path in the app does, and a 404 for a URL nobody minted is the right
answer.

**Both directions live in one module**, because the writer and the reader have
to agree about spelling, case and — the part that actually bites — *when* the
parameter may be removed:

- **The writer** puts the open lokalitet's code in the URL and takes it out
  when the lokalitet closes. Keyed on the code, not the record, so re-fetching
  the same lokalitet does not rewrite the URL.
- **The reader** resolves `?lok=` once, on a cold load, through
  `getLocalityByCode` — a `getFirstListItem` on the uppercased code, since the
  code is displayed uppercase and typed off a note in whatever case.
- **The boot code is captured at module import**, not during the first render.
  On a cold load nothing is open yet, so a writer that ran first would delete
  the parameter before the reader ever saw it. Reading it before React starts
  is what makes the race impossible rather than unlikely.
- **The writer holds off until the reader has settled.** A guest at the
  sign-in wall still has the link in their address bar, so reloading during
  sign-in is not what loses it.

**The sign-in wall is the read rules, not a policy decision here.** All
lokalitet content requires auth, including `public` ones, so a guest following
a link gets `isAuthDialogOpenAtom` raised and the code waits in the module
until `currentUserAtom` fills in — asking PocketBase first would answer 404 for
the wrong reason. **A miss and a lokalitet the reader may not see are one
message**, because the API cannot tell them apart and telling a stranger that a
code exists but is not theirs is a leak rather than a better error.

**A link opens in `show`, whoever follows it** (§8.1, §2). Nothing in this
module writes `editingLocalityIdAtom`, and that is the whole of the
enforcement — stance is keyed on a record id that starts null, so the rule
holds by construction rather than by this module remembering it.

**The link carries no viewport.** No `lat`/`lon`/`zoom` of the sender's: the
workspace fits the map to the rectangle when it mounts (`zoomToLocality`, keyed
on the record id), so a shared link frames the lokalitet for free — and a
pinned viewport would be a link that opens somewhere else the day somebody
uses `Juster området`.

**`Del` is an item in the `⋮` menu** (`OverflowMenu`), in both stances and for
every access level. A reader sharing a lokalitet they were shown is the
ordinary case, and the link grants nothing the recipient did not already have.
It sits beside the short code it is made of: `LocalityCode` copies six
characters for a phone call, `Del` copies the URL for a message.

**The toast names the visibility consequence.** Visibility is set in Detaljer,
once, months before anybody shares anything, and a link to a `private`
lokalitet answers "finner ikke" for everyone but its owner. So a public record
gets a `success` and everything else a `warning` that says only you can open
it and where to change that — rather than the menu hiding `Del`, which would
teach nothing. `limited` gets the private wording, because `limited` behaves as
`private` until groups exist and the toast has to describe what the server will
actually do.

---

## 9. Drawing

`src/funn/` — Excalidraw on a transparent canvas over a frozen map. One pen,
and **two different things come off it**: a *funn*, which is geometry on the
ground, and a *tegning*, which is an overlay you can switch on and off over any
ground you like. Which one you get is decided by the entrance and fixed for the
session.

This replaced `src/draw/` plus `src/settings/draw/` — 23 files and ~3500 lines
of inherited Norgeskart drawing subsystem, the largest single thing the fork
has deleted (§15).

### 9.1 The map is frozen, not photographed

Pressing the pen stops the map and draws over it. `freezeMap` (`session.ts`)
cancels any easing view animation, then switches off every interaction that was
active and remembers which — blunter than the owner tagging in
`map/interactions.ts` on purpose, because that registry exists so one feature
can remove its own interactions without disturbing another's and this has the
opposite requirement: *nothing* may move the view, including the pan and zoom
OpenLayers installs by default, which no owner ever claimed.

`captureFunnFrame` (`frame.ts`) is then read once and never again while the pen
is down, which is what lets a frame be four numbers and a size rather than a
live projection:

- **Scene units are the CSS pixels of the frozen viewport**, origin top-left,
  y down. So a scene coordinate *is* a pixel of the map the user was looking at.
- **The extent is stored in the view projection at freeze**, not in EPSG:4326
  like `localities.bbox`. Rotation is locked off (`map/atoms.ts`), so in a
  projected CRS the scene↔ground mapping is exactly linear; degrees would make
  the y axis subtly non-linear across a tall viewport for no gain. Degrees are
  derived at the edges, where something wants them
  (`sceneExtentToBbox4326`, `frameExtentIn`, `metresPerScenePx`).

**What is under a stroke is the real map, not a picture of one.** The canvas is
transparent and the map is still on screen behind it. That was not free: the
Excalidraw scene can be panned and zoomed, and an overlay that moved while the
map did not would put every stroke over ground nobody traced. So the map is
**slaved to the scene** — `slaveMapToScene` CSS-transforms the map element to
match whatever the scene is looking at, which keeps the frame valid, requests no
tile, and asks Kartverket for nothing when the user zooms in to trace a detail.
A transform is invisible to OpenLayers (`map.getSize()` reads layout, and the
ResizeObserver behind it watches the content box), which is what makes it safe.
Move the view instead and the frame every stroke is registered to goes stale
under them.

**And the wheel zooms**, as it does on the map and everywhere else here.
Excalidraw's own wheel scrolls the scene and reserves zoom for Ctrl+wheel,
which would mean one gesture meaning two things on two sides of a transparent
canvas — and since the map is slaved to the scene, a scene zoom is what a map
zoom looks like from in here anyway. There is no prop for it, so `zoomOnWheel`
(`FunnCanvas.tsx`) rewrites the event rather than replacing the handler: a
plain notch over the canvas is stopped in the capture phase and re-dispatched
at the same target with `ctrlKey` set, which is the event a trackpad pinch
already sends, so the zoom stays anchored, stepped and clamped by Excalidraw's
own code. `isTrusted` is the recursion guard; Firefox's line-mode delta is
normalized to pixels on the way through, or a notch there would be a 3% step
against Chrome's 10%. Ctrl+wheel, Shift+wheel (horizontal scroll) and anything
whose target is not the canvas (the tool islands scroll) are left alone, and
panning the scene stays space-drag, middle-drag and the hand tool.

There used to be a `snapshot.ts` here that flattened the layers into a locked
background element in the scene. It is gone: the still was a second copy of
what was already on screen, and the live map under a transparent canvas is both
cheaper and honest about what it is.

### 9.2 Funn mode — the pen makes geometry

Entered with **Nytt funn** (`N`). The pen itself is not cut down — the
restriction is at the *conversion*, not in the UI: the surface offers the same
tools in both modes, and `sceneToCoord` decides at commit which elements can be
a feature. Two reasons. A tool palette that changes shape under you is a second
thing to learn, and the funn arm would be the impoverished one; and the
elements that do not convert are not useless in funn mode — a text label placed
while tracing is a note to yourself, and it survives in the scene the autosave
keeps even though it never reaches `finds.geometry`. At commit `sceneToCoord`
takes each convertible element back to the ground as a GeoJSON
`FeatureCollection` in EPSG:4326 on the funn record —
`finds.geometry`, unchanged in shape and meaning from what the OpenLayers draw
layer used to write. The autosave rules that surround it are §8.5.

- **Ellipses become 64-gons and freedraw becomes a dense `LineString`.** GeoJSON
  has no circle and no stroke; a shape drawn round comes back as a polygon and
  re-editing it edits vertices. Inherited wart, same as before, now stated at
  the one place the conversion happens.
- **Text elements are not geometry and do not convert.** A funn has a `title`
  and a `note`, both better places for words than a label floating in a
  `FeatureCollection`, and §8.6 draws the note as a callout anchored to the
  shape.
- **The stroke's own styling does not survive**, and that is a change. A funn
  renders in `funnLayer`'s one cased-orange style on every background, because
  the expressive drawing is now a separate object that keeps its colours
  exactly. Per-feature colour, width, line style and point style — and
  `getStyleFromProperties` / `getFeaturePropertiesForExport`, the round-trip
  that carried them — went with `src/draw/`.

### 9.3 Tegning mode — the pen makes an overlay

Entered with **Tegn**. Nothing is restricted: the whole Excalidraw tool set,
its own hand-drawn defaults, and no override of them — these are sketches over
terrain, not scientific annotation, and a sketch that looks like a measurement
claims more than it knows.

What is kept is **the scene, not a picture of the ground**. A sketch is an
`attachments` row of `kind: 'sketch'` whose `meta` carries `{ frame, scene }`,
and whose pinned file is a **transparent** figure. It is never composited with
the terrain it was drawn over, and three things follow from that:

- **The ground ceases to be part of the decision.** `Behold` refuses Standard
  and Hybrid because there is no rectangle-fetch path for the topo WMS
  (§8.9.2). A sketch has no such refusal to inherit: one drawn over the
  topographic map is exactly as good a record as one drawn over a LiDAR
  hillshade, because neither contains a ground.
- **It does not compete for the ground level.** That level is a stack of
  composited members in one layer and one canvas (§8.7.1). Sketches are
  transparent, so they are not members of it and take nothing from anybody:
  `map/sketchOverlay.ts` holds
  a *set* of them, each on its own `ImageCanvasSource` at `zIndex: 2` — the
  slot `drawLayer` vacated, over the whole of [Visning] and [Bilde] and *under*
  the funn, the measure line and the heritage layers, because a sketch is a
  reading of the image beneath it and the register's own answer has to stay
  legible through it — each switched on and off independently.
- **Display re-exports the scene rather than stretching the file.** The layer
  re-runs Excalidraw's `exportToCanvas` at whatever resolution the view
  currently needs, the way `groundOverlay` re-renders rather than scaling, so
  strokes stay crisp at any zoom instead of blurring past the resolution the
  frame happened to be captured at. The renderer is behind a dynamic import: a
  reader who opens a lokalitet with no sketches in it never loads it. An export
  takes about as long as a re-draw plus a `Lagre`, so each entry **counts its
  scenes** and a landing export is only taken if the count has not moved under
  it — otherwise a sketch that was drawn on again while its first export was
  running would have the previous strokes installed as current, and keep them
  until the view zoomed past the rescale tolerance.

**A sketch knows where it belongs.** Two relations, neither cascading:

| field | → | means | set from |
|---|---|---|---|
| `over` | `attachments` | the bilder this drawing is a layer on | every member switched on in [Visning] and [Bilde], in row order, at the moment it is kept |
| `funn` | `finds` | which funn the drawing belongs to | the selected funn at that moment — and editable since §13.10 step 9 (§10.3) |

`over` used to be a single id — the one pinned bilde, because the ground held
one image — and since §13.10 step 6 it is the whole ground as it stood: the
shown Views then the shown Files, in the order they were painted in. That is a
better record of what was drawn over and it is the same reading the map already
has, so nothing had to be invented to take it. A sketch tied to nothing is
simply one you switch on yourself, from the rail or from [Skisse].

Both are seeded automatically, and **one of them now has an editor**. `funn`
got it at §13.10 step 9, together with a wider meaning: the seed answers "what
was selected while you drew", which is a fair guess at what a sketch is about
and no guess at all at where an image belongs, so the answer became editable on
every kind's card and the pulldowns group by it (§10.3). A sketch is where the
two readings meet, and they were never in conflict — the funn you drew over is
the funn the drawing files under.

`over` is still seeded and still uneditable, and nothing reads it back: the old
claim that selecting a bilde brings its sketches up with it went with the
rail's ground verbs, since selecting no longer touches the map at all. Its one
reader is the copy, which translates it (§8.12).

**Where the verbs are.** `Tegn` on the lokalitet row puts the pen down in
sketch mode and is its own toggle; while the surface is up the row's exits zone
holds the only way out of it, `[Behold skissen] [Avbryt]`, deepest-first beside
the funn draft's own pair (§5.3). Neither writes to PocketBase: `Behold
skissen` buffers a new spec — or, on a re-draw, the whole replacement `meta` —
into the edit transaction, and `Lagre` is still what commits it (§8.11). A
newly kept sketch goes up on the ground at once, under the draft id the buffer
minted for it, so the commit hands its temp→real mapping back and the shown set
is rewritten through it: otherwise the drawing comes off the map at the moment
it becomes a record. On the
bilder rail a sketch card carries two verbs no other bilde has: an eye
(`Vis skissen` / `Skjul skissen`) in **both** stances, because turning a layer
on writes nothing and holding a reading up against the image it was made over
is the whole reason the two are stored apart; and `Rediger skissen` in edit,
which is `resumeSketch` — the scene back under the pen, the stored copy taken
off the map while it is there so the old strokes do not show through the new
ones. The eye is the *only* map verb left on the rail: `Vis i ruta` was deleted
in step 6 and a sketch never had it anyway, since laying a figure into the
ground level would have put a white image with a caption panel over the very
thing it annotates. That refusal is now structural rather than a check — a
sketch is not in `fileItems` or `viewItems`, so there is no row in [Bilde] or
[Visning] for it to be refused on, and the eye it does have presses the same
`sketchShownAtom` that [Skisse] presses.

**And the whole set has one button, `[Skisse ▾]`** — the first built of the
layer row's four groups (§8.1, `docs/lokalitet-view.md` §13.10 step 3;
`[Funn ▾]` joined it at step 4 and `[Visning ▾]` at step 5). The label
takes every sketch off the map at once and the caret opens the members, each
with its switch and its own fade. Two facts about it belong here rather than
with the row:

- **The group toggle is layer visibility.** `sketchGroupShownAtom` reaches
  `setSketchOverlays(next, shown)`, which calls `setVisible` on the entries
  rather than shortening the list — so the group comes back holding exactly the
  composition that was up, and holding its exports, instead of re-running an
  Excalidraw render per member.
- **A fade never invalidates an export.** Per-member opacity lives in
  `sketchOpacityAtom` in percent, converts to OpenLayers' 0–1 at the same
  boundary, and both it and visibility are applied *before* the scene-identity
  check in `setSketchOverlays` — so neither can bump `generation` and throw a
  render away.

The card's eye in the rail stays exactly as it was: both surfaces press
`sketchShownAtom`, so the rail and the row cannot disagree about what is up.
The one under the pen is in neither list, because the overlay effect skips it.

**Flattening a composition is `Ta skjermbilde`, and it already works.**
`compositeMapCanvases` walks every `.ol-layer` canvas in layer order honouring
opacity and transform (`map/composite.ts`), so the moment sketches are OL
layers a screenshot catches the whole reading — the ground preset, every
[Visning] and [Bilde] member that is down, whichever
sketches are switched on, the heritage layers, the funn — as one File cropped to
the lokalitet's rectangle. That is the answer to "keep what I am looking at",
and it is why the sketch itself never needed to be composited.

Since §10.2 there are two flattens and they do different jobs. A screenshot
catches the *screen*, including everything that is not lokalitet content — the
heritage layers, the measure line, search markers — as bytes with no components
left in them. A scene keeps the *arrangement*, so it can be taken apart, put
back, re-read at another zoom and forked. Press the first to show somebody what
you were looking at; press the second to keep the reading.

### 9.4 What the surface deliberately does not offer

`UIOptions` in `FunnCanvas.tsx` turns off every canvas action that is about
*Excalidraw's document*, because the document here is a funn or a bilde: change
background colour, clear canvas, export, load scene, save, save as image,
toggle theme. The background belongs to the map; saving belongs to §8.11.

The image tool is off too. A lokalitet's images are bilder and every one of
them carries a provenance caption (§8.10); a PNG dropped into a drawing would
be a picture inside the record with nothing behind it.

`handleKeyboardGlobally={false}` keeps Excalidraw's single-letter shortcuts on
its own surface. The funn's title field is a ribbon row above it, and typing a
name into it would otherwise also be picking tools; the app's own keyboard map
stands down from the other side for the same reason
(`map/useBackgroundCyclingKeys.ts`, `localities/useWorkspaceKeys.ts`, both
gated on `funnSessionAtom`).

Excalidraw carries its own translations including both Norwegian written
standards, so the toolbar speaks whatever the rest of the app does. Its codes
are regioned and ours are not, hence the `LANG_CODES` map rather than a
pass-through; anything unrecognised falls to English, as `i18n.ts` does.

### 9.5 A session is a thing, and the scene has two speeds

Two invariants that are not visible anywhere in the interface and that both
paid for a lost drawing before they were stated.

**Each session is a different canvas, and it says which.** Every entrance to
the pen — `Nytt funn`, `Tegn`, `Rediger tegningen`, `Rediger skissen` — goes
through `clearForPen`, which puts the pen down and presses it again *in the
same callback*. React batches the two, so `drawRequestedAtom` is never
observed as null and the surface is never rendered without a session: one
session follows another with no gap in between. An unkeyed `FunnCanvas` is
therefore not remounted across that gap, and everything it reads once — the
opening scene, the measured offset, Excalidraw's own live elements — survives
into the next session, which is how a funn's strokes end up kept as a sketch.
So a session carries an `id` (`nextSessionId`) and the surface is keyed on it.
A new session is a new canvas, stated where the code can act on it.

**The surface opens on what the session hands it**, `session.opening`, and not
on a reading of `session.resume`. The two ways in that open on something
already drawn are different shapes: a *resume* is a stored scene with the frame
it was drawn on, and a *seed* is a funn's geometry converted into a frame
captured now (§9.2) with no record of a scene behind it. Deriving the opening
elements from the resume gives the seeded path a blank canvas over a funn that
has just been hidden on the map, with the autosave's baseline still pointing at
the old geometry — so the first stroke is written back as the whole of the
funn and the shape it was opened to correct is gone.

**`funnSceneAtom` lags the pen by 150 ms, and two callers may not.**
`onChange` fires on every pointer sample, so the atom is published on a settle;
nothing that *watches* the drawing is in a hurry (the autosave settles for
700 ms on top of it, and the other subscriber is a button asking whether
anything has been drawn at all). But the verbs that *end* a session read the
scene in order to keep it, and pressing one on the tail of a stroke reads the
atom as of the last render: `Ferdig` commits a funn without its last stroke,
and `Behold skissen` on a sketch whose only stroke is still settling refuses to
keep anything. So the surface lends out a reader of Excalidraw's live scene
while it is up (`setLiveSceneReader`), and the three keep-paths — the autosave's
flush, its timer, `keepSketch` — go through `sceneNow`. The settle stays where
it belongs, in front of the subscribers and not in front of the exits.

---

## 10. Analysis panels

Two of them, both writing to the attachment pipeline, and they really are a
single slot — `ribbonToolAtom` holds at most one — where drawing, which can be
up alongside either, is not.

They no longer live in the same place, and the split is the point. The extract
is a **dialog** off the lokalitet row's `Hent ▾`, because it is a lokalitet
errand with a beginning and an end: pick sources, run it, keep the results
(§8.9.3). Terrenganalyse is one of the five **grounds**, so its controls are on
the ribbon with every other ground's — all of them on the settings strip.

The knobs were in a column down the side of the map, which meant pressing `5`
relocated the controls to a different part of the screen and then covered the
terrain they were describing. One thin row over the map costs less of it than
one panel beside it, and it is where the eye already is.

They arrived from that column as **two** rows, the strip plus a slider row
under it, because each slider stacked its label over its track and four
two-line sliders will not share a 40 px line. Laid out inline — label · track ·
readout — they will, so the second row is gone and Terreng costs the same one
line every other ground costs. It is the widest subject the strip carries and
it wraps on a narrow window; that is the trade, and it is a better one than a
row that was two lines tall on every window.

**LiDAR extract** — `src/lidarExtract/LidarExtractDialog.tsx` drives style and
source selection, and that is now all it does: everything downstream of
pressing go is the picker carousel (§8.9.3), so its whole output is a list of
proposals. The sources are a wrapping grid of cards (`auto-fill`, so a single
source stays card-sized instead of spanning a 27-inch screen), the whole card
is the `<label>`, and an unchecked source is dimmed rather than hidden — which
sources cover the rectangle is itself information. Styles are chosen once for
the run and applied to every enabled source that advertises them, because the
alternative is unchecking `skyggerelieff` on each dataset in turn. The extract
is DTM-only on purpose: an extract is meant to be read as terrain.

The extent is `locality.bbox`, and the drawable sub-selection that used to sit
in front of this (`useDrawSelection`, `lidarExtractSelectionAtom`, `Tegn nytt`)
is **gone** rather than disabled — see §8.9.3. So is `LidarExtractViewer`, the
fullscreen result viewer that moved the stitched canvas DOM node into itself
with `replaceChildren`; that trap, and the `lidarExtractViewerOpenAtom` guard
it forced into `useGroundMode`'s cycling, went with it.

**Terrain** — `src/shell/terrain/`: DTM/DOM toggle, eight visualizations
(hillshade, multidirectional hillshade, VAT, sky-view factor, positive and
negative openness, local relief model, slope), and azimuth / altitude /
exaggeration / radius / Transparens sliders. Four files:

| File | What it is |
|---|---|
| `useTerrainAnalysis.ts` | All of the state — which rectangle, the DEM, the model, the visualization, the five knobs, the canvas — plus `describe()` and `beholdKey`, which is how row 2's `Behold` keeps the render (§8.9.2). Mounted **once**, from `RibbonGlobalRow`, beside `useLidarControls` and `useFlyfotoControls`. It holds no write of its own |
| `TerrainStrip.tsx` | The whole strip, and knobs only: the visualization pulldown, DTM/DOM, the sliders, the resolution readout |
| `TerrainVisPicker.tsx` | The pulldown itself, shaped like `StandardVariantPicker` |
| `TerrainSliders.tsx` | The inline slider group on it: azimuth, altitude, exaggeration, radius, Transparens |

The visualizations are **a pulldown with a W/S ring**, not eight buttons —
§5.2's call for Standard's cartographies, applied to the same kind of list for
the same reason: eight answers to one question about this ground, not eight
things to flip between. They were a `Segmented` while there were five, which is
about as many long Norwegian names as the app's tightest row can hold.

The order in `VISUALIZATIONS` is load-bearing in a way Standard's is not, and
it is a claim about cost. VAT sits directly above sky-view factor and the two
opennesses because all four are read off one horizon scan, and VAT pays for it:
walking down that stretch of the ring is free, where the same four views in
another order would each be an ~800 ms wait. The pulldown derives its two group
rules from position in the same array, so the list and the ring cannot disagree
about the order.

Each row carries a one-sentence `hint` as its tooltip (`PulldownItem`'s third
text slot, added for this) plus a short nowrap `meta` beside the label. The
sentence cannot be `meta` — that is `nowrap` by design, since a list of
wrapping paragraphs stops being scannable — and it should not be body text
either, because the explanation you want is of the option you are *considering*.

Negative openness is painted on a **reversed** ramp, like slope: the raw field
is high in a depression, so painting it straight would make it the one view in
the ring that disagrees with its neighbours about which way is down. Its
caption records the inversion (§8.10) — "these dark lines are ditches" and
"these dark lines are ridges" are different claims about the same picture.

VAT is the one view with **no** light controls: its sun is frozen at 315°/35°
and its exaggeration at 1× (`VAT_AZIMUTH` and friends in `shade.ts`). Two VAT
renders of two hillsides being the same picture made the same way is the whole
value of the thing, and offering the knobs would be offering to break that
quietly. It is also why VAT lands on the *static* side of the memo split
despite containing a hillshade.

The hook is mounted **unconditionally**, not behind `ground.modifiers ===
'terrain'`: it decides for itself whether a rectangle is being analysed, and
unmounting it whenever the strip is not showing would throw a multi-megabyte
DEM away every time someone glanced at another ground. It is also why the
light survives leaving and re-entering Terreng, which the old panel — mounted
with the dock it lived in — did not.

**Entering Terreng over a lokalitet seeds the knobs from its cover render.**
The workspace publishes the first terrain-kind attachment's spec on
`coverTerrainSpecAtom` (`src/localities/atoms.ts`) and the hook, on becoming
the active tool, feeds it to the same `restoreView` that "Gjenskap" uses. The
argument is that the second visit to a lokalitet is nearly always the same
reading as the first: someone dialled 315°/35° at a 6 m radius because that is
what showed the feature, kept the render, and comes back to look again. Opening
on the module defaults means re-finding those numbers by hand, and the render
already on file is a better guess than a constant. It is a *seed*, not a bind —
move any slider and nothing writes back; the picked spec is not consulted
again.

Seeding is **once per lokalitet**, tracked by a ref that resets when the open
lokalitet changes — with one exception: **`Lag min kopi` is a lokalitet change
that is not one** (§8.12). Swapping from an original to the copy just made of
it keeps the seed flag, because the whole reason to fork was usually the render
on screen, and re-seeding from the original's cover would throw it away in the
same tick. The test is `next.derivedFrom === previous.id`, which is why the
effect depends on the record rather than on `locality?.id` — and therefore has
to check the unchanged-id case by hand, since a rename or a bbox drag hands it
a fresh object for the same lokalitet. Re-seeding on every entrance would
silently undo an
adjustment as soon as the user glanced at another ground and came back, which
is the same complaint the unconditional mount answers. `restoreView` sets that
ref itself, which is what keeps the seed from stepping on Gjenskap: the
recreate path calls `restoreView(spec)` and `ground.select('terreng')` in one
tick, so the tool-change effect would otherwise fire *after* the explicit
restore and overwrite the render the user actually asked for.

Only the sliders the current visualization uses are rendered: two for sky-view
factor and for VAT, four for a plain hillshade. Absent rather than disabled,
because a slider that cannot move is indistinguishable from one that has no
effect.

**The radius slider is the one that commits on release**, and the reason is the
memo split below rather than taste. It is the only knob that feeds
`terrainStaticField`: streaming it for anything that walks the horizon would
queue an ~800 ms pass per drag frame and lock the tab for the length of the
gesture. `SliderRow` takes a `deferred` flag — the thumb and the readout follow
the drag, the caller hears about it on `pointerup` / `keyup` / `blur` — and
local relief, at 23 ms, streams like the rest.

Its two ends are also not the same kind of number. LRM's 60 m ceiling is a
judgement about scale; **the horizon views' comes out of the ray walk's step
budget**, `SVF_MAX_RADIUS_PX` (24). That used to be measured off the grid, so
the ceiling was 6 m on a 0.25 m DEM; `computeHorizonFields` now averages the
DEM down to at most 1 m per pixel before scanning it, which makes the ceiling a
flat 24 m at any cell size of 1 m or finer (`horizonMaxRadiusMetres`, see
`docs/terrain-analysis.md`). `radiusRange` and
`clampRadius` in `src/terrain/render.ts` are what keep the slider's bounds, the
pixels and the figure's caption agreeing on one value; before they existed the
caption printed `DEFAULT_SVF_RADIUS` unconditionally, i.e. "20 m" under a render
computed at 6 m. The hook exposes the clamped number but stores the raw one, so
a radius capped over a fine grid comes back at its full value over a coarse one.

There are **two** stored radii for eight views, and the split is by quantity
rather than by view: how far to smooth before subtracting (LRM) against how far
to look for a horizon (the four in `usesHorizon`). Switching between the two
families must not carry the number across; switching *within* the horizon
family must, or the render would change for a reason nobody asked for and the
horizon cache would miss.

**The render is on the map, not in the row.** `src/map/groundOverlay.ts`
puts the canvas down as a georeferenced `ol/layer/Image` at `zIndex: 1` — over
the background stack (which sets no zIndex at all), under the lokalitet
rectangles (4), the funn (5) and the theme layers (10). That ordering is the
point: relief is the ground and the heritage record goes on top of it, which is
the same argument that makes LiDAR hillshade a *background* rather than a theme
layer. Scrubbing the light therefore re-lights the terrain in place, at full
size, against everything else on screen. What is left on the ribbon is knobs
and a resolution readout.

**That level is shared, and it is a stack.** A stored bilde laid into the
lokalitet's rectangle wants the same `zIndex: 1`, and for a while the two took
turns: the
module carried an `owner` tag, pinning stood the render down, entering Terreng
unpinned the image, and the displaced side was told so through a subscription.
That arbiter is **deleted** (§15, and `docs/lokalitet-view.md` §13), because it
forbade the one comparison the overlay exists for — a 1937 ortofoto faded over
today's relief is two images of one rectangle, in register.

What replaces it is a declared set, **ordered by the row**. Contributors name
themselves by key — `setGroundOverlay(key, member | null)`, where `key` is
`TERRAIN_KEY` for the live render, `view:<attachment id>` for a View and
`bilde:<attachment id>` for a File — and
the module paints them bottom-to-top into **one layer and one canvas**, each
with its own `globalAlpha`. One layer rather than one per member because the
members are an ordered composite with per-member opacity, which is what a draw
loop is, and because the reused output canvas is ~30 MB; one per member would
multiply that by the size of the composition. Withdrawing is unconditional,
since a contributor owns its own key and nothing else's.

**Producers declare, the row orders**, and the split is forced rather than
chosen: the contributors live in different trees — Terrenganalyse's state is
mounted once from `RibbonGlobalRow`, a View's from the lokalitet row — so
there is no component above all of them to hand over the whole array the way
`sketchOverlay.ts`'s single caller does. `setGroundOverlayStack(group, keys,
held)` is the row's half: the members bottom to top, and which of them the row
is holding down. Keys nobody has named paint *above* everything that was,
in declaration order.

**The stack is keyed by group, because there are two of them and they are
siblings.** `VisningControl` and `BildeControl` (§10.1) each declare their own
half — `'visning'` and `'bilde'` — and neither can speak for the other, since
the split that forced the producer/row divide in the first place applies again
one level up: the two controls sit side by side on the lokalitet row with no
component between them that could hand over one array. So the relative order of
the *groups* is a constant in the module, `GROUP_ORDER = ['visning', 'bilde']`,
which is the layer row's own left-to-right order written once where the draw
loop can read it. The held set is the union of both groups' — a key is held if
whoever declared it says so.

The alternative was a third caller above both, which would mean a component
that exists only to own an ordering that never changes. A constant that says
the same thing is the smaller object, and it is in the file that has to obey
it.

**Held is not withdrawn.** A member's own switch withdraws it: the producer
unmounts and the pixels go. The group label and the ground preset have to take
down members *somebody else* declared — the terrain render is row 1's — and
give them back unchanged, so those are named in `held` and skipped in the draw
loop instead. Per-member alpha is remembered in `opacityByKey` and deliberately
never pruned: switching DTM→DOM withdraws the terrain image and declares a new
one, and losing the fade you had just dialled in on the way through would be a
bug.

The compare curtain's B half is at `COMPARE_Z = 1.5` and therefore covers this
whole group, unchanged from when the group was one image and still what the
curtain is for: the B half is another *full* ground, and what it is dragged
over is everything the A side has composed.

That is also the argument for the sliders being **on the strip** rather than in
a popover anchored to it, which is what §5.1's one-line contract would
otherwise ask for. They have to stay on screen while they are being dragged —
sweeping the azimuth to see which bumps stay lit is the single most useful
thing the tool does — and a popover over the map covers the wrong half of the
screen to do it in.

Three details of the inline layout are load-bearing:

- **The readout follows the track, at a fixed width.** It is after the thumb
  now rather than above it, so letting it size to its content would shove the
  thumb sideways as the value went from 5° to 315° — mid-drag, under the
  finger doing the dragging.
- **The track shrinks to 64 px and no further**, and the strip wraps instead.
  A slider that cannot be swept is not worth the line it is on, and travel is
  the whole point of these four.
- **The `<input>` carries its own `aria-label`.** The label beside it is a
  `span`, not a `<label for>`; it was a `span` in a head row above the track
  before, where it named nothing either.

`TerrainStrip` is rendered into the strip **without** a `group` wrapper, unlike
the LiDAR and Flyfoto pickers. Terreng brings the most controls of any subject
and holding them on one unbreakable line is what would push the strip off a
laptop, so it lets its controls wrap. `Segmented`'s `wrap` prop went with the
column — it existed only to keep five long Norwegian names from being clipped
mid-word by the root's `overflow: hidden` in 360 px, and the ribbon rows wrap
between controls instead of inside one.

Consequences worth knowing:

- The layer is **imperative and module-level**, like `swapBackgroundLayers`, not
  an atom plus a hook. The pixels change on every slider frame and the opacity
  on every drag of its own; pushing either through jotai would re-render the
  whole shell dozens of times a second for a change no component needs to see.
  `setGroundOverlay` / `setGroundOverlayOpacity` is the whole surface.
- `setGroundOverlay` is put up, move, repaint *and* take down in one call,
  because `ImageCanvasSource` caches one image and `changed()` is the only way
  to invalidate it — the canvas element identity never changes, since the hook
  repaints in place.
- The source's output canvas is **reused** across frames rather than allocated
  per call (which is what OL's own docs bless `changed()` for): a viewport-sized
  canvas is ~30 MB at devicePixelRatio 2 on a 4K display, and a slider drag
  would allocate one per frame.
- `imageSmoothingEnabled` is off while zoomed in past native DEM resolution and
  on while zoomed out. Smoothing on upscale blurs away exactly the single-pixel
  step — a ditch edge, the lip of a mound — the visualization exists to show.
- The source pins `projection: 'EPSG:25833'`, so the render is reprojected
  rather than misplaced when the view is in one of the app's other projections.
- The image extent is derived from `dem.width/height × metresPerPx`, not from
  `dem.bbox25833`: the grid is sized from the bbox *width*, so the last row
  lands a fraction of a pixel short of the southern edge.
- A **Transparens slider** joins the light controls. Fading the render towards what
  it covers is the only way to check a suspected feature against the ortofoto or
  the topo map without losing the light you just dialled in. It is hook state
  mirrored onto the layer, and the remembered value survives a DTM→DOM rebuild.

**There is one rectangle, and it is the open lokalitet's.** `bbox` is
`locality && tool === 'terrain' ? locality.bbox : null` and nothing else —
read straight off the record rather than copied into an atom, which is what
makes "Juster området" refetch the DEM for free.

There used to be a second entrance: `useTerrainViewport` framed the visible map
into a free-floating `terrainStandaloneBboxAtom`, `useTerrainAnalysis` resolved
the two, "Flytt analysen hit" re-framed the loose one, and a `Lagre` of its own
turned it into a lokalitet on the way out. All of that is gone
(`docs/lokalitet-view.md` §8, §15). Pressing Terreng or `5` with nothing open
places the lokalitet *first* (§5.3, §5.6), so by the time a DEM is fetched there
is exactly one answer to "what am I analysing" — and two controls for one
surface disagreeing about which rectangle a save keeps, which is what the old
row-2 duplicate cost us, cannot come back. `then: 'terrain'` on the placement is
what carries the intent across: the tool is armed at the commit, and only on a
create that worked.

The rectangle is `viewportBbox`'s **inset** viewport as *placed* — the seed
still stops short of the screen edges, the free area is what `chromeInsets`
reports, and the visible margin doubles as the affordance for exactly which
ground is being analysed — and then moved and sized by the author inside the
size band, which is now what keeps a DEM request to something the browser can
shade (§5.6).

**There is no close button, and that is not an omission.** Terreng is a ground:
you leave it by picking another one from the ring, or by pressing its digit's
neighbour, and leaving costs nothing because the background underneath was
never switched off (§5.1). The column the tool used to live in had to have a
close control, since a panel that will not go away is a panel covering the map.

**The strip has no actions at all.** Keeping the render is `Behold` on the
lokalitet row (§8.9.2) — one verb for whatever ground is up, rather than a save
button per ground — and the rectangle belongs to "Juster området". The strip
holds knobs and what the DEM says about itself, which is what a settings strip
is for.

The one thing the hook publishes for that write is **`describe()`**, read by
`Behold`'s terrain arm through the callback on `beholdOfferAtom`. One place
decides what a terrain View's caption and `meta` say. It used to be `produce(subject?)` and used to hand back a finished figure;
since the View/File split (§8.7.4) a terrain render is stored as a spec and the
pixels are the pin queue's job, so the hook describes and never renders. The
`subject` argument went with the pixels — it was the figure's title line.

Two things in `useTerrainAnalysis` must not be undone:

- The sliders are **raw `<input type="range">`** (`SliderRow` in
  `TerrainSliders.tsx`) rather than a component-library slider: sweeping the
  light smoothly needs a continuous input stream during the drag, and the
  numeric value is rendered beside the track anyway. They are safe from W/S
  cycling because `useBackgroundCyclingKeys` bails on `INPUT` targets — which
  matters more now that they sit on the ribbon, inches from the ring.
- The `useMemo`s are **split on purpose**: the horizon scan takes ~800 ms on a
  600² grid and must never be keyed on azimuth, or dragging the azimuth slider
  queues a multi-second recompute per frame. Radius is on the other side of
  that line — it is a *key* of the expensive memo, which is exactly why its
  slider is the deferred one. The split survives the move
  of the arithmetic into `src/terrain/render.ts` — that module exports
  `terrainStaticField` (expensive, sun-independent) and `terrainField` (cheap,
  sun-dependent) as *two* functions for exactly this reason, and the hook
  memoizes each. Its one-call `renderTerrain` is for headless callers with no
  slider to drag (§8.9).
- There is now a **third** memo above those two, holding the horizon scan
  itself, and its keys are the subtle part: `[dem, usesHorizon(vis),
  horizonRadius]` — deliberately *not* `vis`, and clamped through `'svf'`
  rather than through `vis`. Both are what make the four horizon views resolve
  to one cached triple, so W/S between them is a selection out of an array
  instead of a fresh pass. Key it on `vis` and the ring silently costs 800 ms a
  step; the render looks identical, which is what makes it worth writing down.

The canvas itself is **off-DOM**. React does not own it and neither does any
row: it is the OL source's image, and the hook paints into that one element.
Same trap the deleted extract viewer's moved canvas node was, from the other
direction. Note that it is no longer what a save hands to the figure stage —
the pin queue calls `renderTerrain` headlessly and gets its own canvas, which
is what lets a pin outlive the strip that started it (§8.7.4).

Neither tool's output leaves bare. "Behold", the picker card's `Last ned` and
"Lagre" all reach `renderFigureBlob` — so the azimuth, altitude, z-factor,
radii and stretch
that produced it travel with the pixels (§8.10). On the no-lokalitet path the
lokalitet is created *before* the spec, so the name the registers just derived
can be its title.

The algorithmic side of all this is `docs/terrain-analysis.md`; the ribbon rows
are only the control surface.

### 10.1 `[Visning ▾]` and `[Bilde ▾]` — the ground as two layer groups

The terrain render is no longer a thing that happens to be on the map; it is a
*member*, and the member list has a control. `src/shell/VisningControl.tsx` is
the leftmost of the lokalitet row's layer groups (§8.1,
`docs/lokalitet-view.md` §13.10 step 5) and its pulldown lists, bottom to top:

- **the ground preset** — whichever of the five is on screen, named with its
  own label (`ribbon.mode.*`, or `ribbon.terrain.label` for Terreng) and
  carrying what `beholdOfferAtom` says is under it: the LiDAR dataset and
  style, the NiB acquisition, the terrain visualization's caption. §13.4 asks
  the row's label to be the whole on-screen provenance, and that atom is
  already the one thing row 1 publishes about the live ground.
- **every View in the lokalitet** — `kind` of `extract` (which includes terrain
  renders) or `flyfoto`, each put up by `useGroundView` over its own rectangle,
  each with a switch, a fade and a `Gjenskap`.

Reading down the list is reading *up* the stack, which is the row's own claim
about left-to-right carried inside the group.

**What each switch does.** A View's switch mounts or unmounts a `<GroundMember>`
child, so switching off withdraws the member and stops the work — the point
being that switching one on can start a WMS stitch, which is also why
`visningShownAtom` starts empty and a lokalitet never opens N of them. The
group label and the ground preset instead *hold* what they cannot withdraw
(§10, above), and the preset additionally takes the background stack down
through `setBackgroundHidden` in
`map/layers/config/backgroundLayers/utils.ts` — `visible: false` on every
`bg.` layer, which stops tile loading while keeping the tiles already
fetched, so switching back is free. Scoped to `bg.` and deliberately not
`cmp.`: the curtain's B half is another full ground.

So **the map can have no ground at all** — a sketch and its funn on white, with
nothing underneath arguing. That is the one reading where "off" means something
for this group, and it is why the preset is a member rather than a sixth ground
mode.

**The preset has no fade.** `LayerMember.opacity` is optional and the preset
omits it: the background is a stack of tile layers, so a slider here is three
fades and not one, and the grounds that can be faded are faded from the
settings strip where all their other modifiers live.

**`Gjenskap` lives here now.** It left the bilde cards (§8.7.1) and became each
View row's trailing `restart_alt`, setting the same `recreateViewAtom` — so
`useRecreateView` is untouched. Every row in this list has a view behind it by
construction, so the "absent where there is nothing to go back to" case the
button needed is gone with the button.

The control atoms are in `map/groundOverlay.ts`, beside the mechanism they
drive: `groundShownAtom`, `visningShownAtom`, `visningOpacityAtom`,
`visningGroupShownAtom` for this group and `bildeShownAtom`,
`bildeOpacityAtom`, `bildeGroupShownAtom` for the next. None is persisted —
which members are on is view state, not curation — and `useLocalityWorkspace`
empties all of them when the lokalitet closes or swaps, while the control puts
the background back on unmount. Nothing here writes, so there is no stance
gate: a reader gets the group in full. What it *lists* is stance-sensitive for
one reason only — `hidden` records are in the list in edit and out of it in
show, which is §13.8's rule and the same one `bilderItems` applies.

#### `[Bilde ▾]` — the Files, one group up

`src/shell/BildeControl.tsx` (`docs/lokalitet-view.md` §13.10 step 6) is the
same control minus two things, and the subtraction is the whole design: there
is no ground preset, because there is only one ground and [Visning] holds it;
and there is no `Gjenskap`, because a File has no spec to re-run. What is left
is exactly a `LayerMembers` list — a switch and a fade each — over `fileItems`.

What it lists is either File — `screenshot` or `upload` — with bytes and a
`meta.bbox25833`, filtered for `hidden` the same way. A screenshot has that
extent because the app took it, over a rectangle it chose; an upload has one
only once somebody has pressed `Plasser i ruta` on its card (§8.7.2, step 7).
So the `bbox25833` test, which was already here doing the job of "a switch must
be able to do something", is also the whole of the upload gate. An upload is
not a second case in this list; it is the same case arriving later.

**A placed upload's row is marked.** `LayerMember.note` is `warning`'s quiet
sibling — the same line under the label, an `info` glyph, the subtle colour
rather than the danger one — and it carries *Antatt utstrekning*. The two are
separate because they are read at different volumes: a warning says the row is
lying about being on the map, a note qualifies what being on the map means for
this member. An extent the app invented must not sit unmarked beside an
extract's measured one (`docs/lokalitet-view.md` §13.5).

**The group is absent on a lokalitet with no Files**, the call `SkisseControl`
already makes: a group control over nothing cannot answer the only question it
is asked. Its hooks still run first, so the empty stack is declared before the
`null` return — a group that renders nothing still has to say it is holding
nothing.

**Its list is grouped by funn, and so is [Skisse]'s** — §10.3, and the grouping
is a paint order as well as a heading.

**The two share their member machinery**, in `src/shell/groundMembers.tsx`:
`GroundMember`, the child whose mount *is* the member (it calls `useGroundView`
and takes the pixels down on unmount), and `useLayerFailures`, the small
collector under it. One file rather than two so that "a member on the map is a
mounted component" cannot come to mean two different things one group apart.

**`LayerMember.warning` is where "switched on, nothing arrived" is said.**
`useGroundView` already returned `failed`; before step 6 the only surface for
it was a note under the selected card, which went with the rail's ground verbs.
So the warning moved onto the switch that is claiming the layer is up —
an `error` icon and a line of text inside the member's label — and [Visning]
gained the affordance in the same step [Bilde] would otherwise have lost it. A
View falls through to a live render before it is allowed to fail at all
(§8.7.1), so in practice the warning means the upstream has nothing over this
rectangle, or a File's bytes will not decode.

### 10.2 `kind: 'scene'` — the arrangement itself, kept

Four groups and a fade each mean a composition can be built by hand: a 1937
ortofoto at 40 % over a sky-view render with a sketch on top. A **scene** is
that composition stored as *what it is made of* rather than flattened to bytes
— `docs/lokalitet-view.md` §13.7, §13.10 step 8, and `src/localities/
sceneSpec.ts` for the shape.

It is an `attachments` row, so it inherits `sort`, `hidden`, `caption`, the
copy and the pin queue, and migration `1700000800` adds **no field**: `over`
holds the membership as a relation and `meta` holds `{bbox25833, ground,
layers: [{id, opacity}]}` bottom-to-top. Both halves name the same ids and
neither is derivable from the other — a relation cannot carry an order or a
percentage, and JSON is not a relation, so a member deleted from under a scene
leaves it standing with one fewer layer. The ground is the one member that is
not a record ("Flyfoto" is the live ortofoto ground), so it is stored as the
`{kind, meta}` pair a `Behold` of it would have written and read back by
`viewSpecOf` with no special case; Standard and Hybrid store no ground at all,
for the reason `Behold` refuses them, and a scene built over one flattens onto
white paper.

**A scene is not a layer.** Group membership is decided by `kind` and nothing
claims `'scene'`, so it has no switch in any pulldown, `groundView` answers
`null` for it, and the closed ground list in `sceneSpec.ts` excludes it — a
scene inside a scene is unrepresentable in the record rather than merely
unreachable.

**Its two verbs, and where they are.**

- **`Oppsett`** on the lokalitet row, beside `Behold` (§8.9.2): `Behold` keeps
  the bottom layer, this keeps the stack over it. A write, so `canAdd`, and
  buffered into the edit transaction like every other keep. Disabled rather
  than hidden when there is nothing on the map to keep.
- **`Legg ut igjen`** on the bilde card, in both surfaces: it replaces the
  three shown sets, merges the three fade maps (`opacityByKey` is never
  pruned), switches the three groups on, and sends the ground through
  `recreateViewAtom` — the same path [Visning]'s per-row apply takes. A read,
  so both stances and a reader get it in full, which is what a shared scene is
  for. Members that have since been deleted are simply missing and the toast
  says how many.

Neither is in the layer row, and that is §13.8 rather than an accident: nothing
in the row writes, and the row is where an arrangement is *made*. Restoring
also deliberately never blanks the ground — a scene over Standard and a scene
with the preset switched off record the same nothing, and the map always has a
ground.

**Its pin is the flatten**, and it is the first producer in `pinQueue.ts` that
renders *other records*. It does not composite the members' figures — a caption
panel inside a composite is a picture of a card — it asks `groundRasterOf` for
each member's ground pixels, which is the pin where there is one and a live
render where there is not, exactly as the map does one level up. A sketch is
the exception: its figure is on white paper, so it is re-rendered transparent
at the sheet's resolution instead. Resolution is settled once before anything
is drawn (the sharpest member's own `metresPerPx`, floored at 1500 m / 6000 px)
and members are composited one at a time, so peak memory is the sheet plus one
member. The figure's settings line is the stack itself, bottom to top, each
layer with the fade it was seen through, and its credits are the union of its
layers' — a layer whose pixels did not arrive is left out of both the caption
and the picture, and a scene where nothing arrives pins `empty` rather than
`failed`.

### 10.3 Which funn a bilde belongs to — the relation, and the grouping

A funn is a sublocation *and* a container (`docs/lokalitet-view.md` §13.6,
§13.10 step 9). `attachments.funn` carried half of that already — the sketch's
"what this drawing is about", seeded and uneditable (§9.3) — and step 9 widened
it to **which funn this bilde belongs to**, on every kind, with **no
migration**: same column, same uncascaded multiple relation, a different
question asked of it. The two roles stay orthogonal. A funn is named, statused,
addressable, in the ↑/↓/Enter list and on the map whether or not anything hangs
off it.

**`src/localities/funnGroups.ts` is the whole reader side**, and it is one file
because three call sites must not disagree:

- `funnIdOf(rec, known)` — the answer, or `null`, **including when the record
  names a funn that no longer exists**. The relation does not cascade on
  purpose: deleting a funn must not delete the photographs of it, and the
  images falling back to the lokalitet is the right behaviour — but only if
  every reader treats a dangling id as no answer. That rule is this function
  and nowhere else.
- `funnGroupsOf(items, finds)` — the lokalitet's own images first, then one
  group per funn in the funn list's own order (creation order, so a rename or a
  restatus does not reshuffle the map), empty groups dropped.
- `orderedByFunn` — the same order flattened, for a caller that paints rather
  than lists — and `funnSectionsOf`, the headings by record id, `null` where
  there is only one group because a single heading over the whole list names
  nothing.

**One answer, in a multi-valued column.** The editor writes at most one id and
every reader takes the first one it recognises. The field stays a multiple
relation because that is what it already is and because nothing has ever
written more than one, so no stored record is being reinterpreted — and because
"about these funn" is a plural idea that may yet want the room.

**The editor is on the card, not in the row.** `BildeFunnPicker` in
`bilderCommon.tsx` is a `Menu` over *Lokaliteten* plus every funn, leading the
verb row in `BilderCarousel` (§8.7.2) and absent for a reader, in show, and on a
lokalitet with no funn. It writes through `ws.setBildeFunn`, which is
`patchBilde` with a fourth column, so it is buffered into the edit transaction
like a caption and translated at commit like a spec's (§8.11). Funn tombstoned
in this session are left out of the options, since the commit's `resolve` would
drop the relation anyway. The answer is readable in both stances as a badge on
the detail line: where an image belongs is part of what the exhibit says.

**The grouping is a paint order, not a sort.** §13.1's one teaching claim is
that position in a pulldown is depth on the map, so a group that re-ordered its
list for display alone would contradict the row on the same screen it makes its
claim. `BildeControl` therefore derives `keys` for `setGroundOverlayStack` from
the grouped list, and the sketch overlay effect in `useLocalityWorkspace` walks
`orderedByFunn` before calling `setSketchOverlays`. Bottom to top it reads as
*the lokalitet's own layers, then each funn's over them*.

**`LayerMember.section` is how a heading gets into a list of switches.**
`LayerMembers` emits a sticky heading whenever a member's section differs from
the one above it — no nesting, no collapsible group inside a pulldown that is
already a popover. [Visning] is deliberately ungrouped: its bottom member is
the live ground preset, which belongs to no funn, and a single *Lokaliteten*
heading over the rest would be a heading that says nothing.

---

## 11. Icons, and the build gotcha

`icon="…"` props are typed against `MaterialSymbol`, re-exported by
`src/ui/Icon.tsx` from `material-symbols` (a direct dependency since kvib
went). A plausible-looking name that is not in that union **fails the
docker build**, and plenty are missing: `terrain`, `filter_hdr` and `topography`
do not exist; `elevation`, `landscape` and `altitude` do.

There are no local `node_modules` to check against, so validate a new name by
pulling the tarball:

```
curl -sL https://registry.npmjs.org/material-symbols/-/material-symbols-0.40.2.tgz \
  | tar xz -O package/index.d.ts | grep '"terrain"'
```

---

## 12. The migration off kvib, and what it settled

**Done.** `@kvib/react` is no longer a dependency. Ported to `src/ui`: the
whole shell and ribbon, the lokalitet surfaces (`FunnList`, `BilderStrip`,
`LocalityDetails`, `LocalityDialogs`,
`LocalitiesPanel`), both analysis panels, `AuthButton`, `AuthDialog`,
`ErrorBoundary`, the measure trigger, the toast region, `MapComponent`,
`SearchComponent`, `KulturminnerPopup`, `BilderPicker`, `MapToolCards`,
`HelpPage`, `LanguageSwitcher`, the whole of
`src/search/**` — results panel and infobox — and the whole of `src/draw/**`.
So `src/terrain/`, `src/settings/`, `src/auth/`, `src/lidarExtract/`,
`src/localities/`, `src/help/`, `src/languageswitcher/`, `src/search/`,
`src/draw/` and `src/map/` are all clear. (`src/draw/` has since been deleted
outright — §15 — which is worth reading as a note on this whole section: the
largest thing the port carried across turned out to be the thing the fork did
not need.)

The kit needed nothing more to absorb the last of it. The wanted-primitives
list used to say `Accordion`, `Select`, `Pagination` and `Alert`:

- **`Accordion` is not coming.** Every kvib accordion in this app is
  `collapsible multiple`, i.e. a stack of independent disclosures, which is
  exactly the controlled `Section` the workspace already uses. The call site
  owns the open set (a `string[]` in `InfoBoxSections`, a single
  `string | null` per card in `HelpPage`) and gets
  `lazyMount`/`unmountOnExit` for free, because `Section` never renders a
  closed body. `FeatureInfoSection` was the one place that read the
  container's state rather than owning it — `useAccordionContext`, to open
  itself on a single hit; with a controlled section that is just
  `onOpenChange(true)`.
- **`Select` is not coming either.** The language picker is a native
  `<select>` (`src/languageswitcher/`), and the other candidate — the draw
  point-style picker — turned out not to want a list at all: its options *are*
  glyphs, which a native option row can only name in English slugs, so it is a
  `Popover` holding a grid of them. Anything else that wants a richer list goes
  the same way.
- **`Pagination` is not coming.** One consumer — place names are the only
  result set the API pages — so the prev/status/next row lives inline in
  `PlacesResults.tsx`.
- **`Alert` was built** (`src/ui/Alert.tsx`, `info` / `warning`): a standing
  remark in the flow, as opposed to `toast`, which is a reply to an action.
- **`Menu` was built later** (`src/ui/Menu.tsx`), and is the one addition the
  list above did not anticipate. kvib's menu was the thing this app fought
  hardest — "custom disclosures instead of menus for the pulldowns", below —
  so the migration deliberately shipped none, and the ribbon then grew four
  hand-rolled ones: `OverflowMenu` and `HentMenu` in `RibbonLocalityRow`,
  `StatusPicker` and `RowMenu` in `FunnList`. The `.menu` / `.menuItem` /
  `.menuTitle` block was copied verbatim between the two stylesheets, and one
  copy's comment said so.

  It is a list of *verbs*, which is why it is not the `Select` above: a
  pulldown that picks a dataset stays a `Popover` with bespoke content, and
  the `Funn` control — a `Popover` holding `FunnList` — was left alone for
  the same reason. Three things it owns that the call sites were each re-deriving:
  holding `open` (the trigger is a render prop, as on `ConfirmPopover`, and
  gets `{ open, onClick }`); closing itself *before* the verb runs; and
  `stopPropagation` at the panel boundary, since the panel is portalled but
  React events still bubble the component tree, and two of the four sit in a
  clickable row.

  **`confirm` on an item is why this is not `ConfirmPopover`.** A destructive
  item that opened a second popover would stack two overlays over the thing
  being deleted, so `confirm` swaps the menu's own body for the question in
  place. `ConfirmPopover` stays for a destructive *button*; `Menu` for a
  destructive *item*.

  Items are data (`items: (MenuItemSpec | false | null | undefined)[]`), not
  children, so no context is needed — the kit has none — and a conditional
  item is `ws.canAdd && { … }` inline. The falsy slots stay put, which is what
  makes the array index a stable key.

- **`Popover` learned to flip**, and only because the bottom edge grew
  controls. It was written for the ribbon — every anchor on the top edge of the
  window, so "below the anchor, clamped, as tall as the room left" needed no
  placement solver. Then the dock went and the bilder rail took the bottom edge
  (§8.7.2): the `Slett bildet` confirm dropped *downwards* out of a button
  sitting 40 px off the floor, got a `maxHeight` of about that, and became a
  scrolling sliver of a two-line question. So one rule was added and no more:
  when the panel does not fit below and there is more room above, it opens
  upwards. Anything anchored at the top is unaffected, since there is always
  more room below it. The one detail it needs to be true: the natural height is
  read off `scrollHeight`, not `offsetHeight`, because after the first pass the
  offset box *is* the clamped one and re-measuring it would latch the cramped
  answer for the rest of the session. A panel that changes size after it opens
  is still measured once — `Menu`'s in-place `confirm` is the only body that
  does, and all four `Menu`s hang off the top edge, so none of them flips.

Layout and typography need nothing — see §2 on why there are no
`Box`/`Stack`/`Text` primitives.

Two decisions taken to keep that list short rather than long:

- **The drawing import/export dialogs went rather than being ported** — done;
  ~900 lines, the nautical-mile unit and the only call for a `FileUpload`
  dropzone with them. Rationale and the one live thing that had to be rescued
  first: §9.
- **The colour picker became `<input type="color">` plus the existing recent
  swatches**, not a hand-built saturation/hue/alpha surface. That was the single
  largest component the migration would otherwise have owed. Alpha it does owe:
  see §9.

**What removing it bought.** Chakra, emotion, the `@zag-js` machine set,
`react-select`, `react-day-picker`, `react-aria`, `react-stately`, `date-fns`
and `react-icons` are all off the dependency graph. And the CSP directive that
was waiting on it is tightened: `style-src` is `'self'`, since nothing injects
a stylesheet at runtime any more. Inline style *attributes* still need
`'unsafe-inline'` — React sets positions, sizes and picked colours that way —
so that is now its own `style-src-attr` directive instead of a hole in
`style-src`.

The specific places kvib was fought rather than used, which is what motivated
`src/ui` in the first place, and which the ported code now solves properly:
custom disclosures instead of menus for the pulldowns (two-line rows, badges,
hover previews, tiering); raw range inputs instead of the kvib slider for drag
performance; hand-rolled `ConfirmPopover` / `Segmented` / `NoteInput` /
`WorkspaceSection`; `zIndex: 9999` on the language switcher because kvib's
portal layering lost to the header; literal hex colours where a token belonged.

One inheritance from kvib survives on purpose: the `[data-scope="…"]`
selectors in the keyboard layers (§1, §8.4). kvib's Ark primitives set those
attributes and `src/ui`'s `Popover` and `Dialog` set the same ones, which is
what let the contract hold across the migration instead of having to be
replaced in one go. Keep setting them.

**The strip itself**, for the record, since it is the part that could not be
tested locally:

- Two of kvib's own dependencies were promoted to direct ones.
  `material-symbols` was already imported by `src/mainApp.tsx` while merely
  transitive; `@fontsource/mulish` was not imported anywhere at all — it
  arrived through kvib's theme and would have vanished silently. It is now
  four explicit weight imports (`latin-400/500/600/700`), which is what the
  kit's stylesheets ask for.
- `<KvibProvider>` supplied Chakra's preflight. `src/index.css` took over with
  a deliberately small reset plus the `font-family`; every ported surface
  already sets its own margins and sizes, so what is there is parity for the
  elements the modules do not reach.
- The `MaterialSymbol` union moved to `material-symbols`' own `index.d.ts`
  (`type MaterialSymbol = MaterialSymbols[number]`), one line in
  `src/ui/Icon.tsx`, because every import in the app already pointed there.
- The Dockerfile runs `npm ci`, which fails on a package.json/lock mismatch,
  and the workstation cannot run `npm install`. Both packages were already
  locked as `node_modules/*` entries, so the edit was `package.json` plus the
  root `dependencies` block of `package-lock.json`, by hand and in step.
- `package-lock.json` was then pruned the same way, in a second pass once the
  build was known good: 262 of its 507 `packages` entries — kvib, Chakra,
  emotion, Ark, the whole `@zag-js` and react-aria/react-stately sets,
  `react-select`, `react-day-picker`, `date-fns`, `react-icons` — were
  unreachable from the root's dependencies. `npm ci` was installing every one
  of them into the build stage, and a vulnerability scanner would still have
  read them as ours. Pruning by hand means reimplementing npm's
  `node_modules` lookup (walk up from the importer's path) to compute
  reachability, deleting what it does not reach, and then re-running the same
  resolution over the *result* to prove every surviving package's declared
  deps still resolve. Every kept entry stayed byte-identical and in order, so
  the diff is deletions only. Whoever next has a toolchain should still run
  `npm install` once and check it produces no diff.

---

## 13. The functionality contract

Everything a user can do today. A replacement is not done until each line has a
home. Grouped by intent rather than by current location, since the current
location is what is being thrown away.

**Navigate the map**
pan (drag, arrow keys); zoom (wheel, pinch, double-click, keyboard); read the
scale bar; F11 fullscreen; deep-link to a view via `?lat/lon/zoom`.

**Find a place**
search place names; search addresses; search cadastral properties; filter the
search by source; clear the search; select a result (marker + fly-to + InfoBox);
arm Stedsinfo (button or `I`) and click the map for a coordinate + elevation
readout.

**Choose what the terrain looks like** — the core of the tool
switch Standard / LiDAR / Hybrid / Flyfoto / Terreng, by button or by digits
1–5; hold X to peek at the ground you were on before and release to snap back;
draw Standard as any of five cartographies — the topographic map, its greyscale
twin, the scanned paper series, the nautical chart, or the nineteenth-century
amtskart series over a modern base where that survey never reached;
pick the national mosaic or any per-project LiDAR dataset; see datasets ranked
by relevance to the current viewport and expand to the less relevant ones;
preview a project's footprint on hover; pick a render style and expand to the
full style list; switch DTM / DOM; draw contour lines over the hybrid
overlay, to put metres on the relief the hillshade is only shading; pick the
seamless ortofoto mosaic or any
historical acquisition covering the viewport; narrow those acquisitions to one
period of the archive so both the list and the keyboard ring walk only it;
cycle styles with A/D, the active
mode's datasets with W/S, model with E, without opening any pulldown or
occluding the map; put a second ground on the right of a draggable curtain
(Sammenlign) and then describe *either* half with the whole of row 1 and its
strip — ground, cartography, dataset, style, DTM/DOM, hybrid, contours,
A/D/W/S/E —
switching between
them with the A|B control or C, so one acquisition can be compared against
another of the same ground; drag the seam with the pointer or nudge it with
the arrow keys once it has focus, and leave to take the second stack back down;
hide the funn with H or the `Funn` button so they do not cover the ground you
are judging, and bring them back the same way.

**Overlay the heritage record**
put the whole overlay on the map or take it off with the eye on `Kulturminner`,
one press, which also arms the register most readings start from when nothing
is on yet; open the popover beside it and switch any of the five
Riksantikvaren services on or off
individually; see the active-source count on the trigger; clear them all; pick
which of kulturminner2's three registers (lokaliteter / enkeltminner /
sikringssoner) are drawn; draw them as outlines or filled; narrow the map to one
vern class (fredede, verneverdige, listeførte, uten vern, uavklart); dim the
whole overlay with a slider so the relief under it stays readable; with
the overlay on, click a heritage feature for its attributes — no tool to arm
first; deep-link all of
it via `?themeLayers`,
`?heritageDetails`, `?heritageRender` and `?heritageOpacity`.

**Measure**
distance and area, with live on-map tooltips; clear the measurement.

**Own an area**
sign in (OAuth or password); propose a lokalitet's rectangle from the visible
map, move it and resize it by any corner or edge against the terrain with the
readout tracking the hand,
and create it — or cancel with nothing written — and have it named after the
nearest stedsnavn; be stopped at 1500 m and 50 m per side, and told which limit
and what it is; rename it; describe it; read and edit its
sted, kommune and matrikkel, pre-filled from the registers; re-ask the registers
for them after moving the rectangle; read its centre coordinate and area; search
your lokaliteter by any of those; set visibility (private / limited / public);
adjust the rectangle afterwards (translate + modify); edit it in a session you
end yourself — **Lagre** as often as you like without being put back into show,
**Avbryt** back to the last save, offered only when there is something to
discard, and **Avslutt** when you are done, with any unsaved work named and
three ways past the question; delete it; frame the map
back on it by clicking its name or from the row's `⋮`; browse "Mine
lokaliteter"; click a rectangle on the map to open it; see which known
kulturminner already fall inside it; read its details in a dialog off the
row's `⋮`; copy a link to it with **Del** from the same menu, in either
stance and whoever you are, and be told at that moment whether anybody else
can open it; follow one and land on the lokalitet, framed on its rectangle and
in show, after signing in if you were not; on somebody else's, press **Lag min
kopi** and get the rectangle,
the details, every funn and every image the app can make again as a private
lokalitet of your own, with the original named in the banner and one press away
— and the screenshots and uploads that stayed behind still shown at the end of
the carousel, one **Ta med** each.

**Record what you find**
arm the pen over the map itself — frozen, not photographed, and zoomable under
the canvas without asking Kartverket for a tile — and have the first finished
shape become a buffered funn, auto-named; draw it as line, rectangle, ellipse,
arrow or freehand, with every change written back on its own; undo/redo; rename
a funn; note it; set its status (mulig / sannsynlig / avkreftet / rapportert);
re-edit an existing funn's drawing; zoom to it; walk the funn list with
↑/↓/Enter; click or hover a funn on the map to select it in the list, and the
reverse; take the whole set off the map (`H`) or one funn at a time, in either
stance, without that being a change to the record; grow the lokalitet when a
funn escapes it, unless that would take it past the size band.

**Draw over what you are reading**
put a hand-drawn overlay on the ground with the full Excalidraw tool set and
keep it as a transparent bilde registered to the ground it was drawn on; switch
any number of them on and off over any background, so an interpretation can be
held against the relief and then taken off it; have the drawing come up with
the image or the funn it was made about; and flatten whatever composition is on
screen — ground, every layer-row member that is down, sketches, heritage
layers, funn — into one screenshot.

**Analyse it**
run terrain analysis (DTM or DOM) with eight visualizations — pulldown or W/S —
and live azimuth / altitude / exaggeration / Transparens, plus a smoothing or
horizon-search radius for the five views that have one, over the open
lokalitet's rectangle — or, with none open, over one placed for the purpose on
the spot (§5.6) — with the render drawn on
the map under the heritage layers and every knob on the ribbon's settings strip
rather than in a column beside the map; change what is analysed by moving the
rectangle itself, under "Juster området"; press **Behold** to keep whatever ground is on screen
— the LiDAR stitch at the dataset and style you are reading, the terrain render
at the knobs you set, the ortofoto acquisition you picked — at the source's own
resolution rather than as a photograph of the screen, with the button reading
**Beholdt** while that exact view is already kept; run a
LiDAR extract over the rectangle at a chosen
source and resolution, view it fullscreen, keep it as a Bilde; fetch flyfoto —
the seamless mosaic or any historical acquisition covering the area,
individually or as a batch; take a map screenshot; upload an image; and on a
lokalitet you have just made, get the best LiDAR dataset over the area read
three ways — hillshade, multidirectional hillshade and slope — landing in the
bottom edge without asking, before you have saved anything, and filling in as
they render.

**Keep it**
walk the images along the bottom of the map, with ← / → or the chevrons — a
rail of small frames in both stances, with the write verbs under it while you
are editing, and nothing there touching the map — picking a frame moves the
cursor and that is all;
switch an extract, terrain render or flyfoto onto the ground from
**[Visning ▾]**, and a screenshot from **[Bilde ▾]**, one or several at once,
each with its own fade, over or instead of the live ground — and press a
View's **Gjenskap** there to set the map back to the view it was made from;
give an uploaded image an extent with **Plasser i ruta** on its card so it can
join that list — fitted to the image's own aspect inside the lokalitet's
rectangle, marked as assumed wherever it appears, and removable again;
file an image under a funn with **Hører til** on its card, so that the
photographs and sketches of one feature sit together under its name in
[Bilde ▾] and [Skisse ▾] — in that order on the map as well as in the list —
and read which funn an image belongs to from its badge in either stance;
see a member say so on its own switch when the layer could not be shown;
take the ground away entirely and read a sketch and its funn on white;
keep the whole arrangement — which layers are on, in what order, at what fade,
over which ground — with **Oppsett** on the row, as a bilde of its own that
pins to a flatten captioned with its layers; and put a kept one back on the map
with **Legg ut igjen** on its card, in either stance, with what has since been
deleted reported rather than silently missing;
see a card that is still a set of parameters say so, and retry it if its render
failed; open the original in a tab, fetching it first where it does not exist
yet; caption an attachment; delete one and have it gone on confirm, without
leaving edit to make it happen; drag a frame along the rail to its
place in the exhibit, or step it earlier or later with the two arrows, to set
the order the
images are read in, and so which one is the cover; hide one from the exhibit
without deleting it, and see the hidden ones dashed and marked on the rail
while you are editing; fold the edge
away and back with **Bilder ▾** to get the ground under it, which leaves the
map exactly as it was;
see flyfoto captioned with its acquisition year; get every kept or downloaded
image back as a report-ready figure — scale bar, north arrow, dataset,
acquisition, processing settings, extent, rights holder and licence burned into
the file (§8.10), with only "Last opp" left as it arrived.

**Housekeeping**
switch language (nb / nn / en); open the help page at `/hjelp`; sign out.

---

## 14. Rough edges inherited, not designed

Fix-list; none of these are load-bearing.

- `mapToolAtom`'s `'measure'` member renders nothing (measure is a ribbon
  popover).
- `NKUrlParameter` carries `rotation`, `drawing`, `printTool` with no writers;
  `projection` is read but never written.
- Not persisted to the URL, though arguably they should be: the active LiDAR
  style and project, the active flyfoto acquisition, and the open lokalitet.
  For a tool whose whole point is showing someone else a suspicious bump in the
  ground, that is the biggest remaining gap (§4.3).
- `trackPositionAtom` and its effect have no UI entry point (§6.3).
- The theme-picker's category/subtheme machinery is unexercised (§6.2).
- Search has no keyboard support and no i18n (§7, §5.4).
- The layer z-index ladder contains a `4.5` and a `1.5`.
- Dragging the compare seam under a card is possible and pointless — the
  clamp is a flat 5–95 % rather than measured against `chromeInsets`, on the
  grounds that it is a gesture nobody makes twice.
- `test/map/overlay/atoms.test.ts` imports an atom that does not exist;
  `tsconfig.test.json` is not in `tsconfig.json`'s references, so `tsc -b`
  passes and only `npm test` notices.

Closed by the ribbon work, listed so they are not re-reported: the root
`new QueryClient()` in JSX, the duplicate `index.css` /
`material-symbols/rounded.css` imports, the scattered raw z-indexes, the
`calc(100vh - 65px)` header-height guesses, and the mobile horizontal scroll of
the old TopBar. Closed by the kvib migration: `MapToolCardProps.hideHeader`,
and the language switcher being reachable only on mobile — the old TopBar
carried it, the ribbon does not, and the help page's copy was behind an
`isMobile` gate. Closed by the lokalitet-view work: chrome that ate 500 px of
the map, hard-coded `view.fit` paddings that could not know about it, the
orange wash over the relief, funn that were only linked to the list in one
direction, Terreng existing twice with two different rectangles, and the
silent `cancelDraft` that discarded a drawing from five call sites.

---

## 15. Removed upstream machinery — don't re-add

Deleted deliberately; if one of these reappears, something regressed. The
kvib-specific removals are §12; this is the rest of what the fork threw out of
the inherited Norgeskart app, with the reasoning that made each a deletion
rather than a port.

- **The service-message banner** (`src/messages/`, `src/api/messageApi.ts`) —
  fetched Markdown from `raw.githubusercontent.com/kartverket/nk3config/…`,
  i.e. Norgeskart's operational announcements in Tufteseid's chrome plus a
  GitHub ping on every page load. It was the only consumer of
  `react-markdown` and of `getEnvName()`.
- **Hostname-based environment detection** in `src/env.ts` — it matched
  Kartverket's own domains, so every Tufteseid deployment fell through to
  `console.error('Unknown domain')` and silently ran the DEV table. There is
  now one `DEFAULT_ENV` plus the `window.__NK_CONFIG__` override from the
  bind-mounted `config.js`. The `envName` and
  `layerProviderParameters.geoNorgeWMS` keys went with it.
- **Google Fonts** (Raleway + Work Sans) in `index.html` — nothing set
  `font-family`. Mulish is self-hosted instead: `src/mainApp.tsx` imports the
  four `@fontsource/mulish` weights the kit asks for (§12 on how that package
  went from transitive to direct), and `src/index.css` sets the family on
  `body`. `font-src 'self'` is enough.
- **The generic theme-layer tree** (`src/settings/map/themes/`,
  `src/map/layers/themeLayers.ts`, `MapTool = 'layers'`) — categories,
  expandable subthemes, per-subtheme "add all", a fifteen-layer performance
  warning, and a whole card slot on top of the map to hold them, for one
  category of five layers from one rights holder. Replaced by the popover on
  `Kulturminner` in ribbon row 1, which offers the same five sources plus
  the things the register can actually be asked: §5.9 for the popover, §6.2 for
  what exactly was deleted. The catalogue of layers itself — what the five
  sources are, and the recipe for adding a sixth — is
  `docs/map-layers.md`.
- **The whole OpenLayers drawing subsystem** (`src/draw/`, `src/settings/draw/`,
  `src/localities/FunnDrawBar.tsx`, `src/localities/serializeDrawLayer.ts`, the
  `drawLayer` and `drawOverlayLayer` entries in `map/layers.ts`) — 23 files and
  ~3500 lines: six tools, select/translate/modify/delete, a vertical-move hook,
  five style controls with their recent-colour memory, undo/redo, snap,
  measurement readouts, and the atom graph under all of it. Replaced by
  Excalidraw over the frozen map (§9), which is one surface with its own
  toolbar, its own undo and its own styling, and which the fork did not have to
  write.

  Three things went with it that were load-bearing for something else and now
  are not. `getStyleFromProperties` / `getFeaturePropertiesForExport` were the
  round-trip that let a funn keep the colour it was drawn in — funn now render
  in one style and the expressive drawing is a sketch (§9.2). `drawEnabledAtom`
  was one of the two click owners `heritageClickArmedAtom` had to see
  (§7.1); the drawing surface covers the map and takes every pointer event, so
  the guard there is `funnSessionAtom`. And the `Escape` / `Delete` bindings in
  `drawControlsKeyboardEffects.ts` belonged to a tool that no longer listens on
  the document (§9.4) — see the Escape carve-out in §8.4. The whole top-level
  `draw.*` block in all three locale files went with the controls that read it;
  Excalidraw carries its own translations.

  Do not port a single control back in because "Excalidraw cannot snap" or
  "there is no vertex editor". Both are true; neither was worth 3500 lines of
  fork-local surface to keep, and a funn is a rectangle-sized sketch of a mound
  rather than a cadastral boundary.
- **Dead dependencies**: `maplibre-gl` and `@geoblocks/ol-maplibre-layer`
  (OpenLayers is the map engine and is the right one for WMS + EPSG:25833;
  MapLibre is vector-tile-first and weak on non-Mercator projections), and
  `fast-xml-parser` (all XML goes through native `DOMParser`).

The Caddyfile CSP was narrowed to match: `style-src` lost its `'unsafe-inline'`
when emotion went with kvib, and inline style *attributes* moved to their own
`style-src-attr` directive (§12). The `img-src` / `connect-src` host list, and
why no proxied upstream needs an entry in it, is
`docs/wms-proxy-and-tiles.md`.

### Ours, not upstream's — the dock and what hung off it

Written by this fork and deleted by it, at steps 12 and 15 of
`docs/lokalitet-view.md` §12. Listed here for the same reason as the rest: a
plausible-sounding reason to bring one back is exactly what the entry is for.

- **The dock** — `Dock.tsx` (the frame), `LocalityDock.tsx` (its one
  occupant), `dockSlot.ts` (`dockSlotAtom`), `dockOpenAtom` and the tab that
  unfolded it. A fixed 360–400 px column, becoming a bottom sheet below `48rem`,
  charging a slice of the map's width whether or not anything in it was being
  read. Its four occupants went to four surfaces priced like the use (§8.2).
  `TerrainDock`, the second one, had already gone when Terrenganalyse's knobs
  moved onto the ribbon (§10).
- **`BottomDrawToolSelector`** — the phone-only, `position: fixed` copy of the
  draw tools, which existed because six named tools did not fit across the
  dock column. `FunnDrawBar` made it one selector again, and then Excalidraw
  made it none (§9). `--z-fixed` was its only consumer and is gone with it;
  `tokens.css` keeps a comment where it was, because nothing in the app should
  float free of the shell's stacking order again.
- **`FunnDraft`** — the dock's draft band: title, note, state, and the pen in
  one panel. Split into `RibbonFunnDraftRow` (identity, on the ribbon),
  `FunnDrawBar` (the pen, at the bottom edge), `FunnCallout` (the note, on the
  map beside its shape) and the row's depth-2 exits (§8.5). Of those four the
  pen is gone again: the toolbar is on the canvas now.
- **The `Kulturminner ▾` readout on the lokalitet row** — `KulturminnerSection`
  and its stylesheet, `useKulturminner`, `src/api/kulturminnerWfs.ts`, the
  workspace's `kulturminner` / `kmCount` and the `localities.kulturminner.*`
  strings in all three locales. A list of what Riksantikvaren has already
  registered inside the open rectangle, badged with a count, asked of
  GeoNorge's WFS redistribution of the register (the endpoint is recorded in
  `docs/map-layers.md` in case it is ever wanted again).

  It went for two reasons that compound. It put a second button reading
  **Kulturminner**, in the same `castle` icon, on screen beside row 1's
  heritage toggle — one word for a layer switch and a register query is
  exactly the failure §1's first invariant is about. And the thing it
  answered is already answered better: the same register is one of the five
  theme layers, drawn *on the ground you are reading*, with structured
  GetFeatureInfo behind a click (§5.9, §7.1). A textual index of it, ranked by
  nothing and detached from where the features are, is the weaker of the two
  readings — and this app exists to read relief *against* the register, not
  beside it. Do not rebuild it as a "quick check": the check is to turn the
  layer on.

- **`openSectionsAtom` / `WorkspaceSectionId`** — which of the dock's four
  sections were unfolded. Nothing folds any more: a popover is open or it is
  not, and it does not remember.
- **`Section`'s `scroll` prop** — a `max-height` + `overflow-y` on a section
  body, which only ever made sense inside a column of fixed height. `Section`
  itself stays; it has around ten callers in `src/search/**` and
  `src/help/HelpPage.tsx`, contrary to what `docs/lokalitet-view.md` §6
  predicted.
- **The standalone terrain entrance** (step 15) — `src/terrain/atoms.ts`
  (`terrainStandaloneBboxAtom`), `src/terrain/useTerrainViewport.ts`, the
  strip's "Flytt analysen hit" and "Lagre som ny lokalitet" buttons with the
  `localities.terrain.reframe` / `reframeHint` / `saveNew` / `saving` /
  `saveFailed` strings behind them, the `save` path in `useTerrainAnalysis`,
  and `ribbon.terrain.tooLarge` / `.unavailable`. A second rectangle with a
  second save that could create a lokalitet on its way out. Terreng now reads
  the open lokalitet's bbox and nothing else, and pressing it with none open
  creates one (§5.3, §10). Do not reintroduce a free-floating analysis
  rectangle "just for signed-out visitors": the price of that convenience was
  two owners of one surface, which is what §1's first invariant is about.
- **The ground-overlay arbiter** (`docs/lokalitet-view.md` §13, build step 1) —
  `GroundOverlayOwner`, the `owner` tag on the placement, `showGroundOverlay`'s
  take-from-whoever-has-it, `hideGroundOverlay`'s no-op-unless-you-hold-it,
  `groundOverlayOwner`, `subscribeGroundOverlay`, and the
  displaced-side-drops-its-selection effects in `usePinnedBilde` and
  `useLocalityWorkspace`'s fold/unfold restore. It existed because two features
  wanted one `zIndex: 1`, and the rule it enforced — *pinning an image stands
  the terrain render down, and entering Terreng unpins the image* — forbade the
  comparison the overlay was built for: an old ortofoto faded over today's
  relief, in register. `zIndex: 1` is a **stack** now (§10). Do not re-add an
  arbiter to "stop two images fighting"; two images at one extent with two
  opacities is the feature.
- **`Gjenskap` as a button, and `Vis i ruta` on a View**
  (`docs/lokalitet-view.md` §13, build step 5) — `RecreateButton` in
  `bilderCommon.tsx` with its `localities.bilder.recreate` / `recreateHint`
  strings, off both the filmstrip card and the carousel; and `canPinBilde`'s
  `extract` / `flyfoto` arms. Neither verb went away: an extract, terrain
  render or flyfoto is switched onto the ground from `[Visning ▾]` now, where
  the row names what it is, and `Gjenskap` is that row's apply
  (`useRecreateView` is untouched underneath). Do not put either back on a
  card — two controls for one layer, one of which cannot see the stack the
  other is ordering, is the failure §1 is about.
- **`Vis i ruta` / `Ta av ruta`, and the whole pin mechanism behind them**
  (`docs/lokalitet-view.md` §13, build step 6) — `src/localities/usePinnedBilde.ts`
  with `canPinBilde`, `pinnedAttachmentIdAtom`, the workspace's `pinned` /
  `pin` / `pinOnWalk` and its fold/unfold `foldedRef` restore, the
  `localities.bilder.showOnMap` / `hideFromMap` / `hideStripAndMap` strings,
  and the `pinnedFailed` note under the selected card on both bottom-edge
  surfaces (which took `Note` in `bilderCommon.tsx` with it, its last caller).
  A screenshot goes on the ground from `[Bilde ▾]` now, with a switch of its
  own, a fade of its own, and as many of its siblings beside it as you like
  (§10.1). Three things went with the verb and none of them is missed: walking
  the rail stopped moving what is on the map, so folding the bottom edge away
  had nothing left to put down and nothing to give back; the `Bilder` button
  stopped lighting for "a bilde is on the ground", because four group labels
  answer that better than one light on a drawer; and `over` on a new sketch
  stopped meaning "the one pinned image" and started meaning the whole ground
  in row order (§9.3). Do not reintroduce a map verb on a card: the rail
  curates the exhibit, the layer row composes the map, and one surface doing
  both is how the arbiter above got built in the first place.
- **`BildeTransparency`** (same step) — the `ol/Overlay` slider on the
  lokalitet rectangle's top-right corner, its stylesheet, its `ErrorBoundary`
  in `LocalityRibbon` and `localities.bilder.transparency`. It was the second
  of three homes for one fade (§8.7.5) and the second to be wrong in the same
  way: one slider, because the ground was one slot. Every member of
  `[Visning ▾]` and `[Bilde ▾]` carries its own now, under the switch that put
  it there. Do not hang a fade on the rectangle again — the rectangle is the
  lokalitet, not any layer in it.
