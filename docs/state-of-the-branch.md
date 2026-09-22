# State of the branch — the map, and a ribbon over the grounds

This branch took the interface down to the map and kept the machinery that
draws it. 290 files became 79. The point was not to make the app smaller — it
was to make the next interface unconstrained by the last one, without
re-deriving four years of Kartverket and Riksantikvaren service quirks.

The rebuild has reached the background and the record over it. `src/App.tsx`
renders a ribbon above `MapComponent`: it says which ground is drawing — LiDAR
relief, one of Kartverket's map series, or ortofoto — and which dataset within
it, and switches both. At the other end of the row it puts Riksantikvaren's
heritage layers over whatever that ground is, and says what of them; and only
when there is something to say, it names an external service that has stopped
answering. There is still no search box, no lokaliteter, no funn, no drawing
and no account, and no control over the Hybrid overlay, its contours or the
compare curtain — those remain a `set()` away.

The band and the controls are separate things. `src/ribbon/` is the band, and it
is laid out in three sections, each with its own subject and its own file:

| Section | Holds | Is about |
| --- | --- | --- |
| `GroundSection` | the ground switch and the arm belonging to it | what is drawn under everything |
| `ViewSection` | the compare curtain, once it is built | how the map is being looked at |
| `ToolSection` | the Kulturminner overlay and the upstream fault chip | what applies whichever ground is up |

The split is by subject, not by position. A control belongs to the left because
it chooses the one picture the whole map is made of, to the middle because it
changes how that picture is presented rather than which one it is, and to the
right because it is true of all three grounds at once. Which section a new
control goes in should be a question about the control, never about where there
is room. `Ribbon.tsx` itself is layout and nothing else; the middle section is
also the slack that holds the tools at the right-hand end, which is why it stays
mounted while empty.

Everything inside `GroundSection` is a surface mounted from its own directory:

| Directory | Is |
| --- | --- |
| `src/grounds/` | the ground switch — `GroundMenu`, one chip, three rows, and `useGroundControls` which derives which ground is up from `backgroundLayerAtom` rather than storing it |
| `src/lidarControls/` | the LiDAR arm — `LidarControlGroup`, four elements whose design is settled |
| `src/kartControls/` | the Kart arm — one chip over `KART_VARIANTS`, and the memory of which variant Kart means while another ground is up |
| `src/flyfotoControls/` | the Flyfoto arm — the NiB mosaic or one acquisition over the viewport, with the period filter inside its own dropdown |

That section is the ground switch and then one arm, never two: a row carrying
the controls of a ground that is not drawing would be three surfaces claiming
the same map. It mounts all three controllers regardless, because each remembers
something across a visit to another ground.

Every arm takes a controller object and no atoms of its own, so another host
can mount it; what a second host would have to do about there being one LiDAR
controller is at the top of `useLidarControls.ts`. A row of controls is made of
two shapes, and both are `src/ui/` primitives: `ControlChip`, the line of text
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
being told. Kulturminner is the one that wears it today.

`ToolSection` mounts one surface the same way, on the same seam:
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
| `src/terrain/` | the Analyse ribbon | `renderTerrain`, `terrainStaticField` / `terrainField` (`render.ts`) |
| `src/lidarExtract/` | the extract dialog | `extractCanvas` (`run.ts`) |
| `src/map/featureInfo/` fetchers | the Kulturminner popup | `fetchAllFeatureInfo` (`featureInfoService.ts`), `kulturminnesok.ts` |
| `src/search/searchApi.ts` | the search box | the place / address / property / coordinate queries |
| `src/map/compare/` | the compare curtain | `enterCompareAtom`, `compareSplitAtom` |

`src/map/lidarFootprintsLayer.ts` was on that list and is off it:
`MapComponent` mounts it again. It is what fills `lidarViewportAtom`, which the
ribbon's dataset menu lists and Automatisk decides from, and it paints the
outlines while that menu is open.

The compare curtain is here in full because the `halved()` facade in
`compare/halves.ts` is load-bearing in the background atoms — every ground atom
is a pair, `.a` on the map and `.b` behind the curtain — and unpicking it would
have meant rewriting the layer machinery that this branch exists to preserve.

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

## What went

`src/shell/` (ribbon, layer rows, ground modes), `src/localities/`, `src/funn/`,
`src/figure/` (the provenance plates), `src/auth/`, `src/api/` (the PocketBase
clients), `src/measure/`, the search UI, `src/map/overlay/`,
`src/map/groundOverlay.ts`, `src/map/composite.ts`, `src/map/interactions.ts`,
and the vector layers nothing draws into any more.

`docs/ui-architecture.md`, `docs/analysis-roadmap.md`, `docs/open-questions.md`
and `docs/live-site-test.md` described that interface and went with it. All of
it is in `git log` on `main`.

## Driving the map

Every ground is a Jotai atom. Writing one rebuilds the stack, and
`backgroundLayerAtomEffect` (mounted by `MapComponent`) does the work.

