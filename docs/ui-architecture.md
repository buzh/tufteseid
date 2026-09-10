# UI architecture — the status quo, and the contract a replacement inherits

The interface was inherited Norgeskart chrome, de-branded and extended sideways
until it carried features it was never shaped for. It is being replaced. The
first slice of that landed: the map is now the full window, the chrome is a
**ribbon** floating over it, the lokalitet workspace lives in the ribbon rather
than in a panel covering the terrain, and new code is on an in-repo plain-CSS
kit (`src/ui`) instead of kvib — which is now gone entirely (§12).

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

**One surface, one occupant, never both.** Drawing a funn, running a LiDAR
extract and reading terrain each take a surface over completely; they are not
panels that stack. `workspaceModeAtom` (`src/localities/toolAtoms.ts`) derives
the single answer — `'draft' | 'lidar' | 'terrain' | 'browse'` — from
`funnDraftActiveAtom` and `ribbonToolAtom`, and the ribbon renders the tray
only in `browse`. `MapTool` (`'layers' | 'measure' | 'localities' | null`,
`src/map/overlay/atoms.ts`) is separate state again, so a map tool card and an
open lokalitet cannot fight over the same real estate. Whatever comes next
needs an equivalent story for "these surfaces are mutually exclusive", or the
fight comes back.

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
    │     └── Ribbon           ← row 1, then rows 2–4 as context appears
    └── .row      flex:1  min-height:0  position:relative  pointer-events:none
          ├── .left    absolute top/left/bottom   SearchComponent + MapToolCards
          └── .right   absolute top/right         InfoBox
