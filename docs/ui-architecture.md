# UI architecture

## 1. What the UI is

A floating shell over a full-bleed map: the OpenLayers canvas fills the window,
and every control floats over it as chrome that yields its edges back.

- Rendering is the in-repo kit in `src/ui`: plain CSS Modules over
  `src/ui/tokens.css`. There is no component library.
- No new UI dependency. The workstation cannot regenerate
  `package-lock.json`, so anything needing one is out of reach.
  `@excalidraw/excalidraw` is the single exception ever made.
- Norwegian domain terms are the app's vocabulary: lokalitet, funn, bilde,
  kulturminne, and the four layer groups Visning · Bilde · Skisse · Funn.

## 2. Invariants

One line each, with the symptom of breaking it.

| Rule | Symptom |
| --- | --- |
| One slot, one occupant, where the slot is really one. `ribbonToolAtom` holds `'lidar' \| 'terrain'`; drawing is not in it (`funnDraftActiveAtom` derives from `funnSessionAtom`), and `workspaceModeAtom` derives `'draft' \| 'lidar' \| 'terrain' \| 'browse'` from both. | Two controls own one surface and disagree about who is on. |
| OL interactions are owned, not scanned for. `src/map/interactions.ts` — `InteractionOwner` is `draw`/`measure`/`localityAdjust`/`lidarExtract`, and `getOwnedInteractions` returns a fresh array. | A teardown removes somebody else's interaction, or mutates the array it is iterating. |
| Keyboard is layered by capture phase. The map is built with `keyboardEventTarget: document`, so an app binding must use capture plus `preventDefault` + `stopPropagation` + `stopImmediatePropagation`. | OpenLayers' `KeyboardPan` also acts on the key; it ignores `defaultPrevented`. |
| Every keyboard layer guards on inputs, `contentEditable`, `[data-scope="popover\|dialog\|select"]`, and `anyOverlayOpenAtom`. | Typing in a field swaps the ground behind it. |
| `src/ui`'s `Popover` and `Dialog` must keep setting `data-scope`. | The guard above goes silently blind. |
| Producers declare, the layer row orders. A producer calls `setGroundOverlay(key, member)`; the group calls `setGroundOverlayStack(group, keys, held)`. | A key nobody ordered paints above everything that was ordered. |
| Held is not withdrawn. A group label taking its layers off the map never reaches for the producer that declared them. | Switching the group back on returns something other than what was there. |
| Opacity is a raster idea. Vector members get a switch and nothing else, and so does `[Visning ▾]`'s ground preset. | A fade that is three fades. |
| Nothing in the layer row writes. No group has a stance gate. Curation verbs with a geometry in them (`Plasser i ruta`, `Hører til`) live on the bilde card and are buffered. | A read surface starts issuing PATCHes. |
| `.map` stays a sibling of `.overlay` in `AppShell`, never its child. | F11 calls `requestFullscreen()` on the map target (`src/map/mapHooks.ts`) and the chrome disappears with it. |
| `pointer-events: none` all the way down the overlay tree, `auto` only on leaves. | The chrome eats map drags in its empty space. |

## 3. Stack and boot

Versions: React 19 (StrictMode) · Vite 8 · TypeScript ~7.0.2 · jotai ^2.20.3 +
jotai-effect · OpenLayers ^10.10.0 with proj4 (EPSG:25833) · PocketBase JS SDK
^0.28 · @tanstack/react-query ^5 (one consumer: the elevation lookup) ·
i18next ^26 / react-i18next ^17 · react-router-dom ^7 · material-symbols
^0.40.2 · @fontsource/mulish · @excalidraw/excalidraw ^0.18.1 · uuid.

```
main.tsx → mainApp.tsx   StrictMode → BrowserRouter → AtomWrapper →
                         QueryClientProvider → App + Toaster
App.tsx                  pbAuthSyncEffect above the router
  /                      AppShell        /hjelp   HelpPage
AppShell
  .map                   MapComponent    (unconditional, unkeyed, never moved)
  .overlay               CompareCurtain
    .ribbon              Ribbon
    .row                 .left  SearchComponent, MapToolCards
                         .right InfoBox
                         FunnSurface     (paints over both slots)
    .bottom              portal target (bottomSlotAtom)
  siblings               KulturminnerPopup, AuthDialog
Ribbon
  RibbonGlobalRow        always; renders RibbonSettingsRow under itself
  RibbonPlaceLocalityRow while a rectangle is being placed
  LocalityRibbon         keyed on locality.id → RibbonLocalityRow,
                         RibbonFunnDraftRow, the bottom-slot occupant,
                         FunnCallout, LocalityDialogs
```

`projInit()` runs at module scope; `AtomWrapper` hydrates only
`activeThemeLayersAtom`, from `?themeLayers`. Error boundaries wrap each ribbon
row and each bottom-slot occupant.

Surfaces carry `data-chrome="top|right|bottom|left"`. `src/shell/chromeInsets.ts`
measures the deepest surface per edge on demand (never observed) and
`fitPadding(map, margin)` feeds every `view.fit`; opposing paddings are clamped
to 70% of the viewport.

Map side-effects mount in exactly two places: `src/map/MapComponent.tsx` (the
three atom effects) and `src/shell/useMapSideEffects.ts`, called once by
`AppShell` (feature-info and search clicks, the locality/funn/footprint layers,
`useBackgroundCyclingKeys`). `useLidarFootprintsLayer` is the only writer of
`lidarViewportAtom` and must mount exactly once.

`mapAtom` (`src/map/atoms.ts`) lazily constructs the `ol/Map`:
`defaultControls({ zoom: false, rotate: false })`, one `ScaleLine({ minWidth: 100 })`,
`defaultInteractions({ altShiftDragRotate: false, pinchRotate: false })`,
`keyboardEventTarget: document`, `maxTilesLoading: 48`; view `minZoom: 3`,
`maxZoom: 20`, `constrainResolution: true`, EPSG:25833, default centre
`[396722, 7197860]`.

CSS stacking, `src/ui/tokens.css`: `--z-map` 0, `--z-map-controls` 1,
`--z-overlay` 2, `--z-ribbon` 20, `--z-popover` 1200, `--z-tooltip` 1300,
`--z-toast` 1400. There is no `--z-dialog` — dialogs are native `<dialog>` +
`showModal()`, in the top layer — and the Toaster uses `popover="manual"`,
reaching `--z-toast` only where the popover API is missing. `--z-fixed` was
deleted with its one consumer; nothing should float free of this ladder again.

OpenLayers layer `zIndex`:

| z | Layer |
| --- | --- |
| 0 | background stack (sets none) |
| 1 | ground overlay (`src/map/groundOverlay.ts`) |
| 1.5 | compare curtain's B half (`COMPARE_Z`) |
| 2 | sketch overlays (`src/map/sketchOverlay.ts`) |
| 3 | measure, theme layers, lidar footprints |
| 4 | localities |
| 4.5 | funn highlight |
| 5 | funn, property geometry |
| 6 | search marker |
| 8 | locality adjust handles |
| 10 | the active theme layer, promoted (`src/map/layers/atoms.ts`) |

## 4. State

