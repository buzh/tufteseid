# UI architecture — the status quo, and the contract a replacement inherits

The interface was inherited Norgeskart chrome, de-branded and extended sideways
until it carried features it was never shaped for. It is being replaced. Two
slices of that have landed. First: the map became the full window, the chrome a
**ribbon** floating over it, and new code moved onto an in-repo plain-CSS kit
(`src/ui`) instead of kvib — which is now gone entirely (§12). Then the ribbon
turned out to be the wrong container for anything with a body, and the second
slice reshaped the app around the work loop it exists for:

- everything about the thing you are working on is in a **right-hand dock**
  column (§8), and the ribbon is back to two thin rows;
- **all framing is chrome-aware** — `chromeInsets` measures what the floating
  surfaces are covering, so the map fits its subject into the free area (§3.1);
- lokalitet rectangles and funn are **cased frames over the relief, not tints
  across it** (§8.6), and clicking one on the map selects it in the dock;
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

Companion reading: `docs/terrain-analysis.md` (what the Terreng panel is
driving), `docs/wms-proxy-and-tiles.md` (why layer switching is shaped the way
it is), `docs/analysis-roadmap.md` (what the workspace is expected to grow).

---

## 1. Three invariants a replacement must not break

Everything else in this document is description. These three are constraints,
and each has already cost a debugging session.

**One slot, one occupant — but only where the slot is really one.** Running a
LiDAR extract and reading terrain are the same slot: `ribbonToolAtom`
(`src/localities/toolAtoms.ts`) holds at most one of `'lidar' | 'terrain'`, and
picking one drops the other. Drawing is deliberately *not* in that slot. It has
its own flag, `funnDraftActiveAtom`, and the draft band and the terrain band can
be on screen together — terrain is a read-only view of the same rectangle and
tracing what it shows is the reason to have it up. A column can stack two bands;
the ribbon row this used to be could not, which is the whole reason the rule was
stricter before.

`workspaceModeAtom` still derives the single answer
(`'draft' | 'lidar' | 'terrain' | 'browse'`) and is what the ribbon's button
highlighting and `useWorkspaceKeys`' `navigable` flag read. The dock reads the
two underlying flags instead, precisely because collapsing them to one answer is
what would force the bands apart again. `MapTool`
(`'layers' | 'measure' | 'localities' | null`, `src/map/overlay/atoms.ts`) is
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
`useWorkspaceKeys`, `useBackgroundCyclingKeys` and `LidarExtractViewer` all do
this.

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

**One system, in-repo.** `src/ui/` is a small primitive kit — plain CSS
Modules over custom properties, no new npm dependency, because
`package-lock.json` cannot be regenerated on the workstation this is developed
on. It exports `Button` / `IconButton`, `Badge` / `CountBadge`, `Popover`,
`Dialog`, `Tooltip`, `Switch`, `Segmented`, `Section`, `Field` (`Input` +
`NoteInput`), `ConfirmPopover`, `Alert`, `Spinner`, `Icon`, `toast` /
`Toaster`, `cx`, `useMediaQuery` and `overlayAtoms`. Every surface in the app
renders through it.

`src/ui/tokens.css` is the single source for colour, spacing, radius, shadow,
control heights and — the one that was genuinely scattered before — the
**z-index ladder**: `--z-map: 0`, `--z-map-controls: 1`, `--z-overlay: 2`,
`--z-ribbon: 20`, `--z-fixed: 1000`, `--z-popover: 1200`, `--z-tooltip: 1300`,
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
custom properties on its own container. `LidarExtractViewer.module.css` is the
worked example: re-pointing two variables is the app's entire dark theme, and
`Button.module.css` needed no dark variant.

**kvib is gone** (§12). `src/index.css` carries the reset it used to supply,
Mulish is imported directly, and the `MaterialSymbol` union comes from
`material-symbols` itself. There is no dark mode — the extract viewer's dark
chrome is local, not a mode.

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
          App                ← routes + F11 + LidarExtractViewer + auth sync
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

`App.tsx` renders `<LidarExtractViewer />` **outside** the router, so the
fullscreen extract viewer survives navigation, mounts `pbAuthSyncEffect` above
the router for the same reason (signing in must not depend on which route is
showing), then routes `/` → `AppShell` and `/hjelp` → `HelpPage`.

### 3.1 Shell geometry

`src/shell/AppShell.tsx` (78 lines) plus `AppShell.module.css`. **The map is
the window and the chrome floats over it**, which is the single geometric
decision everything else follows from.

```
.shell   position:relative  height:100dvh  overflow:hidden
├── .map      position:absolute inset:0  z --z-map     ← OL target div, full bleed
└── .overlay  position:absolute inset:0  z --z-overlay
              display:flex  flex-direction:column  pointer-events:none
    ├── .ribbon   flex:0 0 auto   pointer-events:auto   z --z-ribbon
    │     └── Ribbon                  ← row 1, plus row 2 when a lokalitet is open
    └── .row      flex:1  min-height:0  position:relative  pointer-events:none
          ├── .left    absolute top/left/bottom          SearchComponent + MapToolCards
          └── .right   absolute top/right/bottom  360→400px
                       InfoBox, TerrainDock, and the portalled LocalityDock
```

Siblings of the whole thing: `BottomDrawToolSelector` (mobile only, only while
a funn draft is active), `KulturminnerPopup`, `AuthDialog`.

Details that are easy to lose:

- **No height measurement in the *layout*.** `.overlay` is an ordinary flow
  column that *contains* the ribbon, so the ribbon's natural height pushes the
  slots below it down with zero JS — no ResizeObserver, no CSS variable.
  Growing a ribbon row therefore costs nothing, and because the OL canvas never
  resizes it provokes no new GetMap requests. The old `calc(100vh - 65px)` /
  `calc(100vh - 80px)` guesses at the header height are gone; the slots have a
  definite height and their cards say `100%`.
- **`.right` needs `bottom: 0`.** It only had `top`/`right`, so a child asking
  for `max-height: 100%` had no containing height to resolve against and the
  dock could grow past the bottom of the window. It is a flex column now: 360 px
  from `48rem`, 400 px from `62rem`, full width below that (where the dock is a
  bottom sheet), with the infobox keeping its own width against the right edge.
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

Error boundaries are per ribbon row and per dock section, not one around the
bar: a crash in the terrain panel should not take the search field and the
background controls with it, and the map underneath stays usable either way —
which is the whole reason the chrome floats over it. `RibbonLocalityRow` is
outside the boundary that wraps the dock for the same reason: if the panel
inside throws, you still need the back arrow to get out of it.

#### `data-chrome`, and why nothing hard-codes a padding

The chrome floats *over* the map, so the map's own size says nothing about how
much of it you can see. Anything that frames something — fitting a lokalitet's
rectangle, seeding a new one from the viewport, zooming to a funn, marking a
search result — has to work in the free area, or it centres its subject
underneath the ribbon or behind the dock.

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
  anywhere — which is exactly what the `Dock` does when it switches to
  `data-chrome="bottom"` below the md breakpoint.
- **Measured on demand, never observed.** No ResizeObserver, no layout state,
  no re-render; the values are read at the instant a fit is computed. A folded
  dock is `display: none`, reports no rect, and drops out on its own.
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
at 0 (it sets none), terrain render 1, the compare curtain's B stack 1.5, draw
layer 2, draw overlay / measure / theme layers 3, active theme layer promoted
to 10, lidar footprints 3, localities 4, funn highlight 4.5, funn 5, locality
draft 7, lidar extract selection 7, locality adjust 8. The fractional 4.5 and
1.5 are the tell that this ladder grew by insertion rather than design.

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

