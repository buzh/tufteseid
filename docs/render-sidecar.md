# The render sidecar (`rendersvc`)

Read before touching `rendersvc/`, `src/api/render.ts`, or the `sunloop` arms in
`src/evidence/`. What the browser's own producers do is `docs/architecture.md`
and `docs/terrain-analysis.md`.

Every other kept render is made in the tab that asked for it: `evidence/queue.ts`
drains one job, a producer in `render.ts` fetches and paints, and
`attachEvidenceFile` PATCHes the pixels onto a row that already exists. A 360°
sun rotation does not fit in that: it is 72 hillshades of one grid and a VP9
encode — a minute of work the main thread should not be doing, and work worth
spending only on a reader who has signed in.

So `rendersvc` takes an evidence row, renders it with RVT-py, and writes the file
back itself. One producer today, `sunloop`; the envelope around it — the token
check, the queue, the write-back — knows nothing about sun.

Python, stdlib HTTP, no framework, the way the two node sidecars are stdlib node.
`rvt-py` is the one non-obvious dependency and `vat-cache/` already paid for it.

**Not headless QGIS.** PyQGIS offscreen is an 800 MB–2 GB image whose hillshade
is gdaldem's — the same Lambert cosine with more machinery around it, and none of
RVT's other visualizations come along.

## Contract

```
POST /render/sunloop        Authorization: <the caller's PocketBase token>
{ "evidence": "<record id>", "legend": { … } }

202  queued                     408  the body stalled on the way in
400  no body, or not JSON       409  already queued or running for that row
401  no token                   422  the row is not a renderable sunloop
403  may not write that row     429  queue full, or this caller has one in flight
404  no such row                502  PocketBase or the producer fell over
```

`GET /render/health` answers `{ok, pending, capacity}`, which is what
`scripts/live-check.sh` asserts. `ok` is the worker thread's liveness and the
status follows it: 503 when the thread is gone, 200 while it is running. A queue
depth is not health — every other route keeps answering normally when the only
worker has stopped, so that is the one thing the probe has to see.

**The client names a row, not a rectangle.** The sidecar reads
`/api/collections/evidence/records/{id}?expand=spot` with the caller's own token;
the parameters come out of `meta` and the ground out of the expanded spot's
`footprint`. A job's cost is therefore bounded by what is stored, not by what was
posted, and there is no rectangle, resolution or frame count a request can ask
for.

### The token trade

`rendersvc` holds no credentials. Every PocketBase call carries the reader's own
token, so the collection rules decide what a job may touch and the permission
model is not reimplemented anywhere.

The consequence worth knowing: **the claim PATCH is the write gate, not the GET.**
A public spot's evidence is readable with no account at all, so a successful read
proves nothing. The order is read → claim → enqueue, and a claim PocketBase
refuses is answered 403 before anything is queued.

A token expiring mid-render loses the write-back, not the render. The row keeps
its `running` marker until it goes stale.

### Cost control

Signed-in-only falls out of the token check. On top of it:

| Limit | Where |
| --- | --- |
| One worker thread, serial | `server.py` |
| Queue of 8, counted as `len(pending)` rather than `jobs.full()` so a request thread can never block on the put | `QUEUE_MAX` |
| One job per caller, queued or running | `PER_CALLER_MAX` |
| Footprint ≤ 505 m a side (`MAX_SIDE_M` in `src/map/bbox.ts` plus round-trip slack) | `bbox_of` |
| 1600 px a side, whatever the ground publishes | `sunloop.MAX_FRAME_PX` |
| Step must divide 360, ≤ 45°; fps 1–60 | `spec_of` |
| 900 s an encode, the feed included, then the child is killed | `sunloop.ENCODE_TIMEOUT_S` |
| 64 kB request body | `MAX_BODY_BYTES` |
| 10 s a request, headers and body together | `REQUEST_TIMEOUT_S` |
| `cpus: 2.0`, `mem_limit: 2g` | `docker-compose.yml` |

The compose limits are the ones that matter for the stack: a render must not be
able to starve Caddy or PocketBase.