jotai on the default store — there is no `Provider`, so module-level code
(`getDefaultStore()`) and React read the same atoms.

### Atom inventory

| Atom | Holds | Lives in |
| --- | --- | --- |
| `mapAtom` | the `ol/Map` | `src/map/atoms.ts` |
| `trackPositionAtom` | geolocation follow; no UI entry point | `src/map/geolocation/atoms.ts` |
| `backgroundLayerAtom`, `standardVariantAtom`, `hybridOverlayAtom`, `hybridContoursAtom`, `activeLidarModelAtom`, `activeLidarStyleAtom`, `activeLidarProjectAtom`, `lidarPickerOpenAtom`, `lidarCyclingAtom`, `lidarAutoDatasetAtom`, `activeFlyfotoProjectAtom` | the ground and its modifiers; eight are `halved()` facades over an A/B pair | `src/map/layers/config/backgroundLayers/` |
| `compareOnAtom`, `compareFocusAtom`, `focusedHalfAtom` | the curtain and which half the ribbon aims at | `src/map/compare/halves.ts` |
| `compareSplitAtom` | seam position | `src/map/compare/atoms.ts` |
| `funnHiddenAtom`, `funnSwitchedOffAtom` | the funn group switch, and per-funn switches | `src/localities/atoms.ts` |
| `visningShownAtom`, `visningOpacityAtom`, `visningGroupShownAtom`, `provisionalViewAtom`, `bildeShownAtom`, `bildeOpacityAtom`, `bildeGroupShownAtom` | the two ground-overlay groups' control state | `src/map/groundOverlay.ts` |
| `sketchShownAtom`, `sketchOpacityAtom`, `sketchGroupShownAtom` | `[Skisse ▾]` | `src/map/sketchOverlay.ts` |
| `activeThemeLayersAtom`, `shownThemeLayersAtom` | the Kulturminner selection | `src/map/layers/atoms.ts` |
| `heritageHiddenAtom`, `heritageDetailsAtom`, `heritageRenderAtom`, `heritageOpacityAtom` | the eye; kulturminner2's registers, render axis, fade | `src/map/layers/heritage.ts` |
| `mapToolAtom` | `'measure' \| 'localities' \| null` | `src/map/overlay/atoms.ts` |
| `overlayOpenCountAtom`, `anyOverlayOpenAtom` | is any popover/dialog up | `src/ui/overlayAtoms.ts` |
| `ribbonToolAtom`, `workspaceModeAtom`, `localityDetailsOpenAtom`, `bilderStripOpenAtom`, `funnOutsideAtom` | ribbon/workspace mode | `src/localities/toolAtoms.ts` |
| `bottomSlotAtom` | the bottom-edge portal node | `src/shell/bottomSlot.ts` |
| `groundHandleAtom` | `mode`, `half`, `previous()`, `select()` across the sibling gap | `src/shell/groundHandle.ts` |
| `infoToolAtom`, `heritageClickArmedAtom`, `infoClickArmedAtom` | Stedsinfo arming | `src/map/featureInfo/infoTool.ts` |
| `drawRequestedAtom`, `funnSessionAtom`, `funnSceneAtom` | the drawing session and its live scene | `src/funn/session.ts` |
| `activeLocalityAtom`, `editingLocalityIdAtom`, `adjustingLocalityAtom`, `selectedFunnIdAtom`, `hoveredFunnIdAtom`, `funnDraftActiveAtom`, `pendingStarterLocalityIdAtom`, `coverTerrainSpecAtom` | the open lokalitet and its stance | `src/localities/atoms.ts` |
| `localityPlacementAtom` | the rectangle being placed | `src/localities/placement.ts` |
| `recreateViewAtom` | "put the map back the way this View was taken" | `src/shell/useRecreateView.ts` |
| `visningRingAtom`, `selectVisningAtom`, `cycleVisningAtom` | `[Visning ▾]` as a ring | `src/shell/visningRing.ts` |
| `bilderRingAtom`, `cycleBilderAtom` | the bilder rail as a ring | `src/localities/bilderRing.ts` |
| `currentUserAtom`, `roleAtom`, `isAdminAtom` | auth | `src/auth/atoms.ts` |

### URL persistence

Hand-rolled in `src/shared/utils/urlUtils.ts`; the `NKUrlParameter` union is
the whole vocabulary and writes go through `history.replaceState` only.

- Round-trip: `lat`, `lon`, `zoom`, `backgroundLayer`, `hybrid`, `contours`,
  `lidarModel`, `themeLayers`, `heritageDetails`, `heritageRender`,
  `heritageOpacity`, `sok`, `markerLat`, `markerLon`, `showSelection`, `lok`.
- In the union with no writers: `rotation`, `drawing`, `printTool`.
  `projection` is read and never written.
- Not persisted: the active LiDAR style and project, and the active flyfoto
  acquisition.

`lok` is the only parameter naming a record rather than a view setting, so it
is the only one that can fail to resolve; `src/localities/shareLink.ts` owns
both directions.

## 5. The ribbon

`src/shell/Ribbon.tsx`, `data-chrome="top"`. Four thin rows at most, each
capped at one line.

| Row | Component | When |
| --- | --- | --- |
| 1 | `RibbonGlobalRow` | always; inert while a funn is being drawn |
| 2 | `RibbonSettingsRow` | rendered by row 1, carrying the active ground's modifiers |
| 3 | `RibbonLocalityRow` | a lokalitet is open (or `RibbonPlaceLocalityRow` while one is being placed — the two are mutually exclusive) |
| 4 | `RibbonFunnDraftRow` | a funn draft is live |

Row 1: `RibbonSearch`, Kart (1), LiDAR (2), Hybrid (3), Flyfoto (4),
Kulturminner + its eye, Stedsinfo (I), Mål, Mine lokaliteter, Ny lokalitet,
`RibbonAccount`. Terreng (5) and Sammenlign are on the lokalitet row, because
both read a rectangle. `LocalityRibbon` is the one mount point for
`useLocalityWorkspace`; `useGroundMode` and `useTerrainAnalysis` are each
mounted once, in row 1.

A mode is one of the five grounds and is exclusive; a modifier describes the
mode you are in and lives on the settings strip. `GROUND_MODES` / `GROUND_KEYS`
/ `groundModifiers()` in `src/shell/useGroundMode.ts` keep the digits and the
buttons positional.

### The settings strip, per ground

| Ground | Strip |
| --- | --- |
| Kart (Standard) | none; the Karttype pulldown hangs off the button. `STANDARD_VARIANTS` = Topografisk, Gråtone, Rasterkart, Sjøkart, Amtskart |
| LiDAR | dataset pulldown (Automatisk / national mosaic / per project) · style pulldown · DTM/DOM |
| Hybrid | the same, plus Høydekurver |
| Flyfoto | acquisition pulldown · period chips (Alle / 2010– / 1990–2009 / 1960–1989 / –1959) |
| Terreng | Visualisering pulldown (eight) · DTM/DOM · 2–4 sliders · resolution readout |

While the compare curtain is up, an A|B switch sits on the strip; the strip
itself stays under Kart.

Ground-specific facts worth keeping:

- Automatisk (`src/map/layers/config/backgroundLayers/lidarAuto.ts`,
  `chooseAutoDataset`): engages a per-project dataset at ≤1 m/px
  (`AUTO_ENGAGE_M_PER_PX`), releases above 2 m/px; engages at >50% on-screen
  coverage, releases below 35%. The candidate is `viewport.primary[0]`;
  `moveend` is debounced 250 ms.
- Sammenlign: `halved(initial)` returns `{a, b, focused}`, and only four things
  know about halves — `backgroundLayerAtomEffect` (pinned `.a`),
  `compareLayerAtomEffect` (pinned `.b`), the screenshot caption, the A|B
  switch. Stacks come from `resolveStack` / `buildStack` in
  `backgroundLayers/stack.ts` under the `bg.` and `cmp.` namespaces; the clip is
  `prerender`/`postrender` + `getRenderPixel` in
  `src/map/compare/curtainLayers.ts`. Terreng is not offered as a B half, and
  closing a lokalitet tears the curtain down.
- Kulturminner (`src/shell/heritage/HeritageControl.tsx` + `EyeSplit`): the eye
  sets `heritageHiddenAtom`, which calls `setVisible(false)` and never removes a
  layer. The panel carries the five Riksantikvaren services, kulturminner2's
  three registers, the render axis (one value per LAYERS entry) and a Transparens
  slider topping out at 80% (`MIN_HERITAGE_OPACITY = 0.2`).
- Ny lokalitet: `src/localities/bboxLimits.ts` — `MIN_SIDE_M = 50`,
  `MAX_SIDE_M = 1500`, measured in EPSG:25833. The ceiling ratchets down for
  records already larger and never snaps; everything clamps except
  `growToFitDrawing`, which refuses, and `copyLocality`, which is exempt.
  Placement is `localityPlacementAtom` + `useStartLocalityPlacement`
  (`placement.ts`), `RibbonPlaceLocalityRow`, `useLocalityPlacement` and
  `useBboxHandles` (one `Pointer` interaction).

## 6. Keyboard map

Complete inventory. All layers are capture-phase on `document`, decline
`event.repeat` and any modifier, and are stood down by an input, a
`contentEditable`, `[data-scope="popover|dialog|select"]` or
`anyOverlayOpenAtom`. A live `funnSessionAtom` stands row 1's whole layer down,
because Excalidraw's own shortcuts are the digits.

| Key | Does | Declines when |
| --- | --- | --- |
| 1–5 | select ground: Standard, LiDAR, Hybrid, Flyfoto, Terreng | — |
| X (hold) | peek the previous ground, snap back on release; also on window blur | — |
| A / D | walk the LiDAR style ring (top tier, wrapping) | no-op in DOM |
| A / D, inside a lokalitet | walk the bilder rail (`src/localities/bilderRing.ts`) | three cases: nothing to walk, a live picker run, and the compare curtain's B half — `railWalkable = stripNavigable && picker.run == null`, crossed with `focusedHalfAtom === 'a'` |
| W / S | walk the active ground's dataset ring | — |
| W / S, inside a lokalitet | walk `[Visning ▾]` (`src/shell/visningRing.ts`), over `ring.length + 1` stops with "no View" first, entering the View it lands on | two cases: an empty ring, and the curtain's B half |
| E | DTM / DOM | — |
| H | hide / show the funn group | — |
| I | arm / disarm Stedsinfo | — |
| C | flip which compare half the ribbon aims at | the curtain is down; it is not a way to raise it |
| ↑ / ↓ | move the funn selection; in `show` this is a zoom tour | a funn draft is live |
| ← / → | walk the bilder rail | `stripNavigable` is false — OpenLayers' `KeyboardPan` keeps the keys |
| Enter | zoom to the selected funn | no selection |
| N | arm / disarm the pen | not `canAdd` |
| U | LiDAR-uttrekk dialog | not `canAdd` |
| B | take a screenshot | not `canAdd` |
| Escape | back out one depth | during a funn draft |

Both rings are reassignments, not fallbacks, and the routing is
`useGroundMode.cycle` — a dispatch with no `default` arm, never a chain through
registration order, because both listeners are capture-phase on `document`. A
pulldown heading that advertises a ring composes its ` · W/S` / ` · A/D`
suffix (`useGroundRingHint`, `useVisningRingHint`, `useLidarStyleRingHint`)
rather than translating it, so the hint moves with the keys.

`PEEK_KEY` is `x`, not the backtick: on the Norwegian layout the backtick is a
dead key and arrives as `key: "Dead"`. `CYCLING_IDLE_MS = 90_000`.

A live picker run swallows the whole workspace layer: ← / → step,
Enter or K keep, Delete or X discard, Escape ends the run.

Escape order, outermost last: picker run → LiDAR extract dialog → Juster
området (undo) → clear the funn selection → leave edit (only when the buffer is
clean) → close the lokalitet.

## 7. Search and feature info

`src/search/` — `SearchComponent.tsx`, `atoms.ts`, `hooks.ts`, `searchApi.ts`,
`infobox/`, `results/`, `searchmarkers/`. The query field (`RibbonSearch`) is in
row 1, the result list in the shell's left slot, the readout in the right slot.
Queryable: place names, addresses, cadastral properties. Selecting a result
drops a marker, flies to it (zoom hardcoded 15, `src/search/atoms.ts`) and opens
the InfoBox. `searchApi.ts` carries the one direct-to-origin call, the ArcGIS
identify against hoydedata.no for elevation.

Stedsinfo is an arming toggle (`infoToolAtom`, key `I`) in
`src/map/featureInfo/infoTool.ts`, off on arrival: a map click asks the
registers nothing until it is armed, and the armed map carries a `crosshair`
cursor. `heritageClickArmedAtom` and `infoClickArmedAtom` are the two click
owners it has to see. The Kulturminner popup is outside the tool — with the
overlay on, a click on a feature opens it.
`src/map/featureInfo/featureInfoService.ts` parses `msGMLOutput`; the
Kulturminner layers are configured `infoFormat: 'application/vnd.ogc.gml'`.

`src/map/featureInfo/heritageVocabulary.ts` holds the two closed vocabularies,
keyed on the labels kart.ra.no puts on the wire (which are not Geonorge's SOSI
spellings; the register spellings are kept as aliases). Measured over ~1300
features in 14 dense areas: 3 distinct `lokaliteteskategori`, 9 distinct
`enkeltminnekategori`, 13 distinct `vernetype`; the register caps those at 12
and 20, so the tables are complete by construction. `vernetype` maps to five
vern buckets plus `ukjent`. `fylke` is absent from kulturminner2 — not once in
1300 features — but the brukerminner WMS does serve it.

Field names per register, read through `NAME_FIELDS` / `DESCRIPTION_FIELDS` /
`ART_FIELDS` / `DATERING_FIELDS` / `ID_FIELDS` in `KulturminnerPopup.tsx`:

| Register | name | description | art | datering | id |
| --- | --- | --- | --- | --- | --- |
| kulturminner2, freda_bygninger | `navn` | `informasjon` | `lokalitetsart` / `enkeltminneart` | `datering` | `lokalid` |
| kulturmiljoer | `navn` | `informasjon` | `kulturmiljokategori` | — | `lokalid` |
| sefrak | `objektnavn` | — | `bygningstypetekst` | `tidsangivelsetekst` | `askeladdenid` |
| brukerminner | `tittel` | `beskrivelse` | — | — | none |