- **Map core** — `mapAtom`, `currentZoomAtom`, `mapFullScreenAtom`,
  `trackPositionAtom`.
- **Background** — `backgroundLayerAtom`, `hybridOverlayAtom`,
  `activeLidarModelAtom`, `activeLidarStyleAtom`, `activeLidarProjectAtom`,
  `lidarPickerOpenAtom`, `lidarCyclingAtom`, `lidarAutoDatasetAtom`,
  `activeFlyfotoProjectAtom`, plus
  the viewport project list. The flyfoto acquisition list is *not* an atom —
  nothing draws its footprints, so it is component state in
  `useFlyfotoControls`.
- **Sammenlign** — `compareGroundAtom` (`null` = off, otherwise the ground on
  the right of the curtain) and `compareSplitAtom` (0–1, where the divider is),
  both in `src/map/compare/atoms.ts` (§5.8). Neither is persisted to the URL.
  The split is read by the OL render handlers through
  `setCurtainSplit`, so `compareLayerAtomEffect` deliberately does *not* depend
  on it — dragging the divider must not rebuild a tile stack.
- **Skjul merker** — `marksHiddenAtom` (`src/localities/atoms.ts`), read by
  `useMarksVisibility` (§8.6). Not persisted to the URL.
- **Theme layers** — `activeThemeLayersAtom` (a `Set<ThemeLayerName>`).
- **Chrome** — `mapToolAtom`, `overlayOpenCountAtom` / `anyOverlayOpenAtom`
  (`src/ui/overlayAtoms.ts`, incremented by every `Popover` and `Dialog` so the
  keyboard layers can stand down).
- **Ribbon / workspace** — `ribbonToolAtom`, the derived `workspaceModeAtom`,
  `dockOpenAtom`, `funnOutsideAtom` (`src/localities/toolAtoms.ts`),
  `openSectionsAtom` (`src/localities/atoms.ts`), `dockSlotAtom`
  (`src/shell/dockSlot.ts` — the portal target, a DOM node rather than a value)
  and `terrainStandaloneBboxAtom` (`src/terrain/atoms.ts`).
- **Search** — query, results, selected result, marker, infobox visibility.
- **Feature info** — the clicked-position readout and the Kulturminner popup.
- **Draw** — the largest single cluster (`src/settings/draw/atoms.ts`, 375
  lines): active tool, colour, line width, line style, point style, text style,
  measurement toggles, undo/redo stacks.
- **Lokaliteter** — `activeLocalityAtom`, `funnDraftActiveAtom`,
  `adjustingLocalityAtom`, `selectedFunnIdAtom` / `hoveredFunnIdAtom` (written
  from both the dock list and the map, §8.6), `lightboxOpenAtom`, content
  caches.
- **LiDAR extract** — selection rectangle, run status, result canvas.
- **Auth** — `currentUserAtom`, `roleAtom`, `isAdminAtom`, dialog open state.

### 4.3 URL persistence is hand-rolled

`src/shared/utils/urlUtils.ts` owns it: a `NKUrlParameter` string union, getters
that parse and validate, and a writer that mutates the URL with
`history.replaceState` (never `pushState` — **the back button does not undo map
navigation**, by omission rather than decision). There is also a migration path
for the legacy Norgeskart `#!?` hash format.

Live parameters: `lat`, `lon`, `zoom` (written on every map `moveend`),
`backgroundLayer`, `hybrid`, `lidarModel`, `themeLayers`, `sok`, `markerLat`,
`markerLon`, `showSelection`.

Dead entries still in the union: `rotation`, `drawing`, `printTool` have no live
writers, and `projection` is read but never written. Not persisted at all,
though arguably they should be: the active LiDAR **style** and **project**, and
the open lokalitet. Sharing a link to "this terrain, styled this way, on this
lokalitet" is not currently possible, and for a tool whose whole point is
showing someone else a suspicious bump in the ground, that is a real gap worth
closing in the rewrite.

---

## 5. The ribbon

`src/shell/Ribbon.tsx` and the components around it. **Two thin rows at most**,
and nothing with a body goes in either:

| Row | Component | When |
|---|---|---|
| 1 — the map | `RibbonGlobalRow` | always |
| 2 — the lokalitet | `RibbonLocalityRow` | a lokalitet is open |

There used to be four. A tool row and the tray stacked under these two could
reach five hundred pixels of chrome across the top of the map — over the very
ground the panels were describing — so both moved into the dock (§8). Row 2 is
a **context strip** now, not a surface: identity on the left, the verbs that are
part of the work loop on the right, the rest behind an overflow menu. Nothing in
it opens downwards.

`LocalityRibbon` renders row 2 and is the **one** mount point for
`useLocalityWorkspace` — that hook opens two PocketBase realtime subscriptions
that reload the whole list on every event, so a second call site doubles both.
It also portals `LocalityDock` into the shell's right slot through
`dockSlotAtom`, rather than hoisting an 850-line hook to a common ancestor and
making every one of its callbacks nullable: one React tree, two places in the
DOM.

`data-chrome="top"` on the bar is how framing code learns how much of the map it
covers (§3.1). Measured rather than a constant, because row 2 comes and goes and
the rows wrap on narrow screens. The old TopBar's answer to "fourteen controls
do not fit on a phone" was `overflowX: auto` on the whole bar, which made the
pulldowns inside it clip; that is gone.

### 5.1 Row 1, left to right

Left to right, and the order is the argument: find a place, choose what the
ground looks like, overlay the heritage record on it, then act on what you are
looking at.

| Control | What it does |
|---|---|
| `RibbonSearch` | Place/address/property search field; results render in the left slot (§7) |
| **Standard** (1) | Background mode: topo basemap |
| **LiDAR** (2) | Background mode: hillshade stack |
| **Hybrid** (3) | LiDAR stack + transparent roads/rail/place-names on top |
| **Flyfoto** (4) | Background mode: NiB ortofoto (§5.5) |
| **Terreng** (5) | Terrain analysis: relief computed here from float elevation, over the open lokalitet's rectangle if there is one and the visible map otherwise (§10) |
| **Sammenlign** | Puts a second ground on the right of a draggable curtain, with a pulldown for which one (§5.8) |
| **Skjul merker** (H) | Takes our own marks — funn, their halo, the lokalitet rectangles — off the map for as long as it is pressed in (§8.6) |
| Dataset pulldown | LiDAR: **Automatisk** (§5.7), the national mosaic, or one of ~1936 per-project datasets ranked by relevance to the viewport. Flyfoto: the seamless mosaic or any acquisition covering the viewport, newest first |
| Style pulldown | The active LiDAR dataset's WMS styles, with a "flere stiler" second tier |
| DTM / DOM segment | Terrain model vs surface model |
| **Kulturminner** | Toggles the five Riksantikvaren theme layers as a group |
| **Kartlag** | Opens the theme-layer card (`MapTool = 'layers'`) |
| Mål | Popover with the measure tools |
| Mine lokaliteter | Opens the localities card (signed in only) |
| Ny lokalitet | Creates a lokalitet from the visible map (signed in only, §5.6) |
| `RibbonAccount` | Sign in / account menu |

