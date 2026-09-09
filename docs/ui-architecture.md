# UI architecture — the status quo, and the contract a replacement inherits

The interface is a placeholder. It is inherited Norgeskart chrome, de-branded
and extended sideways until it carried features it was never shaped for, and it
is expected to be replaced wholesale. This document exists so that replacement
can be planned without archaeology: what is on screen today, what holds it up,
which parts are load-bearing engineering and which are accidents of the fork,
and — most importantly — **the complete inventory of things a user can do**, so
none of it gets dropped on the way across.

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

**One left slot, two occupants, never both.** The left overlay column holds
*either* the lokalitet workspace *or* search-plus-tool-card. `MapTool` (`'layers'
| 'measure' | 'localities' | null`, declared in `src/Layout.tsx:30`) and
`activeLocalityAtom` are deliberately separate state, so a map tool and an open
workspace cannot fight over the same real estate. Drawing, LiDAR extract and
terrain analysis are *not* MapTools — they are modes *inside* the workspace.
Whatever the new shell looks like, it needs an equivalent story for "these
surfaces are mutually exclusive", or the fight comes back.

**OL interactions are owned, not scanned for.** `src/map/interactions.ts` tags
every interaction with an owner (`draw`, `measure`, `localityCreate`,
`localityAdjust`, `lidarExtract`) on the way in and filters by owner on the way
out. Five tools add the same OL classes; before tagging, "remove every `Draw`"
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
`useWorkspaceKeys`, `useLidarCyclingKeys` and `LidarExtractViewer` all do this.

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
| Design system | `@kvib/react` ^6.2.2 | Kartverket's Chakra v3 system |
| State | jotai ^2.20.3 + `jotai-effect` | default store, no `<Provider>` |
| Map | OpenLayers ^10.10.0 | EPSG:25833 via proj4 |
| Backend | PocketBase JS SDK ^0.28 | lokaliteter, auth, attachments |
| Server state | `@tanstack/react-query` | one consumer: the elevation lookup |
| i18n | i18next / react-i18next | nb, nn, en |
| Icons | `material-symbols` (rounded) | typed union, see §11 |
| Routing | react-router-dom | two routes: `/` and `/hjelp` |

**kvib is used bare.** `<KvibProvider>` is mounted with no props — no theme
object, no token overrides, no colour-mode wiring. There is no dark mode. The
palette is whatever kvib ships plus a scattering of literal hex values in JSX
(`#FFDD9D` for the theme-layer count badge, `rgba(233,229,229,0.7)` for the
scale bar, `#FFFF` for card backgrounds). The de-branding removed Kartverket's
identity from strings and assets but **not** from the component library, which
is still visually Kartverket's. Whether that is acceptable is a live product
question a redesign has to answer, not a technical constraint.

**Total hand-written CSS is 89 lines** — `src/index.css` (10) and
`src/map/map.css` (79). The latter is entirely OL control skinning: the
`.ol-scale-line` position (with a mobile breakpoint that recentres it), the
`.ol-tooltip` family used by the measure and draw tools, a `.hidden` utility
that `drawControls/drawUtils.ts` toggles via `classList`, and
`#map { touch-action: none }`. All of it survives a React rewrite unchanged as
long as the same class names reach the DOM.

---

## 3. Boot and the component tree

```
main.tsx → mainApp.tsx
  StrictMode
    BrowserRouter
      AtomWrapper            ← hydrates activeThemeLayersAtom from ?themeLayers
        QueryClientProvider
          KvibProvider
            App              ← routes + F11 fullscreen + LidarExtractViewer
            Toaster
```

`projInit()` runs at module scope in `mainApp.tsx`, before render — proj4 has to
know EPSG:25833 before any atom touches a coordinate.

`AtomWrapper` hydrates exactly one atom, and its comment records why it is only
one: `backgroundLayerAtom` validates its own URL parameter against a whitelist
in its default-init function, and hydrating it a second time here would bypass
that check and could leave the atom on a value the effect cannot render (e.g.
`lidarProject` with no active project), i.e. a blank map on cold load.

`App.tsx` renders `<LidarExtractViewer />` **outside** the router, so the
fullscreen extract viewer survives navigation, then routes `/` → `Layout` and
`/hjelp` → `HelpPage`.

### 3.1 Layout geometry

`src/Layout.tsx` (148 lines) is the entire chrome, and it is worth reading in
full before designing a replacement — it is short, and it is where all the slot
geometry lives.