The Kulturminnesøk link on a feature is probed through `/kms/*`
(`useKulturminnesokStatus`, `src/map/featureInfo/kulturminnesok.ts`), starting
`unknown`; misses are real — 3 of 7 at Gimsø in Skien, 4 of 18 around Borre.

## 8. The lokalitet workspace

`src/localities/useLocalityWorkspace.ts` is the controller, mounted once by
`LocalityRibbon`.

### Access and stance

`access` is a fact about the record (`owner` | `admin` | `reader`); stance is a
choice made inside it (`show` | `edit`, per session, never stored, held in
`editingLocalityIdAtom` keyed on the record id).

- `mayEdit` — update/delete: owner and admin.
- `mayAdd` — create: owner only, because the create rules also demand the parent
  lokalitet's owner.
- `canEdit = mayEdit && stance === 'edit'`, `canAdd = mayAdd && stance === 'edit'`.

Every lokalitet opens in `show` and nothing in show writes — the write verbs are
absent there, not disabled. The one exception is a lokalitet just created with
`Opprett`, which opens in `edit`.

### The row

Five zones in three grid cells (`1fr auto 1fr`): identity (`Lokalitet:`, name,
short-code chip, visibility badge, banner slot) · contents (`Skisse ▾` ·
`Funn ▾` · `Bilder ▾`, plus `Visning ▾` / `Bilde ▾`) · the work, edit only
(Nytt funn · Behold · `Hent ▾` · Skjermbilde) · the ground tools, centre, both
stances (Terreng · Sammenlign) · the exits, right, deepest first.

| Depth | State | Exits |
| --- | --- | --- |
| 2 | funn draft | `[Ferdig med funn] [Forkast funn]` |
| 2 | Juster området | `[Bruk] [Angre]` |
| 1 | edit | `[Lagre] [Avbryt]* [Avslutt] [⋮]` |
| 0 | show, `mayEdit` | `[Rediger] [Lukk] [⋮]` |
| 0 | show, otherwise | `[Lag min kopi] [Lukk] [⋮]` |

`Avbryt` appears only when there is something to discard. `Avslutt` over unsaved
work asks, with three answers: Bli værende / Forkast og avslutt / Lagre og
avslutt. `⋮` carries Zoom til lokaliteten, Detaljer, Del and Rapportpakke in
both stances; Juster området and Slett are gated on `canEdit`. The banner slot
ranks: recovered buffer, copy progress, Rapportpakke progress, *Delt av X*,
admin-in-edit, *Kopiert fra X*. Detaljer is a dialog: Sted / Kommune / Matrikkel
editable, Koordinater (`formatBboxCentre`) and Areal read-only, plus "Hent
stedsdata på nytt" under `canEdit`. The centre coordinate is derived per render,
never stored.

On the map: `localityLayer.ts` (the open lokalitet draws nothing, the others
faint; the fill is 1% white, for hit detection only), `funnLayer.ts` with
`styleFor(id)` resolving the hidden and switched-off sets,
`funnHighlightLayer.ts` gated on `isFunnOnMap(id)`, and `FunnCallout`, an
`ol/Overlay` with `stopEvent: true`. `useFunnVisibility` is the single reader of
both funn switches.

Funn autosave (`useFunnAutosave.ts`, `SETTLE_MS = 700`): an empty scene is never
a delete; one write at a time; the first scene after arming is a baseline; every
exit flushes; titles are never empty (`localities.funn.autoName` → `Funn n`).
`funnOutsideAtom` flags a funn that has escaped the rectangle; "Utvid området"
recomputes through `sceneExtentToBbox4326`.

### The attachment pipeline

`kind` decides everything, and there is no `spec` or `isView` field.
`extract | flyfoto | sketch | scene` are Views — a spec in `meta`, no bytes,
pinned to a figure later. `screenshot | upload` are Files — bytes, with nothing
behind them that could make the bytes again.

```
View   createAttachmentSpec() → pinQueue.ts → renderSpec() → renderFigureBlob() → pinAttachment()
File   renderFigureBlob()     → createAttachment()
Last opp                      → createAttachment()   (no figure)
```

Producers: `starterPack.ts`, `behold.ts`, the flyfoto grab, "Behold skissen",
`sceneSpec.ts` ("Oppsett"), `screenshot.ts`, the LiDAR extract's Behold, Last
opp.

`pinQueue.ts` is module-level and React-free: one job at a time, rendering the
spec's own rectangle rather than the lokalitet's current one, and only ever for
`canAdd`. End states are `empty`, `failed`, or success (entry deleted);
`pinNow` jumps the queue. The spec writes `sourceKey`, `sourceLabel`, `style`,
`model`, `bbox25833` and the terrain knobs; the pinner adds `metresPerPx`,
`imageRect`, `renderedAt`. Everything it waits on is on a clock —
`src/shared/utils/deadline.ts` bounds each request (`fetchWithin`, including the
body read) and each whole render or upload (`withDeadline`, 5 minutes each).

`getAttachmentUrl` is a synchronous string build since migration `1700000900`;
`useAttachmentUrl` counts thumbnail failures and falls back to the original. The
ground overlay decodes the original file, never a thumbnail, because
`meta.imageRect` is in original pixels (`groundView.ts`,
`src/shell/groundMembers.tsx`).

### The bilder rail

One rail in both stances, in the bottom slot: `BilderStrip.tsx` in show,
`BilderCarousel.tsx` in edit, `BilderPicker.tsx` borrowing the slot during a
picker run, over the shared card vocabulary in `bilderCommon.tsx`. Frames are
88×64; `bilderStripOpenAtom` is module-level and starts open;
`hasBilder = bilderCount > 0 || starterBusy || canAdd`.

Pressing a card is `selectBilde`, which routes by kind: a scene to
`restoreScene`; a View through `selectVisningAtom`, `[Visning ▾]`'s single
entrance, which brings back the ground the render was made on; a File to
`bildeShown`; a sketch to `sketchShown`. Two callers write `visningShownAtom`
directly because they must not move the ribbon: the arrival cover, and restoring
a scene's own ground.

Curation, edit only: `attachments.sort` is an opaque key (`Date.now()` at
create), the list query sorts `sort,created`, `reorderBilde` writes between
neighbours with `SORT_STEP = 1000` as the renumber fallback, and
`attachments.hidden` conceals without deleting. The cover is derived — first
non-hidden record in exhibit order — never a field; `coverTerrainSpec` is the
first non-hidden terrain View. Drag-to-reorder is `useRailReorder.ts`, Pointer
Events on capture with touch excluded.

Four routes an image takes in:

- Starter set (`starterPack.ts`), on `Opprett`: three readings of the best LiDAR
  dataset over the rectangle. `STARTER_STYLES` *is* `TIER_A_STYLES`
  (`skyggerelieff`, `multiskyggerelieff`, `helning_prosent`), filtered by what
  the source publishes; `bestLidarSource` picks the source, `planStarterPack` /
  `runStarterPack` run it, written through rather than buffered. The national
  mosaic publishes only `skyggerelieff` — asking for another returns HTTP 200
  with `image/png` and a ~100-byte JSON error body.