The five grounds are **one ring**, in digit order, driven by
`useGroundMode` (`src/shell/useGroundMode.ts`). Underneath they are three
different mechanisms — a background-layer atom, a modifier flag, and a rectangle
to analyse — and the buttons used to speak all three separately, with Terreng in
a different group that *disappeared whenever a lokalitet was open* because row 2
carried a second copy of the verb. Two controls for one surface disagreeing
about which rectangle "Lagre" keeps is why there is one now. One list, one
index, one setter; `GROUND_MODES` is the render order and the digit order at
once, and `GROUND_KEYS` in `useBackgroundCyclingKeys` is positional against it.

Terreng belongs in that ring even though it is not a background: it does not
replace the background, it covers it. Leaving therefore costs nothing and
returns you to exactly the dataset and style you left — 1→5→1 is free where
1→2→1 is a screenful of tile requests.

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
DTM/DOM and the style pick are modifiers.** Hybrid is not a background of its
own — it is `hybridOverlayAtom`, a flag on top of the LiDAR stack, so the
dataset picker, style picker and keyboard cycling all keep working underneath
it, and activating it from Standard turns the national mosaic on rather than
becoming a fourth mode. Same for DTM/DOM. Modelling either as a mode would
multiply the mode buttons and break cycling.

**Hybrid is nonetheless a button in the ground ring, and that is the one
deliberate exception.** It is a modifier by mechanism and one of the five things
you flip between by intent, and splitting the ring to say so would cost more
than it explains. The distinction is unharmed where it does work: DTM/DOM and
the style pick stay in the pulldown group, and picking Hybrid still activates
the LiDAR stack underneath rather than replacing it.

Switching to Flyfoto deliberately leaves `hybridOverlayAtom` alone rather than
clearing it: it is a LiDAR modifier, inert in flyfoto mode, and switching back
should return you to the stack you left.

### 5.3 The map keyboard: grounds, and cycling within one

One `document` keydown listener, with `[]` deps and a mutable ref per handler —
the lists they close over are rebuilt on every render, so the alternative is
re-attaching the listener continuously.

**Across grounds:**

- **1–5** — select the ground outright, in the order row 1 renders the buttons.
- **Hold X** — peek at the ground you were on before, snapping back on release.
  Reading relief against a photograph means flipping dozens of times, and a
  hold-to-compare is the cheapest form of that.
- **H** — hide/show our own marks (§8.6). The one key here written straight
  against an atom rather than through a registered handler: there is a single
  boolean and no mode owns it, so there is nothing for a component to
  contribute. It is a press rather than a hold because judging a bump against a
  1937 photograph takes longer than a key can comfortably be held down.

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
- **W / S** — previous / next dataset in **the active mode's ring**: LiDAR
  projects in LiDAR mode, ortofoto acquisitions in flyfoto mode. In LiDAR mode
  a press also pins the dataset (§5.7) — walking the ring is the user choosing,
  and otherwise the auto resolver would take the background back on the next
  pan and W/S would feel broken.
- **E** — toggle DTM / DOM.

W/S generalising across modes is the point of the flyfoto work: walking
2024 → 1963 → 1937 over the same ground with one key is what makes a temporal
stack readable at all.

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
chains the two cycling halves — `flyfoto.cycle(key) || lidar.cycle(key)`. Each
half declines every key outside its own mode, so the order decides who is asked
first, not who gets it. There is exactly one registered handler of each kind;
two registrations would silently mean the last one mounted wins.

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
three locales, with the dock and the workspace under `localities.*`.

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

### 5.5 Flyfoto as a background mode

Two layer names, both dynamic branches of `backgroundLayerAtomEffect` with no
static entry in `allConfiguredBackgroundLayers`, exactly like the LiDAR pair:

- **`flyfoto`** — the seamless best-available mosaic. A plain `TileWMS` on
  `/wms/nib/ortofoto`.
- **`flyfotoProject`** — one acquisition. **Not** a WMS: NiB has no per-project
  WMS endpoint, so this is `ol/source/TileArcGISRest` against
  `/arcgis/nib/ortofoto_prosjekter/ImageServer/exportImage` with a
  `mosaicRule` of `{ mosaicMethod: 'esriMosaicNone', where:
  "prosjektnavn='…'" }`. `esriMosaicNone` is load-bearing — the service's
  default method blends the neighbouring projects back in, and the symptom is
  a picked year that looks almost but not quite right.

`flyfotoProject` stays out of `VALID_STARTUP_LAYERS` for the same reason
`lidarProject` does: its concrete acquisition starts null, so a cold load onto
it would render nothing.

The acquisition list comes from `fetchFlyfotoProjectsForBbox` refetched on
moveend while the mode is active. **No licensing notice for viewing** —
browsing NiB imagery as a background is what the old external link already
did; the notice gates *grab-and-keep* (§8.6), which is a different act.

### 5.6 Ny lokalitet from the viewport

Pressing it creates a lokalitet immediately from the rectangle you can see. No
box-drag to arm, no dialog to fill in: `viewportBbox` in
`src/localities/createFromBbox.ts` insets the visible map and
`createLocalityFromBbox` turns the result into a record.

Each of the four edges takes **whichever is larger, the chrome in front of it
(`chromeInsets(map)` plus `CHROME_MARGIN_PX`, §3.1) or a proportional inset**
(8 % of the dimension, at least 48 px). With nothing docked that is exactly the
old symmetric rectangle; with the ribbon up and the dock open the top and right
edges move in to clear them. The proportional floor is not just cosmetic — at
≥8 % it also guarantees `transformExtent`'s corner-only reprojection cannot clip
something the user could see inside the box.

Details worth not re-deriving:

- **Inset pixel corners through `map.getCoordinateFromPixel`**, not
  `calculateExtent` with a ratio. `calculateExtent` is symmetric about the view
  centre and the chrome is not — a ribbon on top, a dock on the right — so no
  symmetric ratio clears it without over-insetting the opposite edges. Pixels
  are relative to the map viewport element, which every surface floats over, so
  the measured chrome insets map 1:1 onto the pixel insets. Rotation is locked
  off, so two corners describe the rectangle.
- **A floor on the result.** Chrome plus insets can leave nothing worth framing
  (a narrow window with the dock open); under `MIN_SIDE_PX` the press is
  refused as `unavailable` rather than creating a sliver.
- **A zoom guard.** `minZoom: 3` means the viewport can be most of Norway, and
  opening the workspace fires a WFS BBOX query over whatever you framed. Too
  large a span is refused with a toast rather than created.
- **The workspace opens only after `createLocality` resolves.** "Juster
  området" builds its extent from the bbox in the closure when `adjusting`
  flipped true, so an optimistic placeholder record would have it edit a stale
  rectangle.

The bbox stays **authored, not derived**: the viewport only seeds it, and
"Juster området" still translates and reshapes it afterwards.

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

### 5.8 Sammenlign — the curtain

Flipping grounds with 1–5 answers "what does this look like in LiDAR". It
cannot answer "is that bump in the ortofoto the same bump as in the relief" —
that needs both on screen at once and in register. **Sammenlign** keeps the
ordinary background stack across the whole map (the *A* half) and clips a
second stack to the right of a draggable edge (the *B* half).

It is **not** one of the five ground buttons and has no digit key: it does not
answer "what does the ground look like" but "against what". It sits in its own
group beside the ring, and reads the ring's current and previous mode to choose
a sensible other half — entering lands on the ground you were last on, which is
almost always the one you just flipped away from, i.e. the comparison you were
already making by hand.

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