`backgroundLayerAtom` now has three writers, one per arm, and the ribbon mounts
each once. Reach for the arm's controller rather than the atom: on a LiDAR
flight the ground's *name* is a function of the render (`lidarFlightGround`),
so `useLidarControls` writes the style and the name together; on Kart the name
has to land in `kartVariantAtom` too, or the ground is forgotten the moment you
leave it; on Flyfoto the acquisition travels with the name. Which ground a name
belongs to is derived by `groundOf` (`src/grounds/`) out of the vocabularies the
layer code already keeps, so a ground that gains a member gains it in one place.

The rows below without an arm still have no writer at all.

Every atom the arms touch is the `.focused` facade of a `halved()` pair, so the
controls already describe whichever side of the compare curtain has focus. One
row plus a focus switch is a working split view today; a row per pane is the
change described at the top of `useLidarControls.ts`.

| Atom | Module | Does | Written by |
| --- | --- | --- | --- |
| `backgroundLayerAtom` | `layers/config/backgroundLayers/atoms.ts` | which ground | all three arms |
| `hybridOverlayAtom`, `hybridContoursAtom` | same | Kartverket's transparent overlay | — |
| `kartVariantAtom` | `…/kartVariants.ts` | which cartography | `useKartControls` |
| `activeLidarProjectAtom`, `activeLidarStyleAtom`, `activeLidarModelAtom` | `…/lidarProjects.ts` | per-project LiDAR | `useLidarControls` |
| `lidarAutoDatasetAtom` | `…/lidarAuto.ts` | pick the dataset from the viewport | `useLidarControls` |
| `activeCvatAcquisitionAtom` | `…/cvatGround.ts` | our own cached VAT render | `useLidarControls` |
| `activeFlyfotoProjectAtom` | `…/flyfotoBackground.ts` | one NiB acquisition | `useFlyfotoControls` |
| `activeThemeLayersAtom` | `layers/atoms.ts` | which Kulturminner layers | `useHeritageControls` |
| `heritageDetailsAtom`, `heritageRenderAtom`, `heritageOpacityAtom`, `heritageHiddenAtom` | `layers/heritage.ts` | how they are drawn | `useHeritageControls` |
| `terrainWindowAtom`, `frameTerrainWindowAtom` | `terrain/window.ts` | the rectangle under analysis | — |
| `compareOnAtom`, `compareSplitAtom`, `enterCompareAtom` | `map/compare/atoms.ts` | the curtain | — |

The URL still carries `projection`, `backgroundLayer`, `hybrid`, `contours`,
`lidarModel`, `themeLayers`, `heritage*`, `lat`, `lon` and `zoom`
(`UrlParameter`, `src/shared/utils/urlUtils.ts`), so a cold load lands where it
is told. `lok`, `sok`, `markerLat`, `markerLon` and `showSelection` went with
the surfaces that wrote them.

## Loose ends, deliberately left

- **`package.json` still lists `@excalidraw/excalidraw`, `pocketbase` and
  `@tanstack/react-query`** with nothing importing the first two. Removing a
  dependency means regenerating `package-lock.json`, which the workstation
  cannot do; it is one server-side `npm install` whenever the new model is
  known. The Excalidraw font plugin is already out of `vite.config.ts`.
- **PocketBase still runs the old schema.** `localities`, `finds` and
  `attachments` are untouched on disk and unreferenced by the client. The new
  model gets new migrations; nothing was dropped, because dropping a collection
  before knowing what replaces it only loses the test data twice.
- **`scripts/live-check.sh` still probes the old collections** and takes a
  lokalitet code. Its raster half — the one that matters on this branch — is
  correct; the PocketBase half checks a schema the client no longer reads.
- **No route but `/`.** Caddy has no SPA fallback, unchanged.
- **Only `nb` is a moving target.** Strings still go through `t()` so the
  retrofit stays free, but `nn` and `en` carry only what survived the cut and
  are not expected to keep pace until the interface stops moving.
- **Map z-indices 1, 2 and 5–9 are free.** They were the old interface's
  overlays; `docs/map-layers.md` records what still occupies the rest.
- **`lidarCyclingAtom` has a reader and no writer.** `lidarFootprintsLayer`
  keeps the viewport list warm while the keyboard ring walks datasets, and the
  ring (`useBackgroundCyclingKeys`, W/S/A/D/E) went with the old shell. It costs
  nothing false today and comes back with those keys.
- **The view section of the ribbon is empty.** The ground section is built, and
  the tool section holds the Kulturminner overlay and the upstream fault chip;
  no Hybrid overlay or contours, no compare curtain, no search — the atoms for
  all of them are live and unwritten. The three sections say where each of those
  goes when it is written; Hybrid is the next one in, and the only question it
  raises is whether a modifier over the ground belongs to the ground section or
  the tool section.
- **Nothing walks the rings.** The arms list and pick; there is no W/S step
  through datasets, variants or acquisitions, because those keys went with the
  old shell (`lidarCyclingAtom` above).
