# Work order — the cached cVAT ground as a background layer

Transient. When the layer lands this file goes, and `docs/map-layers.md` and
`docs/ui-architecture.md` state the result in the present tense.

## The job

Wire the tile store built by `build_tiles.py` into the app as a LiDAR dataset.
`WORK-ORDER.md` is the build; this is the last mile. No change to the renderer,
the store or the batch script.

## What is already there

- Tiles at `/cvat/<z>/<x>/<y>.webp`, z15 → z12, one acquisition: **Vestfold og
  Telemark 5pkt 2021**. RGBA WebP q90, alpha is coverage, 512 px.
- Served by Caddy's own `file_server`: the host store
  `/site/tufteseid/data/cvat` is bind-mounted read-only at `/var/www/cvat`,
  which is under `root * /var/www`. No route, no CSP host, no wmscache entry,
  and none needed — `img-src 'self'` already covers it.
- `/cvat/manifest.json` states the acquisition, the presets, the blend order and
  the digest. Before starting, check it reports digest `452fc98e5b32526a` and
  all four levels; if the run was still going when this was written, it may not.
- Grid: the app's own. Origin `[-2500000, 9045984]`, 512 px, resolutions
  `21664 / 2**z` — `src/map/layers/wmsTileGrid.ts` builds exactly this for
  EPSG:25833, and `build_tiles.py` encodes the same constants.
- Coverage envelope, EPSG:25833: `[61055, 6557418, 246691, 6660366]`,
  185.6 × 102.9 km, **6 % filled**. The acquisition is 1,106 km².

## Decisions already taken

### 1. A dataset in the LiDAR ring

A fourth choice beside Automatisk / Nasjonal / Prosjekt in
`src/shell/lidar/LidarDatasetPicker.tsx`, not a style within Prosjekt and not a
ribbon ground of its own. Its coverage is its own — one acquisition, four zoom
levels — and that is what a dataset is. It inherits the topo base, the faded
national mosaic beneath, the W/S ring and the compare curtain by being one.

The style and model controls are meaningless for it: the cache is DTM and one
visualization. `LidarStylePicker` and `LidarModelToggle` hide when it is active,
the way the picker already reacts to `DOM_STYLES`.

### 2. Automatisk prefers it inside the footprint

Below the engage threshold and inside the acquisition, Automatisk takes the
cache ahead of the Kartverket per-project WMS: it is the better picture, it is
on our own disk, and it spares a rate-limited upstream.

The footprint test needs no new machinery. `lidarRelevance.ts` already ranks the
projects the viewport touches with an `areaRatio` each, and **the acquisition's
`LidarProject.id` is byte-identical to the name `fetch_dem.py` sends hoydedata
as `LAS_PROJECT_NAME`** — `Vestfold og Telemark 5pkt 2021`, verified against
`wms.hoyde-dtm-prosjekt` GetCapabilities on 2026-09-19. So one equality check
against a constant, no name mapping, no second coverage source.

The fiddly part is not the rule but `chooseAutoDataset`'s signature:
`current: LidarProject | null` cannot express "this acquisition, from the
cache", and the release hysteresis must not flap between cvat and project for
the same acquisition. Widen the incumbent, don't bolt a boolean beside it.

### 3. A fourth layer type

The store is a plain tile URL, so `BackgroundLayer` gains an `XYZ` variant
beside WMTS / WMS / ArcGISImage. It touches, in order:

1. `backgroundLayers.ts` — `XYZLayerName = 'lidarCvat'`, into
   `BackgroundLayerName`.
2. `config/backgroundLayers/types.ts` — `XYZBackgroundLayer` with `url`
   (template), `coverageExtent`, and the zoom range.
3. A config module, `config/backgroundLayers/cvatGround.ts`, spread into
   `allConfiguredBackgroundLayers` in `stack.ts`. Static, not a
   `pickLayerConfig` branch: the source is one URL, not a runtime choice.
4. `utils.ts` — a `getXYZLayer`, a `getLayerFromConfig` arm, and an arm in
   `layerSignature` (`xyz|url|projection`); without the last one every dataset
   cycle rebuilds the layer instead of reusing it.
5. `stack.ts` — into `NEEDS_TOPO_BASE` (it has holes) and `LIDAR_LAYERS` (the
   hybrid overlay and contours mean the same thing over it), and a `fallback`
   arm putting the national mosaic under it at `FALLBACK_OPACITY`, as
   `lidarProject` has.
6. `config/backgroundLayers/atoms.ts` — into `VALID_STARTUP_LAYERS`. Unlike
   `lidarProject` its source does not start null, so a cold load is honest: the
   cache where it reaches, the faded mosaic and topo elsewhere. A shared URL to
   a lokalitet in Vestfold should open on the ground it was read on.

The tile grid is the WMS one restricted to z12–z15. OpenLayers indexes
`resolutions` by absolute z, so pass the full array and set `minZoom: 12`,
letting the array end at 15 — then OL never asks for a level the store has not
got, and over-zooming past z15 upsamples rather than 404s. Export the builder
from `wmsTileGrid.ts` rather than restating the origin, so the grid the app
draws on and the grid the batch wrote can only ever be the same one.

### 4. The envelope culls; the 404 is the mask

`coverageExtent` is the envelope, so OL stops asking outside it. Inside it, 94 %
of tiles do not exist and answer 404, which OL marks errored and leaves
transparent — the fallback shows through, which is the right picture. These are
requests to our own Caddy, not an upstream, so the cost is a log line. A coarse
coverage bitmap to cull them properly is an option, not a requirement.

## Naming and strings

Three files, `ribbon.*`, per CLAUDE.md. The label should say what the reader
sees, not how it is stored — "Buffret" describes our disk. Proposed nb/nn
**Arkeologisk relieff** / en **Archaeological relief**, after RVT's own name for
the combined VAT. A tooltip can carry the honest caveat: one acquisition, and
the reach of the visualization grows as you zoom out.

No in-app attribution. The tiles derive from Kartverket elevation (NLOD/CC BY)
and CLAUDE.md puts attribution in prose — add a line to `README.md` saying the
cached ground is a derived product, if it does not already say enough.

## Checks

- `npx oxlint@1.83.0` on the touched files; `src` carries pre-existing findings.
- JSON parse of the three locale files.
- `icon="…"` on any new control is typed against the `MaterialSymbol` union —
  `docs/ui-architecture.md` has the procedure for checking a name without local
  `node_modules`.
- No local build. TypeScript errors surface in the docker build on the server.
- After deploy: `scripts/live-check.sh`, then the eye pass of
  `docs/live-site-test.md` over a lokalitet inside the acquisition. Compare the
  cached ground against Prosjekt at the same spot — the cache should read
  richer, and the seam between work units should be invisible.
- Zoom out past z12 and pan outside Vestfold: the fallback takes over with no
  flash of white and no error tile left on screen.

## Open

- A second acquisition. The layer config names one in a constant; when there are
  two, the acquisition list comes off `/cvat/manifest.json` and the constant
  goes. Do not build for that now.
- Whether the Analyse tab should offer the cached ground as its base. It renders
  from the float field on purpose (`docs/terrain-analysis.md`), and a figure
  plate must keep doing that — `WORK-ORDER.md` §5.