Two deliberate limits: **Terreng is not offered as a B half** (it is a render
over the background rather than a background, and Terreng on the A side against
any raster on the B side already gives that comparison), and **the B half has
no dataset picker of its own** — the row-1 pulldowns are the one place a
dataset is chosen, and B shows whichever acquisition they last named. That is
what makes a temporal compare work without new controls: pick 1937 in the
flyfoto pulldown, switch A to LiDAR, turn on Sammenlign.

---

## 6. Map panels and controls

### 6.1 The card slot

`src/map/overlay/MapToolCards.tsx` renders **one** card at a time from
`mapToolAtom`: `'layers'` → `MapThemes`, `'localities'` → `LocalitiesPanel`,
`'measure'` → nothing (measure lives in a ribbon popover; the enum member is
vestigial and the switch falls through to `undefined`).

`MapToolCard` is the shared shell: white card, `max-height: 100%` against the
slot's definite height (§3.1), `pointer-events: auto` against the slot's
`none`, a heading and a close IconButton. Width is the slot's — the old
`maxWidth: 345px` was a second guess at the same number `.left` already
enforces. The `hideHeader` prop went with the port: declared and handled, never
passed.

The card slot no longer arbitrates with the lokalitet workspace: the workspace
is in the ribbon, so search and the cards simply render, and `mapToolAtom` only
has to keep the cards exclusive with each other.

The layers card has a bespoke header (`MapLayersCardHeader`): the active
theme-layer count as a `CountBadge`, plus a "clear all" button that appears
only when there is something to clear.

### 6.2 The theme picker

`src/settings/map/themes/MapThemes.tsx` + `SubTheme.tsx`. Generic upstream
machinery for browsing categories of theme layers with expandable subthemes —
and this fork has **one category with five layers** (Kulturminner). The
multi-subtheme, multi-category, search-within-themes capability is entirely
unexercised. A replacement can almost certainly collapse this to a flat list
without losing anything a user sees today, but check `themeLayerConfigApi.ts`
first in case new categories are planned.

Selecting a theme layer promotes it to `setZIndex(10)`, above everything else.

Three heading levels stack in one 400 px column — theme, subtheme, layer — and
each of the first two is a controlled `Section`. The size step that separates
them rides on `--section-title-size`, set on the theme's `Section` and put back
on its body, because custom properties inherit and would otherwise carry into
the subtheme headings nested inside. A layer row is the kit `Switch` with its
label reversed to the left by CSS, so the switch's own `<label>` spans the row
and there is no second click handler on a wrapper.

### 6.3 What does not exist

Worth stating, because their absence reads as an oversight and is at least
partly a choice: **no zoom in/out buttons** (mouse wheel, pinch and keyboard
only), **no north arrow / rotation reset** (the map cannot rotate), **no
coordinate readout** on the map itself (the InfoBox shows one for a clicked
point), **no map legend**, **no layer opacity control** exposed to the user
(opacity is used internally by the background stack), and **no geolocation
button** — `trackPositionAtom` and `trackPostitionAtomEffect` are fully wired
but nothing ever sets the atom `true`, so the "where am I" feature is dead code
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

Two surfaces, which is one more than a user needs:

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

---

## 8. The lokalitet workspace

A **lokalitet** is an authored rectangle: an area to explore, not a claim that
something is there. It holds **funn** (individually named drawn features) and
**bilder** (kept LiDAR extracts, terrain renders, map screenshots, flyfoto,
uploads). The bbox is authored, never derived from its content — if a drawn funn
escapes the rectangle, the workspace offers to grow it rather than silently
resizing.

The workspace is the only route to drawing and LiDAR extract. There are no
standalone `draw` / `lidarExtract` / `newFind` map tools. Two exceptions,
both deliberate: **measure** stays global because it is ephemeral and leaves
nothing behind, and **terrain analysis** is now reachable from the bare map
too (§10) because reading the ground is not an act of ownership.

### 8.1 Anatomy

There is no workspace *panel*, and no workspace *rows* either. The state is one
controller hook, `src/localities/useLocalityWorkspace.ts`, and the presentation
is a context strip plus a dock column:

| Region | Component | Contents |
|---|---|---|
| Identity + verbs | `RibbonLocalityRow` (row 2) | back, inline-editable name, visibility badge, summary line, zoom-to; then Nytt funn · LiDAR-uttrekk · Bilde · Flyfoto, with Hent grunnpakke / Last opp / Juster området / Slett behind a `more_vert` menu |
| Everything with a body | `LocalityDock` (right slot) | the live tool band, then Funn · Bilder · Kulturminner · Detaljer as sections |
| Dialogs | `LocalityDialogs` | flyfoto licensing notice, flyfoto picker |

Terreng is deliberately *not* in row 2 — it is a ground mode in row 1 and works
the same with or without a lokalitet (§5.1, §10).

Splitting the old panel up removed the `key={locality.id}` remount that used to
reset its `useState`, which is why the state had to move into the controller
first. What stays component-local is the half-typed name in `LocalityName`,
still keyed on `locality.id` for exactly that reason.

`LocalityRibbon` is the single mount point for the controller (§5) and portals
the dock into the shell's right slot: the hook holds two PocketBase realtime
subscriptions that reload the whole list on every event.

### 8.2 The dock

`src/shell/Dock.tsx` is the frame — a header, then a body — and
`LocalityDock.tsx` fills it. Two occupants of the same frame exist:
`LocalityDock` for an open lokalitet, and `TerrainDock` for a standalone terrain
analysis with no lokalitet at all (§10).

The column costs a fixed slice of the *width* (360 px, 400 px above `62rem`) and
the map fits its subject into what is left, where the ribbon it replaced cost
height across the top of the very ground the panels described. Below the md
breakpoint the column has nowhere to go and becomes a bottom sheet;
`data-chrome` follows it, which is the whole reason framing code asks for the
edge rather than assuming one (§3.1).

**The tool band and the section list coexist.** A live tool — `FunnDraft` +
`DrawControls`, `LidarExtractPanel`, `TerrainPanel` — renders in a `DockTool`
pinned above the sections, not instead of them. Under the old tray they were
mutually exclusive, which meant starting to draw hid the list of what you had
already drawn. Starting a tool also unfolds the dock, since its controls *are*
the tool.

**Folding hides, it does not unmount.** Folding is what you do *to see the map*
— most often the terrain render the panel inside just produced — and unmounting
would take that render off the map with it, along with the DEM behind it and
every panel's scroll position. A `display: none` subtree costs nothing to keep
and reports no rect, so `chromeInsets` stops counting it on its own. What is
left in its place is a tab on the edge carrying the funn count: still reachable,
still countable, which is the reason to unfold. `dockOpenAtom` is module-level,
so folding away survives closing and reopening a lokalitet — the one gesture you
make precisely because you want the map, undone by the next thing you open,
would be worse than no fold at all.

Each section keeps its own error boundary: `BilderSection` fetches short-lived
file tokens and `KulturminnerSection` hits an external WFS, and either failing
should cost you that section rather than the funn list above it.

`FunnList` (per-row status, rename, zoom-to, delete), `BilderSection`
(attachment gallery with lightbox), `KulturminnerSection` (the "kjente
kulturminner her" readout from GeoNorge's WFS redistribution of the
Riksantikvaren register — `kart.ra.no` has WFS disabled, hence the detour), and
`LocalityDetails` (where it is, description, synlighet, metadata) last, because
it is the one section you set once and stop looking at.

`LocalityDetails` opens with the location group: **Sted**, **Kommune** and
**Matrikkel** as ordinary text fields, then **Koordinater** and **Areal** as
read-only facts. Nothing in it has a Lagre button — like Beskrivelse, each
field commits on blur (Enter blurs, Escape reverts without blurring, or the
stale draft in the closure would be saved anyway).

