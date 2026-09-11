# Analysis roadmap — where lokalitet analysis stands, and what's next

Status note for the "what more can we do with a lokalitet" thread. It exists
so the next person doesn't re-run the survey: which open-source GIS tools
were considered, which were rejected and why, what got built, and what the
remaining builds would cost.

The detail lives elsewhere and is not repeated here — `terrain-analysis.md`
has the elevation endpoint facts and the full designs for the two unbuilt
tiers; `wms-proxy-and-tiles.md` has the proxy machinery every one of these
would route through. This file is the map of the territory.

## The frame

"Analysis" here means one specific thing: helping someone reading
relief-shaded terrain against the heritage register notice something that
isn't in the register yet. That test rules out a lot of otherwise good GIS
work — see *Rejected* below — and it is the only reason to prefer one build
over another.

The work sorts into three tiers by where the computation happens. They're
independent; none is a prerequisite for the next.

| | Where | Status |
|---|---|---|
| **Tier 0** | In the browser, over a fetched float DEM | **Built** (2026-09-09) |
| **Tier 1** | A server-side sidecar container | Designed, not built |
| **Tier 2** | Handoff — the user's own QGIS | Designed, not built |

## What changed: we can read elevation values now

Before this round, every terrain product in the app was a picture. Kartverket's
WMS publishes `skyggerelieff` and `helning_prosent` as named layers and the app
picked one; a hillshade baked at one sun angle hides every feature running
parallel to that light, and nothing downstream can recover what the renderer
threw away.

The unlock was finding that `hoydedata.no`'s ArcGIS ImageServers will hand over
the **raw float32 grid**, anonymously, via `exportImage` with
`renderingRule={"rasterFunction":"None"}`. Everything on this page rests on
that one fact. Endpoint quirks — sparse tiles as the no-coverage signal, water
reading as exactly 0.0, the fixed TIFF shape — are recorded in
`terrain-analysis.md` and were verified live, not assumed.

## Tier 0 — built

A "Terreng" action — on ribbon row 1 over the visible map, or in the lokalitet
row over an authored bbox — fetches the DEM for the rectangle once, then
computes relief locally: hillshade with a **live azimuth
slider**, multidirectional hillshade, slope, Local Relief Model, and Sky-View
Factor. Output saves as an attachment.

The slider is the point, not a nicety. Sweeping the sun across terrain already
in memory is the single most effective way to notice an earthwork, and it is
exactly what a pre-rendered WMS cannot offer. The two illumination-independent
views cover what no sun angle shows.

Files: `src/terrain/{dem,shade,render}.ts`, `src/shell/terrain/*`.
Proxy route `/arcgis/hoydedata/*`. Reuses `attachments.kind = 'extract'`, so no
PocketBase migration.

Since 2026-09-10 it also runs **headless**: `render.ts` holds the arithmetic
between a knob position and a canvas, and "Hent grunnpakke" uses it to drop a
multidirectional render into a new lokalitet's Bilder alongside an ortofoto and
a LiDAR hillshade, without anyone opening the panel (`docs/ui-architecture.md`
§8.9). The relevant consequence for this thread: an analysis nobody was asked
to configure is now the *first* thing a lokalitet has, so any Tier 1 product
should be judged on whether it is worth a press at all — the bar is no longer
"better than nothing".

Measured on a live 600×600 fetch: hillshade 32 ms, slope 18 ms, LRM 23 ms,
multidirectional 149 ms, SVF 775 ms. That spread is why the panel's two
`useMemo`s are split — see CLAUDE.md, along with the multidirectional-blend
azimuth trap, which fails silently.

Deliberately **not** used: `geotiff.js`. The endpoint emits exactly one TIFF
shape, and adding a dependency would mean regenerating `package-lock.json`,
which the workstation can't do. ~120 lines of reader instead.

## Tier 1 — server-side sidecar (designed)

What the browser can't reasonably do is the composite blends: VAT and e3MSTP
need several layers at multiple scales combined with specific opacity stacks,
and the reference implementation is Python. A small container following the
`nib-proxy` precedent — GDAL base plus `rvt-py` — reachable only from wmscache.

Full design in `terrain-analysis.md`. **The cost to weigh:** a new always-on
service and a Python dependency chain, for output that is a static image per
bbox. Decide after Tier 0 has had real use; if the client-side versions prove
good enough in practice, this doesn't earn its keep.

## Tier 2 — QGIS handoff (designed)

The point is to stop being the last stop. An "Åpne i QGIS" action producing a
zip: a `.qgs` project at the lokalitet's extent, the app's proxy layers
pre-wired, a GeoPackage of the rectangle and its funn, and the bbox DTM as a
GeoTIFF — we already have those bytes.

