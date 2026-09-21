# State of the branch — the map, with nothing on top of it

This branch took the interface down to the map and kept the machinery that
draws it. `src/App.tsx` renders `MapComponent` and nothing else: there is no
ribbon, no search box, no lokaliteter, no funn, no drawing, no account. The map
loads, the LiDAR hillshade grounds it, and every ground and theme layer below
is a `set()` away.

290 files became 79. The point was not to make the app smaller — it was to make
the next interface unconstrained by the last one, without re-deriving four
years of Kartverket and Riksantikvaren service quirks.

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
| `src/map/lidarFootprintsLayer.ts` | the dataset pulldown | mount once against the map |
| `src/map/compare/` | the compare curtain | `enterCompareAtom`, `compareSplitAtom` |

The compare curtain is here in full because the `halved()` facade in
`compare/halves.ts` is load-bearing in the background atoms — every ground atom
is a pair, `.a` on the map and `.b` behind the curtain — and unpicking it would
have meant rewriting the layer machinery that this branch exists to preserve.

**`src/ui/`, reduced to two files.** `Icon.tsx` because `MaterialSymbol` is the
union that keeps a plausible-but-absent icon name out of the build, and
`tokens.css` because the surviving stylesheets read its custom properties. The
rest of the kit went; a new interface picks its own primitives.

## What went

`src/shell/` (ribbon, layer rows, ground modes), `src/localities/`, `src/funn/`,
`src/figure/` (the provenance plates), `src/auth/`, `src/api/` (the PocketBase
clients), `src/measure/`, the search UI, `src/map/overlay/`,
`src/map/groundOverlay.ts`, `src/map/composite.ts`, `src/map/interactions.ts`,
and the vector layers nothing draws into any more.

`docs/ui-architecture.md`, `docs/analysis-roadmap.md`, `docs/open-questions.md`
and `docs/live-site-test.md` described that interface and went with it. All of
it is in `git log` on `main`.

## Driving the map without an interface

Every ground is a Jotai atom. Writing one rebuilds the stack, and
`backgroundLayerAtomEffect` (mounted by `MapComponent`) does the work.

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
- **Map z-indices 1, 2, 3 and 5–9 are free.** They were the old interface's
  overlays; `docs/map-layers.md` records what still occupies the rest.