The three fields are pre-filled at creation from the public registers
(`src/localities/localityContext.ts`, §8.3) and are the user's afterwards. The
only thing that overwrites them is the owner-only **"Hent stedsdata på nytt"**
button below the facts, which re-asks for the rectangle as it now stands —
"Juster området" would otherwise leave all three describing the old one, with
retyping as the only recourse. Koordinater is not a field: it is computed from
the bbox on every render (`formatBboxCentre`), so it cannot go stale at all.
Sted, Kommune and Matrikkel are also matched by the Lokaliteter panel's search
box, which is most of why they are fields rather than a paragraph of
Beskrivelse.

### 8.3 Auto-naming a new lokalitet

A rectangle framed with "Ny lokalitet" arrives already called something —
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

`fetchLocalityContext` never rejects and never takes longer than 6 s; both call
sites (the ribbon button and TerrainPanel's save-with-no-lokalitet path)
already disable themselves while it runs. Which registers it asks, and how the
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
| ↑ / ↓ | Move funn selection (only when `navigable`) |
| Enter | Zoom to selected funn (only when `navigable`) |
| N | Arm drawing / put the pen down — the same toggle as the row-2 button the key is advertised on |
| U | Toggle LiDAR extract |
| B | Screenshot |
| Escape | Close / back out — **except while a funn draft is open** |

`navigable` is off only while drawing: the funn list is always on screen in the
dock, so arrows keep working with the extract and terrain panels open, and
picking a different funn out from under the pen is never what the arrow meant.

That Escape carve-out is deliberate: `DrawControls` binds Escape to abort the
shape currently being sketched, and stealing it would throw away a drawing
instead of a keystroke. Under autosave (§8.5) it is also no longer the
data-loss risk it was — everything already drawn is a record by then.

Row 1's map keys (1–5, hold X, A/D/W/S/E) are a separate listener and keep
working throughout; see §5.3.

### 8.5 Funn autosave

**A funn is a record from the moment its first shape closes.** There is no
Lagre button, no disabled-until-titled state, and nothing to discard.

That replaced a commit-or-discard form whose Cancel was called *silently* from
five places — Escape, "Nytt funn" used as a toggle, opening the extract,
starting an adjust, closing the workspace — each of which cleared the draw layer
and threw the drawing away. The trade-off, taken deliberately: a stray click can
leave a junk funn to delete, which is a recoverable annoyance where the old
failure was not.

`src/localities/useFunnAutosave.ts` is the mechanism. It watches the shared draw
layer's source (`addfeature` / `changefeature` / `removefeature`), debounces
`SETTLE_MS = 700` — long enough that dragging a vertex is one save and not
forty — and then either creates the record or patches its geometry.
`useLocalityWorkspace` supplies both callbacks and holds the two the hook
returns (`flush`, `rebind`) in refs, because the halves point at each other.

Six rules in there are load-bearing:

- **An empty layer is never a delete.** Clearing the draw layer is how *every*
  exit path takes the drawing back off the map; if that serialized to "no
  features" and got written, putting the pen down would erase the funn.
- **One write at a time.** Two creates in flight is two funn, so a second change
  during a request sets a dirty flag and re-arms the timer instead.
- **The baseline is seeded, not observed.** `rebind()` re-points the pen and
  records what is already on the layer as "written", which is what stops
  "Rediger tegningen" from immediately re-saving the geometry it just loaded.
  It is called explicitly at the two call sites that know a swap happened,
  rather than keyed on the funn id changing — keying it would race the create's
  own completion and could swallow the edit that followed it.
- **Every exit flushes first.** `stopDraft`, `openLidar`, `toggleAdjusting`,
  deleting the drafted funn, and the workspace's unmount cleanup all call the
  flush *before* clearing the layer.
- **The drafted funn stays hidden across re-hydration.** `hideFunnOnLayer(id)`
  sets a module-level id in `funnLayer.ts`, not a one-time style pass: every
  autosaved patch comes back as a realtime event that rebuilds that record's
  features from scratch, and without the id the persisted copy would reappear
  underneath the one on the draw layer. `hideFunnOnLayer(null)` lifts it.
- **Titles are never empty.** The create names the funn `Funn n`
  (`localities.funn.autoName`) rather than blocking on one being typed — a funn
  you can rename is worth more than a funn you have to name — and the draft
  band's title field reverts rather than clearing it.

The receipt is a **toast carrying an "Angre"**, which is what lets the first
shape commit without asking: undo deletes the record, clears the layer and
leaves the pen armed, so the next shape starts a new funn. `src/ui/Toast.tsx`
grew one optional `action` for this rather than the app growing a second
transient surface.

`FunnDraft` is accordingly not a form. Its title and note edit the live record
on blur, like a row in the list; the only button puts the pen down; and what is
left to say is *state* — "Lagret" / "Lagrer…" as a receipt, not a control.

**Grow-to-fit is an `Alert` in that band, not a modal.** Drawing past the edge
of the rectangle is worth remarking on and not worth stopping the pen for.
`funnOutsideAtom` is a **flag**, not the union bbox it used to hold: it is
written while the pen is moving, and re-publishing a rectangle that grows with
every frame of a drag would re-render the dock per frame to say the same thing.
"Utvid området" recomputes the union from the live drawing at press time, which
also means it cannot grow the rectangle to fit a shape since moved back inside.

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

**Skjul merker.** Restraint in the styling only goes so far: a cased outline
sitting exactly on the bump you are judging is still on it, and the point of
the curtain and the digit keys is to look at the *ground* in two acquisitions.
`marksHiddenAtom` (row 1, key **H**) takes all three mark layers off —
localities, funn, the selection halo — through `useMarksVisibility`
(`src/localities/marksVisibility.ts`).

- **`setVisible(false)`, never removal.** Everything the glance must leave
  alone hangs off those layers: the hydrated features, two realtime
  subscriptions, the selection, and the draw layer's idea of which funn it is
  holding.
- It re-applies on the layer collection's `add` as well as on the flag, because
  each of the three layers is created by its own hook and one arriving while
  marks are hidden would default to visible.
- **The draw layer is not in the set**, and `startDraft` lifts the flag. You
  cannot draw a shape you cannot see, and drawing with the existing funn
  invisible is how you end up drawing the one you already have.
- Not persisted to the URL, on the same grounds as the compare curtain: a link
  shared to show someone a funn must not arrive with the funn hidden.

### 8.7 The attachment pipeline

Four producers converge on one sink, and that convergence is the part worth
preserving:

```
screenshot.ts         ─┐
flyfoto.ts            ─┤
lidarExtract "Behold" ─┼→ renderFigureBlob() → createAttachment() → PocketBase
terrain "Lagre"       ─┤   (§8.10)                → realtime → BilderSection
starterPack.ts        ─┘
```

Every producer hands a **canvas**, not bytes, so the figure stage has somewhere
to draw a caption; only "Last opp" bypasses it (§8.10).

`kind` is one of `extract | screenshot | upload | flyfoto`; terrain renders
reuse `extract` with the visualization recorded in `meta.style`, which is why
adding terrain analysis needed no migration. `meta` also carries source
key/label, `metresPerPx`, bbox, `imageRect` (§8.10), and for flyfoto the
`projectName` / `year` / `photoDate` that the gallery captions from
("Flyfoto 1937"). Files are `protected` in PocketBase, so the gallery fetches
short-lived file tokens for thumbnails — a new UI must keep doing that or every
thumbnail 403s.

### 8.8 The flyfoto picker

"Flyfoto" → licensing notice dialog → picker listing the seamless best mosaic
plus every ortofoto acquisition intersecting the bbox (label = year, subtitle =
photo date + project name), each with "Hent", plus "Hent alle" over the newest
`FLYFOTO_BATCH_MAX` (8). `FLYFOTO_MOSAIC = '__mosaic__'` is the sentinel id for
the mosaic row.

The batch runs **sequentially** — a single project's tile burst already
saturates the concurrency budget against the shared NiB edge — and reports how
many of the attempted projects actually had coverage, because the uniform-image
check in `fetchAndPaint` silently drops all-blank results.

The licensing notice gates *every* grab, by product decision, not by accident:
NiB imagery is free for private non-commercial use and publishing is the user's
responsibility, so the notice is the point at which that is communicated. Do not
add a "don't show this again" checkbox without thinking about it.

### 8.9 Hent grunnpakke

The first item in the row-2 overflow menu, and the only one there you press on a
lokalitet you have just made and never again — hence its position. One press
produces the three images you would otherwise fetch by hand before starting to
read a rectangle, into Bilder:

| Step | What | Producer |
|---|---|---|
| `flyfoto` | the newest ortofoto acquisition covering the bbox, or the seamless mosaic when the list is empty | the same `grabFlyfoto` the picker uses |
| `extract` | a `skyggerelieff` LiDAR hillshade from the densest per-project dataset here | `starterExtract` → `extractCanvas` |
| `terrain` | a **multidirectional** relief render computed from the float DEM | `starterTerrain` → `renderTerrain` |

`src/localities/starterPack.ts` only *makes* the rasters; captions,
`createAttachment` and the gallery's optimistic update stay in
`runStarterPack` (`useLocalityWorkspace`), where the translations and record ids
are. Both derived rasters save as the existing `extract` kind with the
visualization in `meta.style` (§8.7), so there is no migration.

Load-bearing choices:

- **It goes through the flyfoto licensing notice**, like every other NiB grab.
  `flyfotoNotice` is therefore a `'picker' | 'starter' | null` target rather than
  a boolean, and "Fortsett" dispatches on it. One notice covers the pack; the
  two Kartverket steps need none.
- **Sequential, and mutually exclusive with a hand-picked grab.** One stitch
  already saturates its concurrency budget against a shared public edge, and
  these hit two of them. The pack sets the same `fetchingFlyfoto` flag the picker
  does while its first step runs, and both the Flyfoto verb and the menu item are
  disabled whenever either is busy.
- **Each step is independently fallible.** A rectangle at the coast can have
  ortofoto and no laser data; that is not a failed pack. Failures are counted,
  not thrown, and the toast says how many of the three arrived.
- **Cancellable.** An `AbortController` in a ref, aborted by the same cleanup
  that closes the workspace, with an abort check between every step — closing a
  lokalitet stops spending tile requests on it. An aborted stitch paints nothing,
  which is indistinguishable from no coverage, so the "ingen dekning" toast is
  suppressed when the signal is aborted.
- **Progress renders in the Bilder section**, as one line with a spinner naming
  the current step, and the dock unfolds and opens that section when a pack
  starts. Deliberately not a placeholder tile among the saved ones — a tile that
  disappears would be read as a fourth image that failed.
- **Multidirectional, not plain hillshade, for the terrain step.** It needs no
  azimuth chosen for it, and a single sun angle hides whatever runs along it —
  the failure that costs most in an image nobody will go back and re-light.

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
| `figure/specs.ts` | one spec builder per producer: `lidarExtractFigure`, `terrainFigure`, `flyfotoFigure`, `screenshotFigure` |

**Scope: everything but "Last opp".** Both LiDAR extract exits ("Behold" *and*
the PNG download — the download is precisely the copy that ends up in someone
else's report), terrain "Lagre", the flyfoto grab, "Ta skjermbilde" and all
three steps of Hent grunnpakke. An upload's provenance is unknown to the app,
so inventing a caption for it would be worse than none.

Load-bearing:

- **The caption is a panel *below* the image, never an overlay.** No pixel of
  ground is covered. The cost is that the file is no longer pixel-registered to
  its bbox, so every attachment records `meta.imageRect` (`{x, y, width,
  height}`) — where the image sits inside the file. Anything that later wants
  to georeference a saved raster reads that, not the canvas size.
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

- **The PocketBase `caption` field is untouched** — still the short human line
  the gallery shows ("Flyfoto 1937"). The long-form provenance lives in the
  pixels, where it survives being downloaded, emailed and pasted into a report.

---

## 9. Drawing

`src/draw/` plus `src/settings/draw/` — 23 files, ~3500 lines, the largest
subsystem in the app. Inherited from upstream and the least-touched part of the
fork; trimmed once, ahead of the port off kvib.

`DrawType` is exactly six: point, line, polygon, circle, text, and `Move` (the
edit/select tool). Editing: select, translate, modify, delete, plus a
vertical-move hook. Styling: colour, line width, line style, point style, text
style. Plus undo/redo and measurement readouts.

**What the trim removed, and why it isn't coming back.** The file
import/export dialogs (`dialogs/import/`, `dialogs/ExportDialog.tsx`,
`export/`) let a drawing be written out as GeoJSON/GPX and read back in. A funn
already persists to PocketBase as it is drawn (§8.5); the dialogs were an
upstream answer to a question this fork doesn't ask, and the export half wrote
Norgeskart-branded filenames. `DrawControlsFooter.tsx` existed only to hold
their buttons plus the clear-drawing confirm — that confirm now lives inline in
`DrawControls.tsx` as a `ConfirmPopover`. The nautical-mile unit went with them
(upstream is a sea-chart viewer; this one reads inland relief), so
`MeasurementControls` is a single show/hide `Switch` on `showMeasurementsAtom`
and `formatDistance` / `formatArea` are metric-only.

One live thing was buried in the import dialog's utils: `getStyleFromProperties`
and its two siblings, which are the *load* half of the round-trip
`serializeDrawLayer.ts` writes and are read by both the editable draw layer and
the read-only funn layer. They now live in `src/draw/featureStyle.ts`, together
with the `StyleForStorage` shape that had been sitting in `src/api/nkApiClient.ts`.

Two surfaces render the same tools: `DrawToolSelector` (desktop, inside
`DrawControls`, which the dock's draft band renders) and
`BottomDrawToolSelector` (mobile, `zIndex 1000`, mounted at the shell root and
only while a funn draft is active). `DrawControls.tsx` renders the desktop
selector behind `{!isMobile && …}`, which is what keeps the two from both
appearing. The tools are icon-over-label buttons rather than a `Segmented`
row: six named tools do not fit across the width of the dock column, and the
name is what tells a first-time user what the glyph means.

In the draft band the pen comes **first** and the fields after it. That was the
other way round when the band was a ribbon row, where a single column would have
put "Lagre" off the bottom of a bar already sitting on top of the map; a column
scrolls and there is no Lagre any more, so the tools you keep reaching for come
before the fields you fill in once.

**The port off kvib.** One `src/draw/Draw.module.css` for the subsystem, on
the same reasoning as the two search modules. Line style, line width and text
size are `Segmented` — three closed sets of two or three values, which is what
that primitive is for; the graduated circles the widths used to render as were
decoration over the same S/M/L labels. Point style is a `Popover` holding a
grid of the 18 glyphs, each drawn in the current point colour (§12 on why not
a `<select>`). Undo/redo/delete are `IconButton`s under `Tooltip`, snap is the
kit `Switch` — and it finally has a translated label instead of a hardcoded
"Snap".

**Colour is the one place the port changed the control rather than its
clothes.** kvib's `ColorPicker` gave a saturation/hue/alpha surface; the
replacement is the native colour well plus a separate opacity slider, over the
same recent-colour swatches. The split is forced: `<input type="color">` is
six hex digits by definition, and alpha is load-bearing here —
`DEFAULT_SECONDARY_COLOR` is `#1d823b80`, i.e. fills are half-transparent so
the terrain stays readable under a drawn polygon. The two halves compose back
into the `#rrggbbaa` the OpenLayers styles already accept, and `splitColor`
tolerates `#rgb` / `#rrggbb` / `#rrggbbaa` because all three turn up (the
defaults carry alpha, the Text tool writes flat black and white, and the
recent list is whatever an earlier version left in localStorage). Recents are
recorded on release — blur of the well, pointer-up on the slider — not on
every frame, or the strip fills with the colours passed through on the way.

The colour labels were also an i18n hole: `draw.controls.colorStroke`,
`colorFill`, `colorText`, `colorBackground`, `colorPoint` and
`defaults.primary` / `defaults.secondary` were read by `useColorLabels` but
missing from all three locale files, so every label rendered as its own key.
They exist now, along with `opacity`, `snap` and the two line-style names.

Drawn geometry serializes through `src/localities/serializeDrawLayer.ts` into a
GeoJSON `FeatureCollection` in EPSG:4326 on the funn record. **Circles
round-trip as 64-gons** — GeoJSON has no circle primitive, so a circle drawn and
reloaded is a polygon, and re-editing it edits vertices. That is a real
behavioural wart to either accept explicitly or fix by storing centre+radius in
feature properties.

`drawControlsKeyboardEffects.ts` binds Escape (abort current shape) and Delete
(remove selection) — see the Escape carve-out in §8.4.

---

## 10. Analysis panels

Both are `DockTool` occupants of the dock's tool band (§8.2), both write to the
attachment pipeline, and both are laid out for a 360–400 px column. They differ
in where the result lands: the extract opens a fullscreen viewer, the terrain
render goes onto the map itself. They are also the one pair that really is a
single slot — `ribbonToolAtom` holds at most one — where drawing, which can be
up alongside either, is not.

**LiDAR extract** — `src/lidarExtract/LidarExtractPanel.tsx` drives style and
source selection and shows progress. The selection size and the run controls
share the top line so they stay reachable however many datasets cover the
rectangle, and the sources are a wrapping grid of cards (`auto-fill`, so a
single source stays card-sized instead of spanning a 27-inch screen). The
whole card is the `<label>`, and an unchecked source is dimmed rather than
hidden — which sources cover the rectangle is itself information.

`LidarExtractViewer.tsx` is a separate fullscreen result viewer at `--z-fixed`,
mounted way up at `App.tsx`. The viewer **moves the source
canvas DOM node** into itself with `replaceChildren` rather than re-rendering
it — a deliberate trap for anyone who assumes React owns that subtree, and the
reason the viewer cannot be casually re-parented, or the same canvas rendered
anywhere else. Its keys are capture-phase for the reason in §1. The extract is
DTM-only on purpose: an extract is meant to be read as terrain.

**Terrain** — `src/terrain/TerrainPanel.tsx`: DTM/DOM toggle, five
visualizations (hillshade, multidirectional hillshade, slope, local relief
model, sky-view factor), and live azimuth / altitude / exaggeration sliders.

**The render is on the map, not in the row.** `src/terrain/terrainOverlayLayer.ts`
puts the canvas down as a georeferenced `ol/layer/Image` at `zIndex: 1` — over
the background stack (which sets no zIndex at all), under the lokalitet
rectangles (4), the funn (5) and the theme layers (10). That ordering is the
point: relief is the ground and the heritage record goes on top of it, which is
the same argument that makes LiDAR hillshade a *background* rather than a theme
layer. Scrubbing the light therefore re-lights the terrain in place, at full
size, against everything else on screen. What is left in the panel is knobs, a
resolution readout and the two verbs.

It lives in a ~360 px dock column now, not the wide ribbon row it was written
for, and everything in it has to *wrap* rather than run off the edge. Five long
Norwegian visualization names do not fit on one line, and `Segmented`'s root is
`overflow: hidden` — so the group is clipped mid-word unless it is given the
`wrap` prop, which flows it onto more lines and turns the segment separators
into gaps over a border-coloured background. The two verbs sit in an `.actions`
row with `flex-basis: 100%` so they land on their own line together, in the same
place whether or not the reframe one is showing.

**"Flytt analysen hit"** (`localities.terrain.reframe`) moves the analysed
rectangle onto the map as it now stands. It exists because the standalone bbox
is deliberately *held* rather than tracking the view — the DEM behind it is a
real download, not a tile request — so panning off the render is a normal move
and there has to be a way back without closing and reopening the tool. It is
offered only without a lokalitet: with one, the rectangle is the lokalitet's and
"Juster området" owns it. The label used to read "Analyser utsnittet", which
named the mechanism rather than the effect and left it unclear what it did to
the analysis already on screen.

Consequences worth knowing:

- The layer is **imperative and module-level**, like `swapBackgroundLayers`, not
  an atom plus a hook. The pixels change on every slider frame and the opacity
  on every drag of its own; pushing either through jotai would re-render the
  whole shell dozens of times a second for a change no component needs to see.
  `showTerrainOverlay` / `setTerrainOverlayOpacity` / `hideTerrainOverlay` is
  the whole surface.
- `showTerrainOverlay` is show, move *and* repaint in one call, because
  `ImageCanvasSource` caches one image and `changed()` is the only way to
  invalidate it — the canvas element identity never changes, since the panel
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
- An **opacity slider** joins the light controls. Fading the render towards what
  it covers is the only way to check a suspected feature against the ortofoto or
  the topo map without losing the light you just dialled in. It is panel state
  mirrored onto the layer, and the remembered value survives a DTM→DOM rebuild.

It takes `bbox` and `locality` as **props**, and has *two entrances* — the same
button in row 1 either way, resolving to whichever rectangle is in play:

- **No lokalitet open**: `useTerrainViewport` frames the visible map into
  `terrainStandaloneBboxAtom`, and `TerrainDock` renders the panel as the sole
  occupant of its own dock. The bbox is held rather than recomputed from the live
  view: the analysis is of one fixed rectangle and the user is expected to pan
  underneath it while reading the render. **"Analyser utsnittet"** in the panel
  re-frames it onto the view as it is now — the same `frame()` the ribbon
  button calls. It exists because putting the render on the map makes panning
  off the analysed rectangle a normal move, and there was otherwise no way back
  short of closing and reopening the tool.
  Note that the rectangle is `viewportBbox`'s **inset** viewport, the same one
  "Ny lokalitet" uses, so the render stops short of the screen edges. That is
  deliberate — the two have to agree about what "the visible map" means, the
  span guard rides on it, the free area is what `chromeInsets` reports, and the
  rectangle may become a lokalitet — and the visible margin doubles as the
  affordance for exactly which ground is being analysed.
- **A lokalitet open**: `ribbonToolAtom` goes to `'terrain'` and the panel
  renders in that lokalitet's dock, over its own bbox. "Juster området" owns the
  rectangle here.

They can never both be live: `useGroundMode` routes the button to one or the
other depending on whether a lokalitet is open, and opening a lokalitet clears
the standalone bbox. That matters because two live controls for one surface
would disagree about which rectangle "Lagre" keeps — which is exactly what row
2's duplicate Terreng verb used to cause, and why it is gone. Passing the
lokalitet's bbox as a prop rather than copying it into an atom is also what
makes "Juster området" refetch the DEM for free.

"Lagre" accordingly has two paths: with a lokalitet, save the attachment; with
none, `createLocalityFromBbox` over **the analysed rectangle** (not the current
view — the map is live underneath the panel) and then save into it, opening the
new lokalitet as the receipt. Signed out it opens `AuthDialog` instead; that is
a normal state here, since the whole point of Terreng in row 1 is that reading
the ground needs no account.

Two things in that file must not be undone:

- The sliders are **raw `<input type="range">`** (`SliderRow`) rather than a
  component-library slider: sweeping the light smoothly needs a continuous
  input stream during the drag, and the numeric value is rendered next to the
  label anyway. They are safe from W/S cycling because
  `useBackgroundCyclingKeys` bails on `INPUT` targets.
- The two `useMemo`s are **split on purpose**: sky-view factor takes ~800 ms on
  a 600² grid and must never be keyed on azimuth, or dragging the azimuth
  slider queues a multi-second recompute per frame. The split survives the move
  of the arithmetic into `src/terrain/render.ts` — that module exports
  `terrainStaticField` (expensive, sun-independent) and `terrainField` (cheap,
  sun-dependent) as *two* functions for exactly this reason, and the panel
  memoizes each. Its one-call `renderTerrain` is for headless callers with no
  slider to drag (§8.9).

The canvas itself is **off-DOM**. React does not own it and neither does the
row: it is the OL source's image and what "Lagre" hands to the figure stage,
and the panel paints into that one element. Same trap as
`LidarExtractViewer`'s moved canvas node, from the other direction.

Neither panel's output leaves bare. "Behold", the viewer's PNG download and
"Lagre" all run their canvas through `renderFigureBlob` first, so the azimuth,
altitude, z-factor, radii and stretch that produced the render travel with the
pixels — §8.10. On the no-lokalitet path the lokalitet is created *before* the
figure, so the name the registers just derived can be its title.

The algorithmic side of all this is `docs/terrain-analysis.md`; the panel is
only the control surface.

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
whole shell and ribbon, the lokalitet surfaces (`FunnList`, `BilderSection`,
`KulturminnerSection`, `LocalityDetails`, `LocalityDialogs`, `FunnDraft`,
`LocalitiesPanel`), both analysis panels, `AuthButton`, `AuthDialog`,
`ErrorBoundary`, the measure trigger, the toast region, `MapComponent`,
`SearchComponent`, `KulturminnerPopup`, `LidarExtractViewer`, `MapToolCards`,
`MapThemes`/`SubTheme`, `HelpPage`, `LanguageSwitcher`, the whole of
`src/search/**` — results panel and infobox — and the whole of `src/draw/**`.
So `src/terrain/`, `src/settings/`, `src/auth/`, `src/lidarExtract/`,
`src/localities/`, `src/help/`, `src/languageswitcher/`, `src/search/`,
`src/draw/` and `src/map/` are all clear.

The kit needed nothing more to absorb the last of it. The wanted-primitives
list used to say `Accordion`, `Select`, `Pagination` and `Alert`:

- **`Accordion` is not coming.** Every kvib accordion in this app is
  `collapsible multiple`, i.e. a stack of independent disclosures, which is
  exactly the controlled `Section` the workspace already uses. The call site
  owns the open set (a `string[]` in `MapThemes` and `InfoBoxSections`, a
  single `string | null` per card in `HelpPage`) and gets
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
click the map for a coordinate + elevation readout.

**Choose what the terrain looks like** — the core of the tool
switch Standard / LiDAR / Hybrid / Flyfoto / Terreng, by button or by digits
1–5; hold X to peek at the ground you were on before and release to snap back;
pick the national mosaic or any per-project LiDAR dataset; see datasets ranked
by relevance to the current viewport and expand to the less relevant ones;
preview a project's footprint on hover; pick a render style and expand to the
full style list; switch DTM / DOM; pick the seamless ortofoto mosaic or any
historical acquisition covering the viewport; cycle styles with A/D, the active
mode's datasets with W/S, model with E, without opening any pulldown or
occluding the map; put a second ground on the right of a draggable curtain
(Sammenlign), pick which one, drag the seam with the pointer or nudge it with
the arrow keys once it has focus, and leave to take the second stack back down;
hide your own marks with H or the ribbon button so they do not cover the ground
you are judging, and bring them back the same way.

**Overlay the heritage record**
toggle the five Kulturminner layers as a group; open the Kartlag card and toggle
layers individually; see the active-layer count; clear all theme layers; click a
heritage feature for its attributes; deep-link the active layers via
`?themeLayers`.

**Measure**
distance and area, with live on-map tooltips; clear the measurement.

**Own an area**
sign in (OAuth or password); create a lokalitet from the visible map and have it
named after the nearest stedsnavn; rename it; describe it; read and edit its
sted, kommune and matrikkel, pre-filled from the registers; re-ask the registers
for them after moving the rectangle; read its centre coordinate and area; search
your lokaliteter by any of those; set visibility (private / limited / public);
adjust the rectangle afterwards (translate + modify); delete it; browse "Mine
lokaliteter"; click a rectangle on the map to open it; see which known
kulturminner already fall inside it; fold the dock away to see the map and
unfold it from the tab that stays behind.

**Record what you find**
arm the pen and have the first finished shape become a saved funn, auto-named
and undoable from its toast; draw as point, line, polygon, circle or text; style
it (colour, width, line style, point style, text style); select, move, reshape,
vertex-edit and delete geometry, with every change written back on its own;
undo/redo; show or hide measurements on the drawing; rename a funn; note it; set
its status (mulig / sannsynlig / avkreftet / rapportert); re-edit an existing
funn's drawing; zoom to it; walk the funn list with ↑/↓/Enter; click or hover a
funn on the map to select it in the list, and the reverse; grow the lokalitet
when a funn escapes it.

**Analyse it**
run terrain analysis (DTM or DOM) with five visualizations and live azimuth /
altitude / exaggeration / opacity over *either* the visible map — signed out,
with no lokalitet — or an open lokalitet's rectangle, with the render drawn on
the map under the heritage layers; re-frame the analysed rectangle onto the
current view; save the render (creating the lokalitet if there is none); run a
LiDAR extract over the rectangle at a chosen
source and resolution, view it fullscreen, keep it as a Bilde; fetch flyfoto —
the seamless mosaic or any historical acquisition covering the area,
individually or as a batch; take a map screenshot; upload an image; or press
**Hent grunnpakke** once and get the newest flyfoto, the best LiDAR hillshade
and a multidirectional relief render fetched in sequence into Bilder, with
progress in that section.

**Keep it**
browse the Bilder gallery; open the lightbox; caption an attachment; delete one;
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
- Dragging the compare seam under the dock is possible and pointless — the
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
`isMobile` gate. Closed by the dock work: chrome that ate 500 px of the map,
hard-coded `view.fit` paddings that could not know about it, the orange wash
over the relief, funn that were only linked to the list in one direction,
Terreng existing twice with two different rectangles, and the silent
`cancelDraft` that discarded a drawing from five call sites.