Full design, including which plugins are worth naming in user-facing docs, in
`terrain-analysis.md`. Cheapest of the three to build and the only one that
scales past whatever we think to implement.

**Licensing constraint on the bundle:** Kartverket elevation and
Riksantikvaren data are open (NLOD/CC BY). NiB imagery is not — free for
private non-commercial use only — so ortofoto must not be baked into an export
without the same notice the Flyfoto action shows.

## The tool survey

Verdicts against the frame above, so these don't get re-litigated. Licence
column matters for one reason: this repo is MIT, so a GPL tool has to stay
**out of process** — its own container, invoked over HTTP or as a CLI. That's
the sidecar shape anyway, so it constrains nothing we'd actually want to do.

| Tool | Licence | Verdict |
|---|---|---|
| **RVT / rvt-py** | Apache-2.0 | **The one that matters.** Written by the authors of the archaeological-visualization literature, for this exact job. Tier 1's reason to exist. |
| **QGIS** | GPL-2.0+ | Tier 2's target. Not something we ship — something we hand off to. |
| **GDAL** | MIT/X | Base image for any sidecar. Uncontroversial. |
| **WhiteboxTools** | MIT core | Good multiscale topographic position. Its "Extension" toolsets are **proprietary** and must stay out. |
| **SAGA / GRASS** | GPL | Already bundled with QGIS, so Tier 2 gets them free. `r.local.relief` is Hesse's LRM, written for archaeology; `r.geomorphon` classifies landform elements well. No reason to package them ourselves. |
| **PDAL** | BSD | Only path to genuinely *new* features (re-deriving ground from raw LAZ under forest canopy). Also by far the largest build — async order API, gigabytes per project, server-side processing. Not soon. |
| **Turf.js** | MIT | Already the right answer for lokalitet-scale spatial predicates. Keeps PostGIS unnecessary. |
| **geotiff.js** | MIT | Rejected for Tier 0 — see above. Would be the right call if we ever consumed TIFFs from a second source. |
| **TiTiler** | MIT | Solves dynamic tiling of our own rasters. We don't have our own rasters. |

### Rejected

- **Automated detection** (`samgeo`/SAM over an LRM, CNN mound detectors).
  Tempting and mostly MIT, but without fine-tuning on Norwegian material the
  false-positive rate makes it noise — and a tool that cries wolf is worse
  than no tool for this audience.
- **Potree / COPC in-browser point clouds.** Impressive; unrelated to reading
  terrain against the heritage register.
- **PostGIS.** The right general answer for spatial queries, but a
  lokalitet-scale workspace needs buffers and intersections over a handful of
  features. Turf.js does that client-side without a second database.
- **MapLibre.** Already removed from this fork. OpenLayers is correct for WMS
  and EPSG:25833; MapLibre is vector-tile-first and weak off Mercator.

## Data we're not pulling

Enumerated with reasoning in `terrain-analysis.md`. The ranking in short:

1. **NGU marine limit + shoreline displacement** — the standout. Coastal Stone
   Age sites sit at the contemporary shoreline, and isostatic rebound puts that
   shoreline at a computable elevation per location and millennium. With float
   elevation in hand this becomes a real predictive model rather than a guess.
   The strongest argument for having done Tier 0 at all.
2. **NGU Løsmasser** — Quaternary deposits; distinguishes an anthropogenic
   mound from a kame. Verified live, and a plain theme-layer addition.
3. **Kartverket historiske kart — the ØK sheets.** Amtskartserien already ships
   as a Standard variant (`map-layers.md`); ØK does not. Its sheets carry
   fornminne symbols surveyed before 20th-century ploughing. Complements the
   flyfoto time series directly.
4. **SSR toponyms as indicators** — filtering the *haug / borg / hov / ve /
   vang* families needs no new data source at all. Highest signal per unit of
   effort on this list.
5. **`kart.ra.no/arcgis/rest/services`** — unprobed. Would give real attribute
   tables where GetFeatureInfo currently gives scraps, on an origin we already
   proxy.

## If you're picking up this thread

Nothing here is blocked on anything else. Ordered by value per unit of work:
**SSR toponym filtering** (no new source), **NGU Løsmasser** (recipe already in
`map-layers.md`), **Tier 2** (cheapest of the tiers, scales past us), **shoreline
displacement** (highest ceiling, needs the NGU isobase model probed first),
**Tier 1** (only once Tier 0's client-side versions are shown insufficient).
