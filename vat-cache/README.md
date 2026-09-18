# vat-cache — prototype scripts behind the cached-VAT work order

Out-of-band tooling, not part of the SPA build. Nothing in `src/` imports it,
the docker build does not see it, and `package.json` is untouched. It runs on
whatever machine can reach `hoydedata.no` directly and has python.

These are the scripts the sizing study was done with, kept because the next
task replaces them with real tooling and the numbers they produced are the
inputs to that design. `WORK-ORDER.md` is the brief. `docs/terrain-analysis.md`
remains the authority on the operators themselves; `render.py` is a port of
`src/terrain/shade.ts` and is wrong wherever the two disagree.

## Running

```
python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python coverage.py "Vestfold og Telemark 5pkt 2021"   # -> coverage.npz
.venv/bin/python measure.py                                      # -> bytes per pixel
.venv/bin/python sizing.py                                       # -> storage tables
```

`coverage.npz` is a build artefact; it is not committed.

## The files

| File | What it does |
| --- | --- |
| `fetch_dem.py` | `exportImage` against `Prosjekt_DTM`, pinned to one `LAS_PROJECT_NAME`, plus the minimal tiled-float32 TIFF reader `dem.ts` also carries |
| `render.py` | numpy port of `shade.ts`: Horn gradients, hillshade, the 16-direction horizon scan, `composeVat`, combined VAT, and the constants all of them read |
| `coverage.py` | What ground an acquisition actually covers: catalogue rows, union rasterisation, sample-site picker, tile fill against the app's tile grid |
| `measure.py` | Renders the samples, quantises, tiles, encodes — reports bytes per pixel per product |
| `sizing.py` | Measured bytes per pixel + coverage → disk cost per zoom on the app's real ladder |

## What they established

For **Vestfold og Telemark 5pkt 2021**, measured over six sites spread across
the acquisition (relief 36–395 m):

- **Coverage is 1,106 km²**, not the 8,846 km² that summing `SHAPE.AREA` over
  the 270 catalogue rows suggests — the catalogue carries a row per overview
  level and each level re-covers the project. Envelope 185.6 × 102.9 km, 6 %
  filled. The rasteriser validates against a known 879.17 km² footprint to
  879.2 km².
- **Bytes per pixel**, 256 px tiles, fully covered only: VAT 0.607 PNG /
  0.257 WebP q90; sky-view 0.613 / 0.269; positive openness 0.677 / 0.334;
  negative openness 0.670 / 0.332.
- **Compute is not the constraint.** 8.4 s per km² for VAT at 0.5 m on one
  core, 1.3 s per km² for the horizon trio at 1 m. The DEM fetch is.
- **Below 1 m the horizon family gets worse and dearer at once**, because
  `SVF_MAX_RADIUS_PX` is a budget in steps: z15 costs 3.6× z14 and reads a
  15.9 m horizon instead of a 31.7 m one. VAT is not subject to this — its
  radii are fixed in metres by `VAT_PRESETS`.
- **VAT is the only one of the four that tiles without a global stretch**, because
  `composeVat` outputs 0..1 on absolute preset stretches. The other three would
  need one pooled stretch per level, and a per-tile percentile is not an option
  at all — neighbouring tiles would disagree, the fault that excluded
  `dynamisk_farget_hoyde`.
