# State of the branch — the map, and a ribbon over the LiDAR ring

This branch took the interface down to the map and kept the machinery that
draws it. 290 files became 79. The point was not to make the app smaller — it
was to make the next interface unconstrained by the last one, without
re-deriving four years of Kartverket and Riksantikvaren service quirks.

The rebuild has reached one surface. `src/App.tsx` renders a ribbon above
`MapComponent`: it says which LiDAR dataset and which render of it are drawing,
and switches both (`src/ribbon/`). There is still no search box, no lokaliteter,
no funn, no drawing and no account, and no control over the Kart, Flyfoto,
Amtskart or Hybrid grounds — those remain a `set()` away.

**Mantine is the design system.** `MantineProvider` and the theme
(`src/ui/theme.ts`) are mounted at the root, and new surfaces are built from its
primitives. `src/ui/tokens.css` is the old system's remains and stays only while
the surviving map stylesheets read it. One consequence is in the `Caddyfile`:
Mantine writes its CSS variables into a runtime `<style>` element, so
`style-src` had to become `style-src-elem 'self' 'unsafe-inline'`. A nonce would
be stricter and is not available — Caddy serves this as static files, so there
is no per-request value to mint.

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

**`src/ui/`, reduced to two files.** `Icon.tsx` because `MaterialSymbol` is the
union that keeps a plausible-but-absent icon name out of the build, and
`tokens.css` because the surviving stylesheets read its custom properties. The
rest of the kit went, and `theme.ts` replaced it: the primitives are Mantine's
now.

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

The LiDAR ones now have a writer: `useLidarControls` (`src/ribbon/`), which the
ribbon mounts once. Do not reach past it for `activeLidarStyleAtom` or
`backgroundLayerAtom` on a flight — on a flight the ground's *name* is a
function of the render (`lidarFlightGround`), and the two would end up naming
different things. Everything else in the table below still has no writer at all.

| Atom | Module | Does |
| --- | --- | --- |
| `backgroundLayerAtom` | `layers/config/backgroundLayers/atoms.ts` | which ground |
| `hybridOverlayAtom`, `hybridContoursAtom` | same | Kartverket's transparent overlay |
| `kartVariantAtom` | `…/kartVariants.ts` | which cartography |
| `activeLidarProjectAtom`, `activeLidarStyleAtom`, `activeLidarModelAtom` | `…/lidarProjects.ts` | per-project LiDAR |
| `lidarAutoDatasetAtom` | `…/lidarAuto.ts` | pick the dataset from the viewport |
| `activeCvatAcquisitionAtom` | `…/cvatGround.ts` | our own cached VAT render |
| `activeFlyfotoProjectAtom` | `…/flyfotoBackground.ts` | one NiB acquisition |
| `activeThemeLayersAtom` | `layers/atoms.ts` | which Kulturminner layers |
| `heritageDetailsAtom`, `heritageRenderAtom`, `heritageOpacityAtom`, `heritageHiddenAtom` | `layers/heritage.ts` | how they are drawn |
| `terrainWindowAtom`, `frameTerrainWindowAtom` | `terrain/window.ts` | the rectangle under analysis |
| `compareOnAtom`, `compareSplitAtom`, `enterCompareAtom` | `map/compare/atoms.ts` | the curtain |

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
- **The ribbon covers the LiDAR ring only.** No ground switch, no Hybrid
  overlay or contours toggle, no compare curtain, no search — the atoms for all
  of them are live and unwritten.