- Behold (`behold.ts`): keeps whatever ground is up, at the source's own
  resolution. LiDAR → dataset/style/model; Terreng → visualization + knobs;
  Flyfoto → the acquisition, behind the NiB licensing notice; Standard and
  Hybrid disabled. The offer crosses the sibling gap on `beholdOfferAtom`;
  `attachmentMatchesKey` guards duplicates (bbox to 1 m, floats to 1e-6, `kind`
  part of the key, hidden records counted).
- Picker carousels (`usePickerRun.ts`, `BilderPicker.tsx`) behind `Hent ▾`:
  enumerate everything, fetch one ahead, write only on the keep press, filter
  duplicates before the run, cancel on Esc through a generation counter.
  `FLYFOTO_BATCH_MAX = 8`, `NIB_MOSAIC_KEY = 'mosaic'`.
- Last opp: bytes, straight to `createAttachment`. An upload earns an extent
  from `Plasser i ruta` (`uploadPlacement.ts`), which writes `meta.bbox25833`
  fitted to the image's own aspect inside the rectangle and marked
  `bboxAssumed`. `Hører til` writes the `funn` relation and no geometry.

### The edit transaction

`draft.ts` + `useLocalityDraft.ts`: a buffered delta keyed by record id,
persisted to `localStorage` under `tufteseid.draft.<localityId>`.

| Handling | What |
| --- | --- |
| buffered | name, beskrivelse, sted, kommune, matrikkel, synlighet; funn title/note/status/geometry; curation sort/hidden; the rectangle, with its own nested Bruk/Angre; a View kept in edit, as a spec under a `draft:` id |
| written eagerly, deleted on Avbryt | Files, tracked in `eagerIds` |
| deferred tombstone | funn deletion |
| outside the transaction | the starter set; the lokalitet's own deletion; a bilde deletion, on confirm |

`commit()` order: locality → find deletes → find patches → new finds →
attachment deletes → attachment patches → new specs, with `remapSceneMeta`
rewriting draft ids as they become real. `changedElsewhere` is a read-time
comparison, not a subscription. `isDraftId` is tested in exactly three places:
the pin sweep, the pin face, `Åpne originalen`.

### The copy, the link, the bundle

`Lag min kopi` (`copyLocality.ts`) carries the bbox, name, description, place,
municipality, matrikkel, every funn, and every View's meta/caption/sort/hidden as
unpinned specs (`imageRect` and `renderedAt` stripped, `bbox25833` kept). Left
behind: the owner, the visibility (a copy starts `private`) and every File.
`derivedFrom` points back and does not cascade; `derivedFromLabel` names it;
relations are wired in a second pass. The Files that stayed behind appear at the
end of the copy's carousel through `useInheritedBilder`, each with one `Ta med`
(writing `meta.takenFrom`), owner-in-edit only.

`Del` (`shareLink.ts`) copies `/l/CODE`, and the open lokalitet rides in the URL
as `?lok=CODE`. The short URL is six lines of `Caddyfile` — a `redir` behind
`path_regexp ^/l/([0-9A-Za-z]+)$` — not a service and not an SPA fallback, so
`/hjelp` is still 404 on a cold load. The boot code is captured at module
import; `getLocalityByCode` uppercases. A link always lands in `show`, framed on
the rectangle (`zoomToLocality`); there is no viewport in it. Migration
`1700000900` opened public reads and unprotected `attachments.file`, so a guest
can follow one. A miss keeps the parameter and offers `Logg inn`, because the
visitor may be the signed-out owner of a private lokalitet.

`Rapportpakke` (`takeout.ts` over `src/shared/utils/zip.ts`) zips the lokalitet
into `<slug>-YYYY-MM-DD.zip`: `index.html` and `README.txt` from one `Page`
object, `bilder/NN-*` in curated order, `funn/funn.geojson` (flattened, fixed
Norwegian property names `funn`, `tittel`, `notat`, `status`) and `funn/funn.csv`
(RFC 4180, UTF-8 BOM, CRLF, so a double-click opens it in a spreadsheet). Stages
are `'pinning' | 'files' | 'writing'`; it forces a pin on every unpinned View
first, with `forcePin` null for a reader, and names the missing bilder on the
front page rather than refusing the bundle. `CREDIT_BY_KIND` is exhaustive over
`AttachmentKind`. `zipStore` is stored, not deflated, and not Zip64: it throws
above 4 GB or 65535 entries.

## 9. Drawing

`src/funn/` — `session.ts`, `frame.ts`, `geometry.ts`, `scene.ts`, `render.ts`,
`FunnCanvas.tsx`, `FunnSurface.tsx`, `excalidrawAssets.ts`
(`window.EXCALIDRAW_ASSET_PATH = '/'`).

The map is frozen, not photographed: the pen goes down over the live map with
interactions cleared, and `slaveMapToScene` lets the canvas be zoomed without
asking Kartverket for a tile. Row 1 is `inert` for the duration, because the
drawing is registered to the map as it stood at freeze.

Scene units are CSS pixels of the frozen viewport, origin top-left, y down; the
extent is stored in the view projection at freeze. Converting out: ellipses
become 64-gons, freedraw becomes a dense LineString, text does not convert, and
stroke styling does not survive. `funnSceneAtom` lags the canvas by 150 ms
(`SCENE_SETTLE_MS`), so the three keep-paths read `sceneNow` instead.

Two modes on one surface:

- funn — the first finished shape becomes a buffered funn, auto-named, and every
  change is written back on its own.
- tegning — the scene is kept as `kind: 'sketch'` with `meta = {frame, scene}`,
  rendered as a transparent figure and put back on the map by
  `src/map/sketchOverlay.ts` (zIndex 2, a generation counter guarding landing
  exports, the renderer dynamically imported). Relations: `over` (the bilder it
  is a layer on — seeded, not editable) and `funn` (editable). Entry is `Tegn`
  on the row, exits are `[Behold skissen] [Avbryt]`, and the card offers an eye
  in both stances plus `Rediger skissen` (`resumeSketch`) in edit.

`compositeMapCanvases` (`src/map/composite.ts`) flattens whatever is on screen
for the screenshot path.

## 10. The layer row

Four `[thing ▾]` groups — Visning · Bilde · Skisse · Funn — left to right in the
map's own z-order. Each is a label that holds the group off the map, a caret
that opens it, and a member list with a switch each. `src/shell/LayerGroup.tsx`
(with `LayerMembers` and its `select` flag) is the control and all four wear it;
`LayerMember` carries `opacity?`, `warning`, `note` and `section`.

| Group | Control | Semantics |
| --- | --- | --- |
| `[Visning ▾]` | `src/shell/VisningControl.tsx` | a selection, not checkboxes — one View over the ground at a time, with an accent bar on the chosen row; pressing a row enters that View |
| `[Bilde ▾]` | `src/shell/BildeControl.tsx` | checkboxes, several at once, each with its own fade; absent when there are no Files |
| `[Skisse ▾]` | `RibbonLocalityRow.tsx` | checkboxes over `src/map/sketchOverlay.ts` |
| `[Funn ▾]` | `RibbonLocalityRow.tsx` | vector members, switch only |

