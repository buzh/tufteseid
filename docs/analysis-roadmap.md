# Analysis roadmap — what is built, what is next, what was ruled out

"Analysis" here means one thing: helping someone reading relief-shaded terrain
against the heritage register notice something that isn't in the register yet.
That test is the only reason to prefer one build over another, and it rules out
a lot of otherwise good GIS work.

This file is the map of the territory. Endpoint facts and the two unbuilt tier
designs are in `docs/terrain-analysis.md`; the proxy machinery every one of
these would route through is in `docs/wms-proxy-and-tiles.md`.

The work sorts into three tiers by where the computation happens. They are
independent; none is a prerequisite for the next.

| | Where | Status |
|---|---|---|
| Tier 0 | In the browser, over a fetched float DEM | Built |
| Tier 1 | A server-side sidecar container | Designed, not built |
| Tier 2 | Handoff — the user's own QGIS | Designed, not built |

## Tier 0 — built

Terreng, on the lokalitet row, fetches the float DEM for the lokalitet's
rectangle once and computes relief locally. Eight views: hillshade with a live
azimuth slider, multidirectional hillshade, VAT, sky-view factor, positive and
negative openness, local relief model, slope. Output keeps as an attachment of
the existing `extract` kind, so no PocketBase migration.

Files: `src/terrain/{dem,shade,render}.ts`, `src/shell/terrain/*`. Proxy route
`/arcgis/hoydedata/*`.

- The azimuth slider is the point of having the values in memory: sweeping the
  sun is the most effective way to notice an earthwork, and a pre-rendered WMS
  cannot offer it. The five illumination-independent views cover what no sun
  angle shows, and W/S walks them.
- `render.ts` holds the arithmetic between a knob position and a canvas and can
  run headless, which is what lets `renderTerrain` be one of the jobs the
  background pin queue calls (`src/localities/pinQueue.ts`). Anything designed
  from here on should assume a spec row and a renderer, not a blocking save.
- A new lokalitet already arrives with three readings of the laser in it before
  anyone presses anything, so a Tier 1 product has to be worth a press — the
  bar is not "better than nothing".
- Measured on a live 600×600 fetch: hillshade 32 ms, slope 18 ms, LRM 23 ms,
  multidirectional 149 ms, horizon scan 775 ms. That spread is why the hook's
  memos are split.
- Deliberately not used: `geotiff.js`. The endpoint emits one TIFF shape, and a
  dependency would mean regenerating `package-lock.json`, which the workstation
  can't do.

## Tier 1 — server-side sidecar

Overtaken in most of its scope: RVT's blend modes collapse on single-band data,
so VAT is a few lines of arithmetic and openness is the sky-view ray walk read
a second way — all four shipped client-side. What remains is the multiscale
family (e3MSTP, multiscale topographic position), which needs DEMs at several
resolutions. Cost to weigh: a new always-on service and a Python dependency
chain for one visualization family. Design in `docs/terrain-analysis.md`.

## Tier 2 — QGIS handoff

An "Åpne i QGIS" zip: a `.qgs` project at the lokalitet's extent, the app's
proxy layers pre-wired, a GeoPackage of the rectangle and its funn, and the
bbox DTM as a GeoTIFF. Cheapest of the three and the only one that scales past
whatever we think to implement. Design, plugin list and the NiB licensing
constraint on the bundle: `docs/terrain-analysis.md`.

## The tool survey

Licence matters for one reason: this repo is MIT, so a GPL tool has to stay out
of process — its own container, invoked over HTTP or as a CLI. That is the
sidecar shape anyway.

| Tool | What it would give us | Licence | Verdict |
|---|---|---|---|
| RVT / rvt-py | The archaeological visualization set, by the authors of the literature | Apache-2.0 | The specification Tier 0 follows; `blend.py` / `blend_func.py` are where VAT was read off and where to check a suspect render |
| QGIS | The user's own processing chain | GPL-2.0+ | Tier 2's target — handed off to, not shipped |
| GDAL | Base image for any sidecar | MIT/X | Uncontroversial |
| WhiteboxTools | Multiscale topographic position | MIT core | Its "Extension" toolsets are proprietary and must stay out |
| SAGA / GRASS | `r.local.relief` (Hesse's LRM), `r.geomorphon` | GPL | Already bundled with QGIS, so Tier 2 gets them free; no reason to package them |
| PDAL | Re-derived ground from raw LAZ under canopy — the only path to genuinely new features | BSD | Wanted, but by far the largest build. Not soon |
| Turf.js | Lokalitet-scale spatial predicates | MIT | Already in use; keeps PostGIS unnecessary |
| geotiff.js | Reading arbitrary TIFFs | MIT | Rejected — one TIFF shape, and no way to regenerate the lockfile. Right call if a second source ever appears |
| TiTiler | Dynamic tiling of our own rasters | MIT | We don't have our own rasters |

### Rejected

- **Automated detection** (`samgeo`/SAM over an LRM, CNN mound detectors) —
  without fine-tuning on Norwegian material the false-positive rate is noise.
- **Potree / COPC in-browser point clouds** — unrelated to reading terrain
  against the heritage register.
- **PostGIS** — a handful of features per lokalitet is Turf.js work.
- **MapLibre** — already removed from this fork; OpenLayers is correct for WMS
  and EPSG:25833, MapLibre is vector-tile-first and weak off Mercator.

## Data we're not pulling

Enumerated with reasoning in `docs/terrain-analysis.md`; ranked by value per
unit of work, and nothing here is blocked on anything else.

1. **SSR toponyms as indicators** — the *haug / borg / hov / ve / vang*
   families, filtered out of the place-name search that already exists. No new
   data source.
2. **NGU Løsmasser** — Quaternary deposits; distinguishes an anthropogenic
   mound from a kame. Verified live, and a plain theme-layer addition (recipe
   in `docs/map-layers.md`).
3. **Kartverket historiske kart, the ØK sheets** — fornminne symbols surveyed
   before 20th-century ploughing. Complements the flyfoto time series.
4. **NGU marine limit + shoreline displacement** — highest ceiling: isostatic
   rebound puts the contemporary shoreline at a computable elevation per
   location and millennium, which turns coastal Stone Age sites into a real
   predictive model. Needs the NGU isobase model probed first.
5. **`kart.ra.no/arcgis/rest/services`** — unprobed. Would give real attribute
   tables where GetFeatureInfo gives scraps, on an origin we already proxy.