```
Flex  flexDir=column  h=100dvh  w=100dvw  overflow=hidden  bg=gray.200
├── TopBar                                        h 56px (base) / 60px (md)
└── Box  flex=1  position=relative  overflow=hidden        ← positioning context
    ├── MapComponent                              the OL target div, full bleed
    ├── Box  position=absolute  top/left/bottom=0          ← LEFT COLUMN
    │     w = activeLocality ? {base 100%, md 400px, lg 440px}
    │                        : {base 100%, md 360px, lg 400px}
    │     pointerEvents=none   zIndex=2   overflowY=auto
    │     ├── LocalityWorkspace   (key={locality.id})      when a lokalitet is open
    │     └── SearchComponent + MapToolCards               otherwise
    └── Box  position=absolute  top/right=0                ← RIGHT COLUMN
          pointerEvents=none   zIndex=2
          └── InfoBox
```

Outside that flex column, as siblings of the whole thing: `BottomDrawToolSelector`
(mobile only, only while a funn draft is active), `KulturminnerPopup`,
`AuthDialog`.

Two details that are easy to lose:

- **`pointerEvents="none"` on the columns, `"auto"` on the cards inside them.**
  The columns span the full map height so their children can flow, but the map
  must stay draggable through the empty parts. Every panel re-enables pointer
  events on itself. Miss this and the left 400px of the map becomes dead to
  panning.
- **The workspace is keyed on `locality.id`.** Swapping lokalitet remounts it,
  which resets all the local form state and lets `autoFocus` re-apply for a new
  record. Without the key, opening a second lokalitet shows the first one's
  half-typed name.

Every subtree is individually wrapped in `<ErrorBoundary name="…">`, so a crash
in the TopBar does not take the map with it.

### 3.2 Where map side-effects mount

`src/map/MapComponent.tsx` is 41 lines and renders essentially a target div —
but it is the **only** mount point for three atom effects (`themeLayerEffect`,
`trackPostitionAtomEffect`, `backgroundLayerAtomEffect`). `Layout` mounts ten
more hooks (`useFeatureInfoClick`, `useSearchEffects`, `useMapClickSearch`,
`useLocalitiesLayer`, `useFunnLayer`, `useFunnHighlightLayer`,
`useLocalityClick`, `useLocalityCreate`, `useLidarFootprintsLayer`,
`pbAuthSyncEffect`).

This is the sharpest coupling between "the UI" and "the map": these are not
presentational components, they are the wiring that puts layers on the map, and
they happen to be mounted by chrome components. A replacement shell must keep
mounting them (or move them somewhere deliberate) — deleting `Layout.tsx`
without accounting for its hook list silently removes the lokalitet rectangles,
the funn layer, feature-info clicks and the auth sync.

### 3.3 Stacking order

Two independent ladders. **OL layer `zIndex`** (map-internal): background stack
and theme layers at 2–3, active theme layer promoted to 10, lidar footprints 3,
localities 4, funn highlight 4.5, funn 5, locality draft 7, lidar extract
selection 7, locality adjust 8. The fractional 4.5 is the tell that this ladder
grew by insertion rather than design.