`src/map/groundOverlay.ts` is the map side, module-level and imperative:

- `setGroundOverlay(key, member | null)` — put up, move, invalidate or take
  down. Keys are `TERRAIN_KEY`, `view:<id>`, `bilde:<id>`.
- `setGroundOverlayStack(group, keys, held)` — one caller per group, declaring
  its whole list bottom-to-top and which members it is holding down.
- `setGroundOverlayOpacity(key, value)` — `opacityByKey` is never pruned,
  because a member's fade has to outlive its member.
- `GROUP_ORDER = ['visning', 'bilde']`, a module constant rather than a third
  caller above both controls.
- Everything paints bottom-to-top into one reused canvas (~30 MB), each member
  with its own `globalAlpha`, `imageSmoothingEnabled` off past native
  resolution, `projection: 'EPSG:25833'`. The compare curtain
  (`COMPARE_Z = 1.5`) covers the whole group.

`setBackgroundHidden` (`map/layers/config/backgroundLayers/utils.ts`) is scoped
to `bg.` and does not touch `cmp.`.

`kind: 'scene'` (`src/localities/sceneSpec.ts`) keeps the arrangement itself:
`meta = {bbox25833, ground, layers: [{id, opacity}]}` bottom-to-top plus the
`over` relation. `Oppsett` creates one (canAdd, buffered); `Legg ut igjen`
restores one in either stance, keeping only the topmost View and saying so
(`localities.scene.oneView`), and reports what has since been deleted rather
than silently dropping it. The pin is a flatten through `groundRasterOf` at the
sharpest member's `metresPerPx`, floored at 1500 m / 6000 px; a scene with
nothing to draw pins `empty`, not `failed`.

Which funn a bilde belongs to is read only through
`src/localities/funnGroups.ts`, because the relation does not cascade and an id
that no longer names a funn has to read as "none" everywhere at once.
`LayerMember.section` becomes a sticky heading in `LayerMembers`;
`[Visning ▾]` is deliberately ungrouped.

Terreng's own state is `src/shell/terrain/useTerrainAnalysis.ts`, mounted once
and unconditionally from `RibbonGlobalRow`; it publishes `describe()` and
`beholdKey` and holds no write of its own. The analysed rectangle is
`locality && tool === 'terrain' ? locality.bbox : null`. Entering it over a
lokalitet seeds the knobs once per lokalitet from `coverTerrainSpecAtom` through
`restoreView`, except when `next.derivedFrom === previous.id`.

## 11. Provenance figures

Every raster the app keeps or hands out goes through
`renderFigureBlob(canvas, spec)` in `src/figure/` (`draw.ts`, `figure.ts`,
`specs.ts`) and comes back as a figure: the image untouched, a scale bar and
north arrow on it, and a caption panel below naming the dataset, the
acquisition, the processing settings, the EPSG:25833 extent, the geodetic
centre, the rights holder and the licence.

- Scope is everything but "Last opp": both extract exits (Behold and the PNG
  download), Behold on any ground, the flyfoto grab, Ta skjermbilde, and all
  three steps of the starter set. An upload's provenance is unknown to the app.
- Producers hand back a canvas, not a blob (`fetchFlyfoto`,
  `captureLocalityScreenshot`, `renderTerrain`, `extractCanvas`).
- The image is fitted to the store *before* captioning: `MAX_STORED_PIXELS`
  40 Mpx, `MAX_STORED_BYTES` 50 MB as a re-encode backstop over
  `MAX_FIT_PASSES` 3, `MIN_FIGURE_WIDTH` 560 px. The function returns the
  resolution it actually wrote and callers record *that* as `meta.metresPerPx`.
- The caption is a panel below rather than an overlay, so the file is not
  pixel-registered to `bbox25833`; every attachment records `meta.imageRect`.
- Text wrapping splits on `/ +/`, so U+00A0 thousands separators survive. The
  north arrow is skipped under about six radii. `renderFigure` never throws.
- Strings are under `figure.*`, and `src/figure/` reads `t` / `i18n` from
  `'i18next'` directly, since three of its five call sites are outside React.

Measured limit: a 2025 reflight at 66 Mpx encoded to ~63 MB and PocketBase
rejected it with `validation_file_size_limit`; the 10/20 pkt tiers now resolve
to 0.25 m/px.

## 12. Icons and the build gotcha

`icon="…"` props are typed against the `MaterialSymbol` union that the
`material-symbols` package ships, re-exported from `src/ui/Icon.tsx`. A
plausible-looking name that is not in the union fails the docker build, and the
workstation has no `node_modules` to check against. The procedure:

```
curl -sL https://registry.npmjs.org/material-symbols/-/material-symbols-0.40.2.tgz \
  | tar xz -O package/index.d.ts | grep '"terrain"'
```

Known traps: `terrain`, `filter_hdr` and `topography` do not exist; `elevation`,
`landscape` and `altitude` do.

## 13. Internationalisation

Three locales — `src/locales/{nb,nn,en}/translation.json` — reached through
`t()`. A new string needs all three files, or i18next falls back and the surface
reads in the wrong language.

Two namespaces carry the ribbon and the lokalitet surfaces: `ribbon.*`
(`mode`, `lidar`, `flyfoto`, `heritage`, `layers`, `search`, `terrain`) and
`localities.*`. Figures are `figure.*`.

Three Norwegian strings under `src/search/` are still hardcoded: the
`` `${placeType} i ${municipalityNames}` `` joiner in `PlacesResults.tsx`,
`'Ja'` / `'Nei'` in `FeatureInfoSection.tsx`, and the thrown
`'Ingen matrikkelreferanse funnet'` in `PropertyInfo.tsx`.

One word for fading: Transparens (Transparency in en), under `*.transparency`.
Surfaces print transparency; storage is opacity.

## 14. The functionality contract

Everything a user can do today, one line per action. A replacement is not done
until each line has a home.

Navigate the map

- Pan by drag or arrow keys.
- Zoom by wheel, pinch, double-click or keyboard.
- Read the scale bar.
- Go fullscreen with F11.
- Deep-link a view via `?lat` / `?lon` / `?zoom`.

Find a place

- Search place names, addresses and cadastral properties.
- Filter the search by source, and clear it.
- Select a result: marker, fly-to and InfoBox.
- Arm Stedsinfo (button or `I`) and click for a coordinate and elevation readout.

Choose what the terrain looks like

- Switch Standard / LiDAR / Hybrid / Flyfoto / Terreng by button or digits 1–5.
- Hold X to peek at the previous ground, release to snap back.
- Draw Standard as five cartographies: topographic, greyscale, scanned paper,
  nautical chart, amtskart over a modern base.