**The caller, not the row's owner.** `PER_CALLER_MAX` buckets by whoever holds
the token, because the collection rules let an admin and a spot's author write
somebody else's evidence: counting the row's owner would let one admin fill the
queue across eight readers' spots, and would refuse a reader who has queued
nothing. The id comes out of the PocketBase JWT's payload, base64url-decoded and
**not verified** — `pb.claim` is still the only thing deciding whether a token
may write a row, and a payload edited to name somebody else no longer verifies
there, so the slot it took is given straight back on the 403. A token whose
payload will not read shares one bucket rather than escaping the count. What a
forged claim buys is a different bucket, and `QUEUE_MAX` bounds the total either
way.

**The request timeout is a thread bound, not a courtesy.** `/render/*` is public
through a plain Caddy `reverse_proxy`, which streams rather than buffers, and the
token is not looked at until the body is read. So the handler carries a
`timeout`, which `socketserver` puts on the connection, and the body is read
`read1` at a time against one deadline rather than in a single blocking `read` —
a `read` that has asked for 64 kB does not come back until it has them, and the
socket timeout is renewed by every byte. A body that stalls is answered 408 and
the connection closed. `protocol_version` stays HTTP/1.0: with no keep-alive a
connection carries one request, so the deadline bounds the whole thread.

## The render

1. **Coverage probe** (`dem.probe_coverage`) — one `outStatistics` query for
   `min(OPPLOSNING)` over the rectangle, `where OPPLOSNING IS NOT NULL` so the
   10 m contour-derived rows cannot answer. No coverage arrives as one feature
   with a null statistic, and the service upper-cases the field name to `BEST`.
   A null marks the row **empty** and stops. A probe that *fails* is not an
   absence: it falls through at 0.25 m and lets the pixels answer.
2. **One `exportImage`** for the whole grid — `Prosjekt_DTM`/`Prosjekt_DOM`,
   `pixelType=F32`, `renderingRule` `None`, the explicit finest-wins
   `mosaicRule`. No tiling: the per-project services cap at 15 000 px and a
   footprint is 500 m. Four pixels of margin are fetched and cropped off after
   the gradient, so the edge is shaded against real ground.

   The pixel size is settled before the fetch and is **square by construction**:
   the width's even pixel count fixes `metres_per_px`, the height follows from
   that same figure, and the rectangle is then trimmed to the pixel grid about
   its centre. Otherwise `slope_aspect`, which is told
   `resolution_x == resolution_y`, and the burnt-in scale bar, which is drawn
   from one number, would both be wrong down the frame for a footprint whose two
   sides round differently — reachable, because the EPSG:4326 round trip is
   allowed its metre or two. The trim is sub-pixel, and the rectangle that is
   fetched is the `bbox25833` that `meta` reports.
3. **Decode** with `read_tiff_f32` from `vat-cache/fetch_dem.py`, copied into the
   image by the Dockerfile. Its treatment of absent tiles is load-bearing:
   `TileOffsets: 0` inside a valid TIFF must become NaN, where a generic reader
   hands back zeros — and sea level already reads exactly 0.0.

   **The hole mask is taken here, once, and the coverage gate is here too.** The
   catalogue answers for the rectangle as a whole, so a footprint over the edge
   of an acquisition or a lake the DTM is sparse over passes the probe and
   decodes mostly NaN. `binary_dilation` of the non-finite pixels, cropped to the
   rendered rectangle, is both the mask every azimuth reuses and the measure:
   under `MIN_COVERAGE` (half the square) the row is marked **empty** rather than
   given a picture of its own holes, and what is left is stored as
   `meta.coverage`.

   Dilation, because rvt's derivative substitutes a pixel's own value for a NaN
   neighbour (`roll_fill_nans`) and so halves the gradient right around a hole.
   rvt restores the input's NaN mask onto its output, so the hole itself is *not*
   drawn larger than it is; the invented rim is the reason for the extra pixel.
4. **`slope_aspect` once**, then `hillshade(…, slope=, aspect=)` per azimuth.
   That is RVT's own reuse parameter, so the gradient is computed once without
   reimplementing anything. Two things follow from it and are easy to get wrong:
   - The vertical exaggeration goes on `slope_aspect`. Given slope and aspect,
     `hillshade` never touches the DEM again and its own `ve_factor` is dead.
   - `slope_aspect` runs on a 1-px-padded grid, because `hillshade` pads
     internally and crops `[1:-1, 1:-1]` off the result whether it computed the
     gradient or was handed one.