**DOM `zIndex`** (chrome): overlay columns 2, workspace sticky action bar 1
(local to the workspace's own stacking context), TopBar 20,
`BottomDrawToolSelector` 1000, `LidarExtractViewer` 1000, and the language
switcher's `SelectContent` at a raw `9999` because it otherwise renders behind
the TopBar. Consolidating these into named tokens is free work for a rewrite.

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
  `lidarPickerOpenAtom`, `lidarCyclingAtom`, plus the viewport project list.
- **Theme layers** — `activeThemeLayersAtom` (a `Set<ThemeLayerName>`).
- **Chrome** — `mapToolAtom`.
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

## 5. The TopBar

`src/TopBar.tsx`, 1132 lines, one file. It is the densest thing in the codebase
and the single strongest argument for the refresh.

Root is `Flex as="header" h={{base:'56px', md:'60px'}} zIndex={20}` with
`overflowX={{base:'auto', md:'visible'}}` — **on mobile the entire bar
horizontally scrolls**, which is the current answer to "fourteen controls do not
fit on a phone". It is not a good answer; the pulldowns inside a scroll
container clip awkwardly.

### 5.1 Controls, left to right

| Control | What it does |
|---|---|
| Search field | Place/address/property search (§7) |
| **Standard** | Background mode: topo basemap |
| **LiDAR** | Background mode: hillshade stack |
| **Hybrid** | LiDAR stack + transparent roads/rail/place-names on top |
| Dataset pulldown | National mosaic, or one of ~1936 per-project LiDAR datasets, ranked by relevance to the viewport |
| Style pulldown | The active dataset's WMS styles (relief, slope, …), with a "flere stiler" second tier |
| DTM / DOM segment | Terrain model vs surface model |
| **Kulturminner** | Toggles the five Riksantikvaren theme layers as a group |
| **Kartlag** | Opens the theme-layer card (`MapTool = 'layers'`) |
| **Flyfoto ↗** | External link out to Norge i bilder — *not* the lokalitet flyfoto grab |
| Measure | Popover with the measure tools |
| Mine lokaliteter | Opens the localities card (signed in only) |
| Ny lokalitet | Arms the box-drag (signed in only) |
| AuthButton | Sign in / account menu |

The dataset and style pulldowns are the interesting ones and the reason the file
is a thousand lines. Both are custom disclosures (`LidarDisclosure`,
`LidarPulldownItem`) rather than kvib menus, because each row needs a two-line
label, a relevance badge, an on-hover map preview of the project footprint, and
a tiering split ("mindre relevante" / "flere stiler" collapsed behind a second
disclosure). The dataset pulldown additionally shows a spinner while the
viewport WFS query is in flight.

Local sub-components, all private to the file: `CountBadge` (:71),
`LabelledToggleButton` (:96), `ModelToggle` (:151), `ToolButton` (:189),
`LidarPulldownItem` (:225), `LidarDisclosure` (:285).

### 5.2 Modes vs modifiers

A distinction the UI encodes and a redesign should preserve, because it keeps
the control count down: **Standard / LiDAR are modes; Hybrid, DTM/DOM and the
style pick are modifiers.** Hybrid is not a fourth background — it is
`hybridOverlayAtom`, a flag on top of the LiDAR stack, so the dataset picker,
style picker and keyboard cycling all keep working underneath it. Same for
DTM/DOM. Modelling either as a mode would multiply the mode buttons and break
cycling.

### 5.3 Keyboard cycling

One `document` keydown listener (search for `cycleRef`), with `[]` deps and a
mutable ref for the current state — the lists it closes over are rebuilt on
every render, so the alternative is re-attaching the listener continuously:

- **A / D** — previous / next style, top tier only, wrapping at both ends.
- **W / S** — previous / next dataset, top tier only, wrapping.
- **E** — toggle DTM / DOM.

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

The listener itself is **not** in the TopBar. It lives in
`src/map/useLidarCyclingKeys.ts` and is mounted at the shell root, because it
registers with `[]` deps: a host that unmounts (a collapsing ribbon row) would
re-register and flip its position in the capture chain relative to the other
keyboard layers. The TopBar publishes only the behaviour, via
`useRegisterLidarCycle`.

It follows the §1 discipline: capture phase, handled keys stopped with
`preventDefault` + `stopPropagation` + `stopImmediatePropagation`, and the same
input / `[data-scope]` guard as `useWorkspaceKeys`. Both listeners additionally
consult `anyOverlayOpenAtom` (`src/ui/overlayAtoms.ts`) — a focus-independent
second check, because the `[data-scope]` walk starts at `event.target` and only
reaches the attribute if the overlay actually took focus.

### 5.4 Internationalisation, or the lack of it

Exactly **four** strings in the TopBar go through `t()`:
`search.placeholder`, `mapLayers.label`, `localities.topbar.myLocalities`,
`localities.topbar.newLocality`. Everything else — "Standard", "LiDAR",
"Hybrid", "Kulturminner", "Flyfoto ↗", "Nasjonal mosaikk", "Tøm søk", "Filter" —
is hardcoded Norwegian bokmål.

`SearchComponent` uses `t()` **zero** times. By contrast `LocalityWorkspace`
uses it ~97 times and `TerrainPanel` ~17, so the newer code is consistently
translated and the older/faster-moving code is not. The three locale files are
~17.8 KB each and largely still describe upstream Norgeskart features.

A rewrite has to decide this deliberately: either commit to three locales and
finish the job, or drop to Norwegian-only and delete i18next. The current state
— a full i18n stack that the most-used surface bypasses — is the worst of both.

---

## 6. Map panels and controls

### 6.1 The card slot

`src/map/overlay/MapToolCards.tsx` renders **one** card at a time from
`mapToolAtom`: `'layers'` → `MapThemes`, `'localities'` → `LocalitiesPanel`,
`'measure'` → nothing (measure lives in a TopBar popover; the enum member is
vestigial and the switch falls through to `undefined`).

`MapToolCard` is the shared shell: white card, `maxWidth` 345px on desktop /
full width on mobile, `maxHeight` `80dvh` mobile / `calc(100vh - 65px)` desktop,
16px radius squared off at the bottom on mobile, `pointerEvents="auto"`, a
close IconButton. `MapToolCardProps.hideHeader` is declared and handled but
**never passed** — dead prop.

The layers card has a bespoke header (`MapLayersCardHeader`) showing the active
theme-layer count in a hardcoded-amber pill with a "clear all" button.

### 6.2 The theme picker

`src/settings/map/themes/MapThemes.tsx` + `SubTheme.tsx`. Generic upstream
machinery for browsing categories of theme layers with expandable subthemes —
and this fork has **one category with five layers** (Kulturminner). The
multi-subtheme, multi-category, search-within-themes capability is entirely
unexercised. A replacement can almost certainly collapse this to a flat list
without losing anything a user sees today, but check `themeLayerConfigApi.ts`
first in case new categories are planned.

Selecting a theme layer promotes it to `setZIndex(10)`, above everything else.

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
filter control to narrow the source. Results render as a list under the search
field in the left column. Selecting a result drops a marker, opens the InfoBox
with the result's details, and flies the map there.

Three things to fix rather than port:

- **Every selection lands at a hardcoded zoom 15** (`src/search/atoms.ts:162`),
  regardless of whether the result is a farm building or a municipality.
- **There is no keyboard support at all.** No arrow-key navigation of the result
  list, no Enter to select, no Escape to dismiss, no focus management, no
  `role="listbox"`/`role="option"`. Mouse only.
- **Zero `t()` calls** — the entire surface is hardcoded Norwegian.

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
- `src/map/featureInfo/KulturminnerPopup.tsx` (557 lines) — a separate popup
  specifically for Riksantikvaren features, rendered as a sibling of the whole
  layout.

`featureInfoService.ts` (595 lines) does the actual GetFeatureInfo dispatch and
parsing, including the `msGMLOutput` XML path that the Kulturminner layers need
(they are configured with `infoFormat: 'application/vnd.ogc.gml'`; left unset
the WMS returns HTML and the parser can only wrap it as an unhelpful
"HTML-respons mottatt" placeholder). Unifying the two presentation surfaces is
obvious rewrite work; the service underneath them should be left alone.

---

## 8. The lokalitet workspace

`src/localities/LocalityWorkspace.tsx`, 1256 lines — the largest file in the
codebase and where most of the actual product lives.

A **lokalitet** is an authored rectangle: an area to explore, not a claim that
something is there. It holds **funn** (individually named drawn features) and
**bilder** (kept LiDAR extracts, terrain renders, map screenshots, flyfoto,
uploads). The bbox is authored, never derived from its content — if a drawn funn
escapes the rectangle, the workspace offers to grow it rather than silently
resizing.

The workspace is the *only* route to drawing, LiDAR extract and terrain
analysis. There are no standalone `draw` / `lidarExtract` / `newFind` map tools.
Measure is the exception and stays global, because it is ephemeral and leaves
nothing behind.

### 8.1 Anatomy

Root is a `Stack maxHeight="calc(100vh - 80px)" pointerEvents="auto"
borderRadius="16px" overflowY="auto" gap={0}`, in four regions:

1. **Header** — name (inline-editable), visibility selector, delete.
2. **Sticky action bar** (`position="sticky" top={0} zIndex={1}`, around `:848`)
   — the verbs: Nytt funn, Juster området, LiDAR-uttrekk, Terreng, Flyfoto,
   Skjermbilde, Last opp. Sticky because the body scrolls and the actions must
   stay reachable; that is the whole reason for the local stacking context.
3. **Body** — a four-way switch on a `mode` computed around `:688`:
   `draftActive ? 'draft' : lidarOpen ? 'lidar' : terrainOpen ? 'terrain' :
   'browse'`. In `browse` the body is the section stack (§8.2); the other three
   replace it with a full-panel tool.
4. **Dialogs** — grow-to-fit confirmation (around `:1034`), flyfoto licensing
   notice, flyfoto project picker.

The `mode` switch is the workspace's core UI idea and worth keeping: the panel
is a single surface that becomes the tool you asked for, rather than stacking
tool panels on top of each other. It is also why `useWorkspaceKeys` takes a
`navigable` flag — arrow keys walk the funn list in `browse` but mean nothing in
`lidar`.

### 8.2 Sections

`LocalityDetails` (description, metadata), `FunnList` (the funn, with per-row
status, rename, zoom-to, delete), `BilderSection` (attachment gallery with
lightbox), `KulturminnerSection` (the "kjente kulturminner her" readout from
GeoNorge's WFS redistribution of the Riksantikvaren register — `kart.ra.no` has
WFS disabled, hence the detour).

`src/localities/ui.tsx` (230 lines) is the workspace's private component
vocabulary, written because kvib does not supply equivalents at the density this
panel needs: `WorkspaceSection` (collapsible titled section with a count),
`NoteInput` (auto-growing textarea that commits on blur), `Segmented` (compact
segmented control), `ConfirmPopover` (inline destructive-action confirmation —
it exists specifically to replace `window.confirm`, which cannot be styled and
blocks the event loop while the map keeps rendering behind it), and the
`BadgePalette` / `ButtonPalette` colour maps that keep funn status colours
consistent between the list and the map.

### 8.3 Keyboard

`src/localities/useWorkspaceKeys.ts`, capture phase, one `document` listener,
bails on repeats, modifier keys, and anything typed into an input, textarea,
select, `contenteditable`, or inside an open popover/dialog/select (matched via
`[data-scope="popover"]` etc. — kvib's Ark-derived components tag themselves
that way, which is a dependency on kvib internals a rewrite will need to
re-establish some other way).

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

`src/draw/` plus `src/settings/draw/` — 31 files, ~4400 lines, the largest
subsystem in the app. Inherited largely intact from upstream and the
least-touched part of the fork.

Tools: point, line, polygon, rectangle, circle, text, freehand. Editing:
select, translate, modify, delete, plus a vertical-move hook. Styling: colour,
line width, line style, point style, text style. Plus import/export dialogs
(GeoJSON/GPX-ish), undo/redo, and measurement readouts.

Two surfaces render the same tools: `DrawToolSelector` (desktop, inside the
workspace) and `BottomDrawToolSelector` (mobile, `zIndex 1000`, mounted at the
Layout root and only while a funn draft is active).

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

Both are full-panel workspace modes, both write to the attachment pipeline.

**LiDAR extract** — `src/lidarExtract/LidarExtractPanel.tsx` (320 lines) drives
source and resolution selection and shows progress; `LidarExtractViewer.tsx`
(606 lines) is a separate `position="fixed" inset={0} zIndex={1000}` fullscreen
result viewer, mounted way up at `App.tsx`. The viewer **moves the source canvas
DOM node** into itself with `replaceChildren` rather than re-rendering it —
that is a deliberate trap for anyone who assumes React owns that subtree, and it
is why the viewer cannot be casually re-parented. Its keys are capture-phase for
the reason in §1. The extract is DTM-only on purpose: an extract is meant to be
read as terrain.

**Terrain** — `src/terrain/TerrainPanel.tsx` (375 lines): DTM/DOM toggle, five
visualizations (hillshade, multidirectional hillshade, slope, local relief
model, sky-view factor), and live azimuth / altitude / exaggeration sliders. The
sliders are **raw `<input type="range">`** (`SliderRow`, near the bottom of the
file) rather than kvib's slider: sweeping the light smoothly needs a continuous
input stream during the drag, and the numeric value is rendered next to the
label anyway, so the extra chrome buys nothing.

The two `useMemo`s in that file are split on purpose and must stay split: sky-view
factor takes ~800 ms on a 600² grid and must never be keyed on azimuth, or
dragging the azimuth slider queues a multi-second recompute per frame. The
algorithmic side of all this is `docs/terrain-analysis.md`; the panel is only
the control surface.

---

## 11. Icons, and the build gotcha

`icon="…"` props are typed against `MaterialSymbol` from `material-symbols`,
which kvib pins. A plausible-looking name that is not in that union **fails the
docker build**, and plenty are missing: `terrain`, `filter_hdr` and `topography`
do not exist; `elevation`, `landscape` and `altitude` do.

There are no local `node_modules` to check against, so validate a new name by
pulling the tarball:

```
curl -sL https://registry.npmjs.org/material-symbols/-/material-symbols-0.40.2.tgz \
  | tar xz -O package/index.d.ts | grep '"terrain"'
```

---

## 12. Where kvib is fought rather than used

A catalogue for the redesign, because it is the evidence for "replace" over
"restyle".

- **Custom disclosures instead of menus** — the LiDAR dataset and style
  pulldowns (§5.1) need two-line rows, badges, hover previews and tiering.
- **Raw range inputs** instead of the kvib slider, for drag performance (§10).
- **Hand-rolled `ConfirmPopover`, `Segmented`, `NoteInput`,
  `WorkspaceSection`** in `src/localities/ui.tsx` (§8.2).
- **`zIndex: 9999`** on the language switcher's `SelectContent`, because kvib's
  default portal layering loses to the TopBar.
- **Literal hex colours** scattered through JSX where a token should be.
- **`[data-scope="…"]` selectors** in `useWorkspaceKeys`, reaching into kvib's
  internal DOM contract to detect "a popover owns the keyboard right now".
- **`style-src 'unsafe-inline'`** has to stay in the Caddyfile CSP while the UI
  is on kvib/Chakra, because emotion injects styles at runtime. **A rewrite off
  emotion is the one change that would let that CSP directive be tightened** —
  worth weighing when choosing the replacement stack.

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
switch Standard / LiDAR / Hybrid; pick the national mosaic or any per-project
LiDAR dataset; see datasets ranked by relevance to the current viewport and
expand to the less relevant ones; preview a project's footprint on hover; pick a
render style and expand to the full style list; switch DTM / DOM; cycle styles
with A/D, datasets with W/S, model with E, without opening any pulldown or
occluding the map.

**Overlay the heritage record**
toggle the five Kulturminner layers as a group; open the Kartlag card and toggle
layers individually; see the active-layer count; clear all theme layers; click a
heritage feature for its attributes; deep-link the active layers via
`?themeLayers`.

**Measure**
distance and area, with live on-map tooltips; clear the measurement.

**Own an area**
sign in (OAuth or password); create a lokalitet by dragging a box; rename it;
describe it; set visibility (private / limited / public); adjust the rectangle
afterwards (translate + modify); delete it; browse "Mine lokaliteter"; click a
rectangle on the map to open it; see which known kulturminner already fall
inside it.

**Record what you find**
create a funn; draw it as point, line, polygon, rectangle, circle, text or
freehand; style it (colour, width, line style, point style, text style); select,
move, reshape, vertex-edit and delete geometry; undo/redo; import and export
drawings; name a funn; note it; set its status (mulig / sannsynlig / avkreftet /
rapportert); zoom to it; walk the funn list with ↑/↓/Enter; grow the lokalitet
when a funn escapes it.

**Analyse it**
run a LiDAR extract over the rectangle at a chosen source and resolution, view
it fullscreen, keep it as a Bilde; run terrain analysis (DTM or DOM) with five
visualizations and live azimuth / altitude / exaggeration, save the render;
fetch flyfoto — the seamless mosaic or any historical acquisition covering the
area, individually or as a batch; take a map screenshot; upload an image.

**Keep it**
browse the Bilder gallery; open the lightbox; caption an attachment; delete one;
see flyfoto captioned with its acquisition year.

**Housekeeping**
switch language (nb / nn / en); open the help page at `/hjelp`; sign out.

---

## 14. Rough edges inherited, not designed

Fix-list for the rewrite; none of these are load-bearing.

- `new QueryClient()` is constructed **inside JSX** at `src/mainApp.tsx:17`, so
  any re-render of the root discards the react-query cache. It should be a
  module-level constant.
- `src/index.css` and `material-symbols/rounded.css` are each imported twice
  (`mainApp.tsx` and `AtomWrapper.tsx`).
- `MapToolCardProps.hideHeader` — declared, handled, never passed.
- `mapToolAtom`'s `'measure'` member renders nothing.
- `NKUrlParameter` carries `rotation`, `drawing`, `printTool` with no writers;
  `projection` is read but never written.
- `trackPositionAtom` and its effect have no UI entry point (§6.3).
- The theme-picker's category/subtheme machinery is unexercised (§6.2).
- Search has no keyboard support and no i18n (§7).
- The layer z-index ladder contains a `4.5`.
- Fourteen TopBar controls "fit" on mobile only via horizontal scroll (§5).