- Pick the national LiDAR mosaic or any per-project dataset.
- See datasets ranked by viewport relevance, and expand to the rest.
- Preview a project's footprint on hover.
- Pick a render style, and expand to the full style list.
- Switch DTM / DOM.
- Draw contour lines over the hybrid overlay.
- Pick the ortofoto mosaic or any historical acquisition over the view.
- Narrow the acquisitions to one period, so list and ring walk only it.
- Cycle styles with A/D, datasets with W/S, the model with E, no pulldown.
- Put a second ground behind a draggable curtain (Sammenlign).
- Describe either half with row 1 and its strip, switching with A|B or `C`.
- Drag the curtain seam, or nudge it with the arrow keys once it has focus.
- Leave compare and take the second stack back down.
- Hide the funn with `H` or the `Funn` label, and bring them back.

Overlay the heritage record

- Put the overlay on or off with the eye on `Kulturminner`, which also arms the
  default register when nothing is on.
- Switch any of the five Riksantikvaren services individually.
- See the active-source count on the trigger, and clear them all.
- Pick which of kulturminner2's three registers are drawn.
- Draw them as outlines or filled.
- Narrow to one vern class: fredede, verneverdige, listeførte, uten vern, uavklart.
- Dim the whole overlay with a slider.
- Click a heritage feature for its attributes, with no tool to arm first.
- Deep-link it via `?themeLayers`, `?heritageDetails`, `?heritageRender`,
  `?heritageOpacity`.

Measure

- Measure distance and area with live on-map tooltips, and clear the measurement.

Own an area

- Sign in with OAuth or password.
- Propose a lokalitet's rectangle from the visible map.
- Move and resize it by any corner or edge with a live readout, then create it,
  or cancel with nothing written.
- Have it named after the nearest stedsnavn.
- Be stopped at 1500 m and 50 m per side, and told which limit and what it is.
- Rename it, describe it, set its visibility (private / limited / public).
- Read and edit its sted, kommune and matrikkel, pre-filled from the registers.
- Re-ask the registers after moving the rectangle.
- Read its centre coordinate and area.
- Search your lokaliteter by any of those.
- Adjust the rectangle afterwards (translate and modify).
- Edit in a session you end yourself: `Lagre` as often as you like without
  leaving edit, `Avbryt` back to the last save, `Avslutt` when done with unsaved
  work named and three ways past.
- Delete it.
- Frame the map back on it from its name or the row's `⋮`.
- Browse "Mine lokaliteter", and click a rectangle on the map to open it.
- See which known kulturminner fall inside it.
- Read its details in a dialog off the `⋮`.
- Copy a link with `Del`, in either stance, told whether anybody else can open it.
- Follow one and land on the lokalitet, framed and in show, signing in only on a
  miss.
- On somebody else's, press `Lag min kopi` for the rectangle, the details, every
  funn and every reproducible image as a private lokalitet of your own, with the
  original named in the banner.
- Take an inherited screenshot or upload across with `Ta med`.

Record what you find

- Arm the pen over the frozen map, zoomable without fetching a tile.
- Have the first finished shape become a buffered funn, auto-named.
- Draw as line, rectangle, ellipse, arrow or freehand, written back on its own.
- Undo and redo.
- Rename a funn, note it, set its status (mulig / sannsynlig / avkreftet /
  rapportert).
- Re-edit an existing funn's drawing.
- Zoom to a funn, and walk the list with ↑ / ↓ / Enter.
- Click or hover a funn on the map to select it in the list, and the reverse.
- Take the whole set off the map (`H`) or one funn at a time, in either stance,
  without that being a change to the record.
- Grow the lokalitet when a funn escapes it, unless that breaks the size band.

Draw over what you are reading

- Put a hand-drawn overlay on the ground with the full Excalidraw tool set.
- Keep it as a transparent bilde registered to the ground it was drawn on.
- Switch any number of them on and off over any background.
- Have a drawing come up with the image or the funn it was made about.
- Flatten the composition on screen — ground, layer-row members, sketches,
  heritage layers, funn — into one screenshot.

Analyse it

- Run terrain analysis (DTM or DOM) with eight visualizations, by pulldown or W/S.
- Set azimuth, altitude, exaggeration and Transparens live, plus a smoothing or
  horizon-search radius for the five views that have one.
- Analyse the open lokalitet's rectangle, or with none open place one for the
  purpose.
- Change what is analysed by moving the rectangle under "Juster området".
- Press `Behold` to keep whatever ground is on screen at the source's own
  resolution, the button reading `Beholdt` while that exact view is kept.
- Run a LiDAR extract over the rectangle at a chosen source and resolution, view
  it fullscreen, keep it as a Bilde.
- Fetch flyfoto — mosaic or historical acquisition — singly or as a batch.
- Take a map screenshot; upload an image.
- On a new lokalitet, get the best LiDAR dataset read three ways without asking,
  landing in the bottom edge and filling in as they render.

Keep it

- Walk the images along the bottom with ← / →, A / D or the chevrons, in both
  stances, each frame you land on going up on the ground.
- Pick an extract, terrain render or flyfoto onto the ground from `[Visning ▾]`,
  one at a time, the map going back the way that image was taken.
- Switch screenshots on from `[Bilde ▾]`, one or several, each with its own fade.
- Give an uploaded image an extent with `Plasser i ruta`, fitted to its own
  aspect inside the rectangle, marked as assumed, removable again.
- File an image under a funn with `Hører til`, badge readable in either stance.
- See a member say so on its own switch when the layer could not be shown.
- Take the ground away entirely and read a sketch and its funn on white.
- Keep the whole arrangement — layers, order, fades, ground — with `Oppsett`.
- Put one back with `Legg ut igjen`, in either stance, anything since deleted
  reported rather than missing.
- See a card that is still a set of parameters say so, and retry a failed render.
- Open the original in a tab, fetching it first where it does not exist yet.
- Caption an attachment.
- Delete one on confirm, without leaving edit.
- Drag a frame along the rail, or step it with the two arrows, to set exhibit
  order and so the cover.
- Hide one from the exhibit without deleting it, and see hidden ones dashed on
  the rail while editing.
- Fold the bottom edge away and back with `Bilder ▾`, leaving the map as it was.
- See flyfoto captioned with its acquisition year.
- Get every kept or downloaded image back as a report-ready figure — scale bar,
  north arrow, dataset, acquisition, settings, extent, rights holder and licence
  burned in — with only "Last opp" left as it arrived.
- Hand the whole lokalitet over as `Rapportpakke`: a zip with `index.html`,
  `README.txt`, the images in curated order, and the funn as GeoJSON and CSV.

Housekeeping

- Switch language (nb / nn / en).
- Open the help page at `/hjelp`.
- Sign out.

## 15. Removed upstream machinery — don't re-add

Deleted deliberately. If one of these reappears, something regressed. None of
the names below occurs in live `src/` code.

From the inherited Norgeskart app:

- The service-message banner (`src/messages/`, `src/api/messageApi.ts`) — it
  fetched Kartverket's announcements on every page load; the only consumer of
  `react-markdown` and `getEnvName()`.
- Hostname-based environment detection in `src/env.ts`, with `envName` and
  `layerProviderParameters.geoNorgeWMS` — it matched Kartverket's domains, so
  every Tufteseid deployment silently ran the DEV table. Now `DEFAULT_ENV` plus
  the `window.__NK_CONFIG__` override from the bind-mounted `config.js`.
- Google Fonts (Raleway + Work Sans) in `index.html` — nothing set
  `font-family`. Mulish is self-hosted, so `font-src 'self'` suffices.