5. **`byte_scale(…, c_min=0, c_max=1)`**, not its default per-array stretch, or
   every frame is scaled to its own extremes and the loop pumps. Then the mask is
   stamped on at `NO_DATA_VALUE`, mid grey. `byte_scale` writes a NaN as **255**,
   which is pure white and indistinguishable from fully lit ground, so absence
   has to be painted over the finished frame. Mid grey and not either end,
   because a real frame saturates at both: whole slopes come out 0 and lit faces
   come out 255.
6. **The band is composed once** (`legend.py`) and blended into every frame,
   over the stamped holes as well.
7. **Raw grey straight into ffmpeg**: `-f rawvideo -pix_fmt gray … -c:v libvpx-vp9
   -pix_fmt yuv420p -crf 32 -b:v 0 -row-mt 1 -g <frames>`. No PNG round trip and
   no frame files. Dimensions are forced even for `yuv420p`. One GOP, because the
   loop is played whole and never seeked into. The output goes to a real file:
   a WebM written to a pipe cannot be seeked back to for its cues. So does
   **stderr**: 72 frames of up to 1600 px is ~180 MB fed down stdin over minutes
   during which nothing here can drain a pipe, and an ffmpeg blocked on a full
   stderr would stop reading stdin and wedge both ends for good. A timer kills
   the child at `ENCODE_TIMEOUT_S`, so the deadline covers the feed and not only
   the wait at the end, and the child is killed and reaped on every path out —
   an abandoned ffmpeg would go on burning both cores against an output file the
   temporary-file block has already unlinked.
8. **Measured, not predicted**, the way `fitImageBlob` is: over the field's 50 MB
   the encode is redone at crf 40 then 48, and a third failure is a failure.
   PocketBase answers 400 to an oversized file and answers it again to every
   retry of the same bytes.
9. **One multipart PATCH** puts the file and the finished `meta` on together,
   hand-rolled over `urllib`, mirroring `attachEvidenceFile`.

0° and 355° make the loop seamless by construction; `<video loop>` does the rest.

Budget at 1600 px: ~3 s of RVT, ~5–15 s of fetch, ~20–60 s of VP9.

**Direct to hoydedata.no, never through wmscache.** Every job is a rectangle
nobody will ask for again, so caching one only evicts tiles that are re-read —
the same rule `vat-cache/` follows.

## Progress, without polling

The sidecar writes `meta.job = {state, at, detail}` when it takes a job and when
it fails; success replaces the whole marker with the file and the usual
`metresPerPx`, `bbox25833`, `coverage`, `frames`, `durationMs`, `renderedAt`.
The app is already subscribed (`subscribeEvidence`), so progress arrives over the
existing feed and **survives a reload or a closed tab**, which a browser render
does not.

`jobState` (`src/evidence/queue.ts`) reads the marker, and `stateOf` prefers the
local queue's opinion over it. A `running` marker older than 15 minutes reads as
`failed`, so a crashed worker offers a retry rather than an eternal hourglass.

A retry drops the stale marker in `accept()` before anything is written from it.
Without that, a second run that succeeds lands a row whose meta still says the
first one failed.

## The legend

The loop leaves the server already cited, because `stampEvidence` cannot help it:
`decodeToCanvas` is `createImageBitmap`, which throws on a WebM. So a still is
stamped at the door and a loop is burnt at render time.

The *content* is the client's either way — `legendContentFor` in
`src/evidence/legendContent.ts` composes the same `{title, facts, rights, link}`
`drawLegend` takes, and `sunLoopLegend` adds two fields for the sidecar. Which
facts a visualization answered to is the client's rule and stays in one place;
`legend.py` only typesets.

Two honest differences from a stamped still, both of them consequences of
burning early:

- **The band is fixed at render time.** A credit edited afterwards is not
  reflected in the loop, though it is in the caption and in a downloaded still.
- **The resolution is the one fact the client cannot know in advance**, so it
  travels as `{res}` inside a pre-localized format string that the sidecar
  substitutes and draws its scale bar from. The decimal separator travels with
  it: the rest of the band is already in the reader's language, and `0.50 m/px`
  next to `z 1,5` reads as a typo.