```

Siblings of the whole thing: `BottomDrawToolSelector` (mobile only, only while
a funn draft is active), `KulturminnerPopup`, `AuthDialog`.

Four details that are easy to lose:

- **No height measurement anywhere.** `.overlay` is an ordinary flow column
  that *contains* the ribbon, so the ribbon's natural height pushes the slots
  below it down with zero JS — no ResizeObserver, no CSS variable. Growing a
  ribbon row therefore costs nothing, and because the OL canvas never resizes
  it provokes no new GetMap requests. The old `calc(100vh - 65px)` /
  `calc(100vh - 80px)` guesses at the header height are gone; the slots have a
  definite height and their cards say `100%`.
- **The one place the ribbon's height *is* read** is
  `viewportBbox` in `src/localities/createFromBbox.ts`, which measures
  `[data-ribbon]` with `getBoundingClientRect()` to inset the top of a
  new rectangle. Measured, not a constant: the bar grows a row per level of
  context and wraps on narrow screens.
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

Error boundaries are per row and per tray column, not one around the bar: a
crash in the terrain row should not take the search field and the background
controls with it, and the map underneath stays usable either way — which is the
whole reason the chrome floats over it.

### 3.2 Where map side-effects mount

`src/map/MapComponent.tsx` is 39 lines and renders essentially a target div —
but it is the **only** mount point for three atom effects (`themeLayerEffect`,
`trackPostitionAtomEffect`, `backgroundLayerAtomEffect`).

Everything else is `src/shell/useMapSideEffects.ts`, called once by `AppShell`:
`useFeatureInfoClick`, `useSearchEffects`, `useMapClickSearch`,
`useLocalitiesLayer`, `useFunnLayer`, `useFunnHighlightLayer`,
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
and theme layers at 2–3, active theme layer promoted to 10, terrain render 1,
lidar footprints 3, localities 4, funn highlight 4.5, funn 5, locality draft 7,
lidar extract selection 7, locality adjust 8. The fractional 4.5 is the tell
that this ladder grew by insertion rather than design.

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
  `lidarPickerOpenAtom`, `lidarCyclingAtom`, `activeFlyfotoProjectAtom`, plus
  the viewport project list. The flyfoto acquisition list is *not* an atom —
  nothing draws its footprints, so it is component state in
  `useFlyfotoControls`.
- **Theme layers** — `activeThemeLayersAtom` (a `Set<ThemeLayerName>`).
- **Chrome** — `mapToolAtom`, `overlayOpenCountAtom` / `anyOverlayOpenAtom`
  (`src/ui/overlayAtoms.ts`, incremented by every `Popover` and `Dialog` so the
  keyboard layers can stand down).
- **Ribbon / workspace** — `ribbonToolAtom`, the derived `workspaceModeAtom`,
  `trayOpenAtom`, `growPromptAtom` (`src/localities/toolAtoms.ts`), and
  `terrainStandaloneBboxAtom` (`src/terrain/atoms.ts`).
- **Search** — query, results, selected result, marker, infobox visibility.
- **Feature info** — the clicked-position readout and the Kulturminner popup.
- **Draw** — the largest single cluster (`src/settings/draw/atoms.ts`, 375
  lines): active tool, colour, line width, line style, point style, text style,
  measurement toggles, undo/redo stacks.
- **Lokaliteter** — `activeLocalityAtom`, `funnDraftActiveAtom`, selection,
  content caches.
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

`src/shell/Ribbon.tsx` and the components around it. One row per level of
context, and rows appear and disappear rather than the bar having a fixed
height:

| Row | Component | When |
|---|---|---|
| 1 — the map | `RibbonGlobalRow` | always |
| 2 — the lokalitet | `RibbonLocalityRow` | a lokalitet is open |
| 3 — the tool | `RibbonToolRow` (draft, lidar) / `RibbonTerrainRow` | a tool has the surface |
| 4 — the tray | `Tray` | a lokalitet is open and no tool has the surface |

Rows 2–4 are grouped under `LocalityRibbon`, which is the **one** mount point
for `useLocalityWorkspace` — that hook opens two PocketBase realtime
subscriptions that reload the whole list on every event, so a second call site
doubles both. Terrain is the exception and hangs off `Ribbon` directly, because
it works with no lokalitet and no account (§10).

On narrow screens the rows wrap onto more lines. The old TopBar's answer to
"fourteen controls do not fit on a phone" was `overflowX: auto` on the whole
bar, which made the pulldowns inside it clip; that is gone.

### 5.1 Row 1, left to right

Left to right, and the order is the argument: find a place, choose what the
ground looks like, overlay the heritage record on it, then act on what you are
looking at.

| Control | What it does |
|---|---|
| `RibbonSearch` | Place/address/property search field; results render in the left slot (§7) |
| **Standard** | Background mode: topo basemap |
| **LiDAR** | Background mode: hillshade stack |
| **Hybrid** | LiDAR stack + transparent roads/rail/place-names on top |
| **Flyfoto** | Background mode: NiB ortofoto (§5.5) |
| Dataset pulldown | LiDAR: national mosaic or one of ~1936 per-project datasets, ranked by relevance to the viewport. Flyfoto: the seamless mosaic or any acquisition covering the viewport, newest first |
| Style pulldown | The active LiDAR dataset's WMS styles, with a "flere stiler" second tier |
| DTM / DOM segment | Terrain model vs surface model |
| **Kulturminner** | Toggles the five Riksantikvaren theme layers as a group |
| **Kartlag** | Opens the theme-layer card (`MapTool = 'layers'`) |
| Mål | Popover with the measure tools |
| **Terreng** | Terrain analysis of the visible map — no lokalitet, no account (§10). Hidden while a lokalitet is open, because row 2 carries the same verb scoped to its rectangle |
| Mine lokaliteter | Opens the localities card (signed in only) |
| Ny lokalitet | Creates a lokalitet from the visible map (signed in only, §5.6) |
| `RibbonAccount` | Sign in / account menu |

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

Switching to Flyfoto deliberately leaves `hybridOverlayAtom` alone rather than
clearing it: it is a LiDAR modifier, inert in flyfoto mode, and switching back
should return you to the stack you left.

### 5.3 Keyboard cycling

One `document` keydown listener, with `[]` deps and a mutable ref for the
current handler — the lists it closes over are rebuilt on every render, so the
alternative is re-attaching the listener continuously:

- **A / D** — previous / next LiDAR style, top tier only, wrapping at both ends.
- **W / S** — previous / next dataset in **the active mode's ring**: LiDAR
  projects in LiDAR mode, ortofoto acquisitions in flyfoto mode.
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
first. `lidarCyclingAtom` expires `CYCLING_IDLE_MS = 90_000` after the last
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
behaviour, via `useRegisterBackgroundCycle`, and chains the two halves —
`flyfoto.cycle(key) || lidar.cycle(key)`. Each half declines every key outside
its own mode, so the order decides who is asked first, not who gets it. There
is exactly one registered handler.

It follows the §1 discipline: capture phase, handled keys stopped with
`preventDefault` + `stopPropagation` + `stopImmediatePropagation`, and the same
input / `[data-scope]` guard as `useWorkspaceKeys`. Both listeners additionally
consult `anyOverlayOpenAtom` (`src/ui/overlayAtoms.ts`) — a focus-independent
second check, because the `[data-scope]` walk starts at `event.target` and only
reaches the attribute if the overlay actually took focus.

### 5.4 Internationalisation

The TopBar put exactly four strings through `t()` and hardcoded the rest. The
ribbon puts **all** of them through it, under a `ribbon.*` namespace
(`mode`, `lidar`, `flyfoto`, `heritage`, `layers`, `search`, `terrain`,
`tray`) in all three locales.

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
did; the notice gates *grab-and-keep* (§8.5), which is a different act.

### 5.6 Ny lokalitet from the viewport

Pressing it creates a lokalitet immediately from the rectangle you can see. No
box-drag to arm, no dialog to fill in: `viewportBbox` in
`src/localities/createFromBbox.ts` insets the visible map — the ribbon's
measured height plus a gap at the top, a percentage of the dimension on the
other three sides — and `createLocalityFromBbox` turns it into a record.

Details worth not re-deriving:

- **Inset pixel corners through `map.getCoordinateFromPixel`**, not
  `calculateExtent` with a ratio. `calculateExtent` is symmetric about the view
  centre and the ribbon is asymmetric (top only), so no ratio clears the bar
  without over-insetting the other three edges.
- **A zoom guard.** `minZoom: 3` means the viewport can be most of Norway, and
  opening the workspace fires a WFS BBOX query over whatever you framed. Too
  large a span is refused with a toast rather than created.
- **The workspace opens only after `createLocality` resolves.** "Juster
  området" builds its extent from the bbox in the closure when `adjusting`
  flipped true, so an optimistic placeholder record would have it edit a stale
  rectangle.

The bbox stays **authored, not derived**: the viewport only seeds it, and
"Juster området" still translates and reshapes it afterwards.

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

There is no workspace *panel* any more. The state is one controller hook,
`src/localities/useLocalityWorkspace.ts` (854 lines), and the presentation is
ribbon rows that consume it:

| Region | Component | Contents |
|---|---|---|
| Identity + verbs | `RibbonLocalityRow` | back, inline-editable name, visibility badge, summary line, zoom-to, delete; then Nytt funn · LiDAR-uttrekk · Terreng · Bilde · Flyfoto · Last opp · Juster området |
| Tool surface | `RibbonToolRow` / `RibbonTerrainRow` | whichever of draft / lidar / terrain has the surface |
| Tray | `Tray` | Funn · Bilder · Kulturminner + Detaljer, as columns |
| Dialogs | `LocalityDialogs` | grow-to-fit confirmation, flyfoto licensing notice, flyfoto picker |

The mode switch survived the move and is still the core idea:
`workspaceModeAtom` derives `'draft' | 'lidar' | 'terrain' | 'browse'`, the
tray renders only in `browse`, and a tool row renders otherwise. One surface
becomes the tool you asked for rather than tool panels stacking. It is also
why `useWorkspaceKeys` takes a `navigable` flag — arrow keys walk the funn list
in `browse` and mean nothing in `lidar`.

Splitting the old panel into rows removed the `key={locality.id}` remount that
used to reset its `useState`, which is why the state had to move into the
controller first. What stays component-local is the half-typed name in
`LocalityName`, still keyed on `locality.id` for exactly that reason.

`LocalityRibbon` is the single mount point for the controller (§5): the hook
holds two PocketBase realtime subscriptions that reload the whole list on every
event.

### 8.2 The tray

Three columns side by side above `md`, stacked below, each with its own scroll
and its own error boundary — the Bilder column fetches short-lived file tokens
and the Kulturminner column hits an external WFS, and either failing should
cost you that column rather than the funn list next to it. The whole tray folds
away; `trayOpenAtom` is module-level so a trip through the terrain panel does
not silently unfold it again.

`FunnList` (per-row status, rename, zoom-to, delete), `BilderSection`
(attachment gallery with lightbox), `KulturminnerSection` (the "kjente
kulturminner her" readout from GeoNorge's WFS redistribution of the
Riksantikvaren register — `kart.ra.no` has WFS disabled, hence the detour), and
`LocalityDetails` (description, metadata) tucked under Kulturminner rather than
given a fourth column, because it is the one section you set once and stop
looking at.

`src/localities/ui.tsx` is gone: its vocabulary moved into `src/ui/` and is now
shared with the shell. `WorkspaceSection` became `Section`; `NoteInput`,
`Segmented` and `ConfirmPopover` kept their names. `ConfirmPopover` still
exists specifically to replace `window.confirm`, which cannot be styled and
blocks the event loop while the map keeps rendering behind it. The
`BadgePalette` / `ButtonPalette` colour maps are token classes now instead of
kvib `colorPalette` strings, and still keep funn status colours consistent
between the list and the map.

### 8.3 Keyboard

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
| N | New funn |
| U | Toggle LiDAR extract |
| B | Screenshot |
| Escape | Close / back out — **except while a funn draft is open** |

That Escape carve-out is deliberate: `DrawControls` binds Escape to abort the
shape currently being sketched, and stealing it would throw away a drawing
instead of a keystroke.

### 8.4 The attachment pipeline

Four producers converge on one sink, and that convergence is the part worth
preserving:

```
screenshot.ts        ─┐
flyfoto.ts           ─┤
lidarExtract "Behold" ├→ createAttachment()  →  PocketBase  →  realtime  →  BilderSection
terrain "Lagre"      ─┘
```

`kind` is one of `extract | screenshot | upload | flyfoto`; terrain renders
reuse `extract` with the visualization recorded in `meta.style`, which is why
adding terrain analysis needed no migration. `meta` also carries source
key/label, `metresPerPx`, bbox, and for flyfoto the `projectName` / `year` /
`photoDate` that the gallery captions from ("Flyfoto 1937"). Files are
`protected` in PocketBase, so the gallery fetches short-lived file tokens for
thumbnails — a new UI must keep doing that or every thumbnail 403s.

### 8.5 The flyfoto picker

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
already persists to PocketBase on save; the dialogs were an upstream answer to
a question this fork doesn't ask, and the export half additionally wrote
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
`DrawControls`, which the draft row of the ribbon renders) and
`BottomDrawToolSelector` (mobile, `zIndex 1000`, mounted at the shell root and
only while a funn draft is active). `DrawControls.tsx` renders the desktop
selector behind `{!isMobile && …}`, which is what keeps the two from both
appearing. The tools are icon-over-label buttons rather than a `Segmented`
row: six named tools do not fit across the 320px the draft row gives the
drawing column, and the name is what tells a first-time user what the glyph
means.

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
(remove selection) — see the Escape carve-out in §8.3.

---

## 10. Analysis panels

Both are row-3 surfaces, both write to the attachment pipeline, and both are
laid out for a wide row rather than a 400 px column — which is an upgrade for
them, not a compromise. They differ in where the result lands: the extract
opens a fullscreen viewer, the terrain render goes onto the map itself.

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
size, against everything else on screen. What is left in the row is knobs, a
resolution readout and the two verbs, so it stays a couple of lines tall.

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

It takes `bbox` and `locality` as **props**, and has *two entrances*:

- **Row 1's "Terreng"**, with no lokalitet and no account. `useTerrainViewport`
  frames the visible map into `terrainStandaloneBboxAtom`, and `Ribbon` renders
  the surface off that. The bbox is held rather than recomputed from the live
  view: the analysis is of one fixed rectangle and the user is expected to pan
  underneath it while reading the render. **"Analyser utsnittet"** in the panel
  re-frames it onto the view as it is now — the same `frame()` the ribbon
  button calls. It exists because putting the render on the map makes panning
  off the analysed rectangle a normal move, and there was otherwise no way back
  short of closing and reopening the tool. Hidden with a lokalitet open, where
  "Juster området" in row 2 owns the rectangle.
  Note that the rectangle is `viewportBbox`'s **inset** viewport, the same one
  "Ny lokalitet" uses, so the render stops short of the screen edges. That is
  deliberate — the two have to agree about what "the visible map" means, the
  span guard rides on it, and the rectangle may become a lokalitet — and the
  visible margin doubles as the affordance for exactly which ground is being
  analysed.
- **Row 2's "Terreng"**, over the open lokalitet's own bbox, via
  `ribbonToolAtom`.

They can never both be live — row 1's button is hidden while a lokalitet is
open, and opening a lokalitet clears the standalone bbox — because two controls
for one surface would disagree about which rectangle "Lagre" keeps. Passing the
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
  slider queues a multi-second recompute per frame.

The canvas itself is **off-DOM**. React does not own it and neither does the
row: it is the OL source's image and the blob "Lagre" keeps, and the panel
paints into that one element. Same trap as `LidarExtractViewer`'s moved canvas
node, from the other direction.

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
selectors in the keyboard layers (§1, §8.3). kvib's Ark primitives set those
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
  root `dependencies` block of `package-lock.json`, by hand and in step. The
  kvib subtree is still *in* the lock (nothing depends on it, and pruning it
  by hand would be a hundred entries deep); the next person with a toolchain
  should run `npm install` once to drop it.

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
switch Standard / LiDAR / Hybrid / Flyfoto; pick the national mosaic or any
per-project LiDAR dataset; see datasets ranked by relevance to the current
viewport and expand to the less relevant ones; preview a project's footprint on
hover; pick a render style and expand to the full style list; switch DTM / DOM;
pick the seamless ortofoto mosaic or any historical acquisition covering the
viewport; cycle styles with A/D, the active mode's datasets with W/S, model
with E, without opening any pulldown or occluding the map.

**Overlay the heritage record**
toggle the five Kulturminner layers as a group; open the Kartlag card and toggle
layers individually; see the active-layer count; clear all theme layers; click a
heritage feature for its attributes; deep-link the active layers via
`?themeLayers`.

**Measure**
distance and area, with live on-map tooltips; clear the measurement.

**Own an area**
sign in (OAuth or password); create a lokalitet from the visible map; rename it;
describe it; set visibility (private / limited / public); adjust the rectangle
afterwards (translate + modify); delete it; browse "Mine lokaliteter"; click a
rectangle on the map to open it; see which known kulturminner already fall
inside it.

**Record what you find**
create a funn; draw it as point, line, polygon, circle or text; style it
(colour, width, line style, point style, text style); select, move, reshape,
vertex-edit and delete geometry; undo/redo; show or hide measurements on the
drawing; name a funn; note it; set its status (mulig / sannsynlig / avkreftet /
rapportert); zoom to it; walk the funn list with ↑/↓/Enter; grow the lokalitet
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
individually or as a batch; take a map screenshot; upload an image.

**Keep it**
browse the Bilder gallery; open the lightbox; caption an attachment; delete one;
see flyfoto captioned with its acquisition year.

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
- The layer z-index ladder contains a `4.5`.
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
`isMobile` gate.