- The generic theme-layer tree (`src/settings/map/themes/`,
  `src/map/layers/themeLayers.ts`, `MapTool = 'layers'`) — categories,
  subthemes, "add all", a fifteen-layer warning and a card slot, for five layers
  from one rights holder. The popover on `Kulturminner` replaced it; the
  catalogue is `docs/map-layers.md`.
- The whole OpenLayers drawing subsystem (`src/draw/`, `src/settings/draw/`,
  `src/localities/FunnDrawBar.tsx`, `src/localities/serializeDrawLayer.ts`, the
  `drawLayer` / `drawOverlayLayer` entries in `map/layers.ts`) — 23 files,
  ~3500 lines, replaced by Excalidraw over the frozen map. Do not port one
  control back because Excalidraw cannot snap or has no vertex editor.
- `getStyleFromProperties` / `getFeaturePropertiesForExport`, which
  round-tripped a funn's drawn colour — funn render in one style now.
- `drawEnabledAtom`, one of the two click owners `heritageClickArmedAtom` had to
  see; the guard is `funnSessionAtom`.
- The `Escape` / `Delete` bindings in `drawControlsKeyboardEffects.ts` and the
  top-level `draw.*` block in all three locale files — Excalidraw carries its
  own translations.
- The drawing import/export dialogs (~900 lines), the nautical-mile unit, and
  the only call for a `FileUpload` dropzone.
- Dead dependencies: `maplibre-gl`, `@geoblocks/ol-maplibre-layer` (OpenLayers
  is the engine for WMS + EPSG:25833) and `fast-xml-parser` (native
  `DOMParser`).

From the kvib migration:

- kvib itself, and with it Chakra, emotion, the `@zag-js` set, `react-select`,
  `react-day-picker`, `react-aria`, `react-stately`, `date-fns` and
  `react-icons`. `style-src` is now `'self'`, with inline style attributes on
  their own `style-src-attr`.
- `Accordion` — a controlled `Section` covers it.
- `Select` — the language picker is a native `<select>`; the point-style picker
  is a `Popover` of glyphs.
- `Pagination` — one consumer, inline in `PlacesResults.tsx`.
- A hand-built saturation/hue/alpha colour surface — `<input type="color">`
  plus recent swatches.
- `MapToolCardProps.hideHeader`, and the language switcher being mobile-only.

Built in its place: `src/ui/Alert.tsx` (a standing remark, not a toast) and
`src/ui/Menu.tsx` (verbs, with in-place `confirm` so a destructive item does not
stack two overlays); `Popover` flips upwards off `scrollHeight` when it does not
fit below. One kvib inheritance survives on purpose — the `[data-scope="…"]`
attributes the keyboard layers walk for. Keep setting them.

Ours, not upstream's:

- The dock — `Dock.tsx`, `LocalityDock.tsx`, `dockSlot.ts` (`dockSlotAtom`),
  `dockOpenAtom`, the tab that unfolded it, and `TerrainDock` before them. A
  fixed 360–400 px column charging a slice of the map whether or not anything
  in it was read.
- `BottomDrawToolSelector`, the phone-only fixed copy of the draw tools, and
  `--z-fixed`, its only consumer. Nothing should float free of the shell's
  stacking order again.
- `FunnDraft`, the dock's draft band — now `RibbonFunnDraftRow`, `FunnCallout`
  and the row's depth-2 exits.
- The `Kulturminner ▾` readout on the lokalitet row — `KulturminnerSection`,
  `useKulturminner`, `src/api/kulturminnerWfs.ts`, the workspace's
  `kulturminner` / `kmCount`, the `localities.kulturminner.*` strings. The same
  register is a theme layer with GetFeatureInfo behind a click; the endpoint is
  in `docs/map-layers.md` if it is ever wanted again.
- `openSectionsAtom` / `WorkspaceSectionId` — nothing folds any more.
- `Section`'s `scroll` prop, which only made sense in a fixed-height column.
  `Section` itself stays.
- The standalone terrain entrance — `src/terrain/atoms.ts`
  (`terrainStandaloneBboxAtom`), `src/terrain/useTerrainViewport.ts`, the strip's
  "Flytt analysen hit" and "Lagre som ny lokalitet" with their
  `localities.terrain.*` strings, the `save` path in `useTerrainAnalysis`, and
  `ribbon.terrain.tooLarge` / `.unavailable`. Terreng reads the open lokalitet's
  bbox and nothing else.
- The ground-overlay arbiter — `GroundOverlayOwner`, the `owner` tag on the
  placement, `showGroundOverlay`, `hideGroundOverlay`, `groundOverlayOwner`,
  `subscribeGroundOverlay`, the displaced-side-drops-its-selection effects.
  `zIndex: 1` is a stack now.
- `Gjenskap` as a button and `Vis i ruta` on a View — `RecreateButton` with its
  `localities.bilder.recreate` / `recreateHint` strings, and `canPinBilde`'s
  `extract` / `flyfoto` arms. Selecting the row in `[Visning ▾]` is the verb;
  `useRecreateView` is untouched underneath.
- The apply button inside `[Visning ▾]` and its checkboxes —
  `LayerMember.action`, `MemberRow`'s trailing `IconButton`, the `.action` rule
  in `LayerGroup.module.css`, `localities.layers.apply`, and with them
  `groundShownAtom` and the ground preset's separate switch. Do not give a
  member row a verb again.
- `Vis i ruta` / `Ta av ruta` and the pin mechanism behind them —
  `src/localities/usePinnedBilde.ts` with `canPinBilde`,
  `pinnedAttachmentIdAtom`, the workspace's `pinned` / `pin` / `pinOnWalk` and
  its fold/unfold restore, the `localities.bilder.showOnMap` / `hideFromMap` /
  `hideStripAndMap` strings, and the `pinnedFailed` note (which took `Note` in
  `bilderCommon.tsx` with it). The rail curates the exhibit, the layer row
  composes the map; do not put a map verb back on a card.
- `BildeTransparency`, the `ol/Overlay` slider on the rectangle's corner, with
  its stylesheet, its `ErrorBoundary` and `localities.bilder.transparency` —
  every member of `[Visning ▾]` and `[Bilde ▾]` carries its own fade now.

The Caddyfile CSP was narrowed to match; the `img-src` / `connect-src` host list
is `docs/wms-proxy-and-tiles.md`.

## Known rough edges

Fix-list; none of these are load-bearing.

- `mapToolAtom`'s `'measure'` member renders nothing — measure is a ribbon
  popover.
- `NKUrlParameter` carries `rotation`, `drawing` and `printTool` with no
  writers; `projection` is read and never written.
- The active LiDAR style and project, the active flyfoto acquisition and the
  open lokalitet's viewport are not in the URL.
- `trackPositionAtom` and its effect have no UI entry point.
- Search has no keyboard support: no arrow-key walk of the result list.
- The OL z-index ladder contains a `4.5` and a `1.5`.
- The compare seam clamps at a flat 5–95% rather than against `chromeInsets`, so
  it can be dragged under a card.
- `tsconfig.test.json` is not in `tsconfig.json`'s references, so `tsc -b` never
  typechecks anything under `test/`.