The face is DejaVu, not Mulish — the image has no npm build to take Mulish from —
and the layout is a stacked band rather than `legend.ts`'s two shedding columns.
What matches is what has to: the band sits over the bottom edge and never resizes
the frame, so the pixels stay registered to `bbox25833` everywhere the band is
not. Past 40 % of the frame height the link is dropped, then the scale bar. The
rights lines never are.

`ImageDraw` on an `L`-mode image defaults its ink to **1**, not 255, so every
text call passes `fill=INK` explicitly. Getting that wrong draws the band and the
bar and no words at all.

## Failure modes

There is one worker and it is never replaced, so nothing thrown inside the loop
body is allowed to leave it: a job that fails is logged and marked, and a
failure write that itself fails is logged and dropped. `pb._call` raises
`PbError` and nothing else — a truncated or non-JSON answer from PocketBase is
converted there rather than escaping as a `JSONDecodeError` — and both call
sites catch broadly anyway, because a thread that unwinds takes every later
render with it. If the thread stops all the same, `/health` answers 503 and
`live-check.sh` fails, rather than reporting a sidecar that renders nothing.

| What happens | What the row says |
| --- | --- |
| No laser data over the footprint, or a grid under half covered once decoded | `job.state = empty` — not a failure, and nothing a retry would change |
| `exportImage` sheds (a text body under a 200 status) | five retries with backoff inside `fetch_grid`, then `failed` |
| The coverage probe itself errors | logged, render continues at 0.25 m |
| ffmpeg fails, or the file will not fit after three encodes | `failed`, with ffmpeg's stderr in `job.detail` (300 chars) |
| An encode passes 900 s | the child is killed and reaped, `failed`, and the worker takes the next job with nothing left running |
| The container is restarted mid-job | the `running` marker goes stale after 15 minutes and reads as `failed`; the queue is not persisted |
| PocketBase refuses the claim | 403 to the caller, the queue slot is given back, no marker written |
| The failure write itself fails | logged and dropped; the loop takes the next job and the stale rule catches the row |

## Deploy

```
docker compose build --pull rendersvc
docker compose up -d
docker compose logs -f rendersvc
```

The build context is the **repo root** (`dockerfile: rendersvc/Dockerfile`), so
the image can copy `vat-cache/fetch_dem.py`; `.dockerignore` still excludes
`vat-cache` but re-admits that one file. One float-TIFF reader, one set of
quirks — `vat-cache/README.md` records the other end of the coupling.

`rvt-py` is installed `--no-deps`: it declares gdal, rasterio, geopandas and
jupyter for an IO layer none of this touches. `requirements.txt` carries what
`rvt.vis` actually reaches for, including `scipy<1.15` (it imports
`scipy.ndimage.morphology`, removed there) and matplotlib, which
`rvt.blend_func` imports at the top even though the sun loop never colours
anything.

**The base image is `python:3.11-slim` and must stay under 3.12.** rvt-py 2.2.3
declares `Requires-Python: >=3.6, <3.12`, and pip does not report that as a
conflict — it drops the release from the index and says no such version exists,
listing 2.2.1 as the newest there is. Bumping the base image therefore looks
like an upstream that deleted a release. The pin is 2.2.3 because that is what
`vat-cache/` runs and what the shading was checked against.

No CSP change: `media-src` falls back to `default-src 'self'`, and both the
endpoint and the file are same-origin.

## Adding a second producer

A producer is a module with one function returning
`(blob, filename, content_type, meta)` or `None` for "the source has nothing
here". What is already general: the route table in `Handler`, the token check,
`Refused`, the queue and its limits, `bbox_of`, the claim/attach pair, and the
`meta.job` protocol the client reads.

What is per-producer: the `spec_of` validation, the `kind` the row must carry,
and the migration that adds that kind to `evi_kind`.

On the client it is a variant in `src/evidence/spec.ts`, an arm in `labels.ts`,
an offer atom, and a branch in `queue.ts` that POSTs instead of rendering.
`BrowserSpec` in `render.ts` is `Exclude<EvidenceSpec, {kind: 'sunloop'}>` — a
server-side kind is excluded there so the browser producers' switch stays
exhaustive, and a second one joins that exclusion.
