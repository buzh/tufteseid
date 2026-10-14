# The render sidecar (`rendersvc`)

Read before touching `src/api/render.ts` or the `sunloop` and `rvt` arms in
`src/evidence/`. What the browser's own producers do is `docs/architecture.md`
and `docs/terrain-analysis.md`.

**The service itself lives in another repo.**
[tufteseid-render](https://github.com/buzh/tufteseid-render) holds the Python,
its Dockerfile and the whole of its own subject — the queue, the RVT and ffmpeg
recipes, how the ground is fetched, the failure modes, what adding a producer
takes on that side. This page is the caller's half: what the app sends, what it
reads back, and what it hides when the service is off.

Every other kept render is made in the tab that asked for it: `evidence/queue.ts`
drains one job, a producer in `render.ts` fetches and paints, and
`attachEvidenceFile` PATCHes the pixels onto a row that already exists. Two kinds
do not fit in that. A 360° sun rotation is 72 hillshades of one grid and a VP9
encode; an RVT blend is a stack of horizon scans over a grid with hundreds of
metres of context around it. Both are minutes of work the main thread should not
be doing, and work worth spending only on a reader whose membership carries it
(`docs/identity.md`).

So those two kinds are handed over instead. The sidecar takes an evidence row,
renders it, and writes the file back itself with the caller's own token.

**Opt-in.** The container runs only where `.env` sets `ENABLE_RENDER=true`, and
the same key reaches the app, where it makes `useHasFeature('render')` answer
false for everybody — so the `fx` button that holds the two render lines, and
the gallery's redo on a `sunloop` or `rvt` row, are absent rather than failing
(`docs/architecture.md`). Rows made before the service was turned off still
read, download and carry their legend; the membership gate is the second filter,
on an installation that runs the sidecar at all.

## What the app sends

```
POST /render/sunloop        Authorization: <the reader's PocketBase token>
{ "evidence": "<record id>", "legend": { … } }

POST /render/rvt            Authorization: <the reader's PocketBase token>
{ "evidence": "<record id>" }
```

`src/api/render.ts` is the whole of it, and `/render/*` reaches the sidecar
through a plain Caddy `reverse_proxy` (`docs/wms-proxy-and-tiles.md`).

**A row is named, not a rectangle.** The sidecar reads the record itself with
the token it was handed, and takes the parameters out of `meta` and the ground
out of the expanded spot's `footprint`. So there is no rectangle, resolution or
frame count the client can ask for, and nothing a modified request could make
more expensive. The client's job is to have stored the right `meta` when it
created the row.

Which answers matter to this side:

| | |
| --- | --- |
| 202 | queued; the row's `meta.job` is the only progress from here on |
| 403 | the membership does not carry `render`, which `features.ts` should already have hidden, or PocketBase refused the claim |
| 409 | already queued or running for that row |
| 429 | the queue is full, or this reader already has one in flight |
| 422 | the stored `meta` is not renderable by that route — a client-side bug, not a user error |
| 503 | the worker is gone |

403, 429 and 503 are `RenderRefused`. Anything else is a transport failure and
is left alone.

**Only single-tile spots.** Because the sidecar renders the whole `footprint`
and refuses a boundary past the cap, `SpotRenders` offers a sun loop or a blend
only where the footprint is one render box (`docs/architecture.md`). A mosaic's
tiles are still browser-side work. Lifting that is a change at both ends: the
sidecar would have to take a per-tile box from the request and fan one job out
per tile.

## Reading the markers

The sidecar writes `meta.job = {state, at, detail}` when it takes a job and when
it fails; success replaces the whole marker with the file and the usual
`metresPerPx`, `bbox25833`, `coverage` and `renderedAt`, plus whatever the
producer adds — a loop's `frames`, `durationMs` and `bandTop`. The app is already
subscribed (`subscribeEvidence`), so progress arrives over the existing feed and
**survives a reload or a closed tab**, which a browser render does not.

**The marker is beaten, and five missed beats condemn it.** The sidecar rewrites
`job.at` every 60 s on every row it is holding, the running one and the queue
behind it, precisely because a healthy job can be silent for tens of minutes:
one elevation fetch may spend 900 s across its retries. So an unrefreshed marker
means nobody is working on the row, and `STALE_JOB_MS` (`src/evidence/queue.ts`)
is five beats — 5 minutes. A `queued` or `running` marker older than that reads
as `failed`, so a container restarted mid-job offers a retry within minutes
rather than after a quarter of an hour, and a slow job is never condemned for
being slow. **That figure is half of a contract**: shortening the sidecar's beat
without lengthening this one starts condemning live renders.

**Precedence, stated once** in `stateOf` (`src/evidence/useSpotEvidence.ts`):
a row that has pixels has no state at all; otherwise a job this browser is still
holding wins, being the only account of an ask the sidecar has not marked yet;
otherwise the marker, which outranks anything the local queue concluded. That is
what stops a handover that timed out — the POST is not aborted, so the sidecar
may well have taken the job — from captioning a finished loop "the render
failed" until the page is reloaded.

**A refused handover takes the row back.** A sidecar that answers at all has
queued nothing and written no marker, so the row it was handed would stand for
ever with neither pixels nor state: `stateOf` says nothing about it after a
reload, `SpotRenders` reads that as a render still on its way, and every press is
dead behind it. So `keep` deletes the row on a `RenderRefused`
(`src/api/render.ts`) and the reader is told the keep failed, the same trade
`keepProduced` already made. A handover that merely *timed out* is left alone,
because the POST is not aborted and the job may yet be claimed.

`empty` — the sidecar's answer for ground that has no laser data, or a grid under
half covered — is persisted and is **not terminal**: a reload still explains why
the row has no picture, and `mayRetry` (`queue.ts`) offers it the same retry a
`failed` row gets. A probe that answered for the rectangle as a whole, or a
coverage measurement taken one morning, is not a verdict on the ground.

## The legend's wording

A sun loop is cited in its own pixels, because `stampEvidence` cannot help it:
`decodeToCanvas` is `createImageBitmap`, which throws on a WebM. So a still is
stamped at the door and a loop is burnt at render time.

The *wording* is this side's either way. `legendContentFor`
(`src/evidence/legendContent.ts`) composes the `{title, facts, rights, centre,
link}` that `withLegend` takes, and `sunLoopLegend` composes the sidecar's
variant of it. Which facts a visualization answered to is the client's rule and
stays in one place, and the client is the only side that knows the reader's
language.

**What the wording asserts is not.** A loop's band is drawn by a server for a
file a public spot then serves to anyone with the URL, and nothing downstream can
tell a true band from a false one. So the sidecar substitutes rather than trusts:
the credit comes off the record it is already holding, and the link is composed
there from the spot's `code` and `visibility` and the installation's
`PUBLIC_ORIGIN` — a `link` in the request body is ignored. A caller who may PATCH
the row can still put a wrong licence on a band; what they cannot do is put
somebody else's name on their own render.

Two facts travel differently, and both are this side's doing:

- **The resolution is the one fact nobody can know in advance**, so it travels as
  `{res}` inside a pre-localized format string the sidecar substitutes. The
  decimal separator travels with it: the rest of the band is already in the
  reader's language, and `0.50 m/px` next to `z 1,5` reads as a typo.
- **No render date, and no stored resolution.** `sunLoopLegend` builds its facts
  from `specFacts` — what the catalogue knew before any pixel existed — rather
  than from `evidenceFacts`, which adds `meta.metresPerPx` and `meta.renderedAt`.
  On a first render those are absent; on a re-render they are the *previous*
  attempt's, and would print an old resolution beside the substituted one and a
  date older than the pixels under it. `evidenceFacts` keeps both for the three
  browser-rendered kinds, where they describe the file in hand.

A loop's band is in the stored file for good, where a still's is in the
downloaded copy only. That is what `meta.bandTop` is for:
`useEvidenceLoopOverlay` draws the rows above it over the whole footprint and
leaves the caption in the file, so the file keeps its citation and the map does
not wear it. **A loop rendered before the band moved under the frame** has ground
where the overlay now expects caption, and comes out stretched down the
footprint; re-asking for the loop is the fix, since nothing re-renders a row by
itself.

## Deploy

The sidecar is **a pinned image, not a build**:

```yaml
rendersvc:
  image: ghcr.io/buzh/tufteseid-render:0.1.0
```

so `docker compose build` no longer touches it and `docker compose pull` is what
moves it. A render change is therefore live in two steps and two repos: tag a
release in tufteseid-render, then bump the tag here.

```
docker compose pull rendersvc
docker compose up -d
docker compose logs -f rendersvc
```

`PUBLIC_ORIGIN` is read at startup, so a host that is not the compose default
exports it — or edits the default — and recreates the container. Nothing else
depends on it, and getting it wrong costs a wrong link in the band of every loop
rendered since.

No CSP change: `media-src` falls back to `default-src 'self'`, and both the
endpoint and the file are same-origin.

## Adding a producer

A new server-side kind is a change in both repos. In tufteseid-render it is a
module with four names and one entry in its route table; `docs/render-sidecar.md`
there states that half. Here it is:

- the migration that adds the kind to `evi_kind`;
- a variant in `src/evidence/spec.ts` and an arm in `labels.ts`;
- a branch in `queue.ts` that POSTs instead of rendering;
- somewhere to ask for it.

Where to ask follows what the producer reads: a reading of the map as it stands
is an offer atom feeding `keepOfferAtom`, which is what the camera in the spot
card keeps, the way the three browser kinds are. Neither server-side kind reads
anything on screen, so neither belongs on that camera; both are ordered from
`SpotRenders` (`src/spotControls/`), one line each off `sunLoopSpec` or `rvtSpec`
(`spec.ts`), and that list is where the next one's line goes too.

Two places state the server/browser split and both must agree: `rendersOnServer`
in `spec.ts`, which is what `SpotRenders` filters and counts on, and `BrowserSpec`
in `render.ts`, which excludes the server-side kinds so the browser producers'
switch stays exhaustive.

**A blend is not a producer.** Another RVT visualization is one entry in the
sidecar's recipe table, one entry in `RVT_BLENDS` (`src/evidence/spec.ts`), one
arm of the `evidence.rvt.*` strings, and nothing else: the kind, the route, the
migration and the line loop already exist.

## The seams

Four things are stated in both repos and must agree. Changing one here is a pull
request there as well.

| Seam | Here | There |
| --- | --- | --- |
| The `render` feature string | `src/auth/features.ts` | `server.py`'s `admit` |
| The `meta.job` protocol and the beat | `STALE_JOB_MS` in `src/evidence/queue.ts`, five beats | `BEAT_S`, 60 s |
| The legend's field names and `{res}`/`{credit}` tokens | `src/evidence/legendContent.ts` | `legend.py`, `legend_of` |
| A row's `kind` and its stored `meta` | `src/evidence/spec.ts`, plus the `evi_kind` migration | each producer's `spec_of` |

And one that is not a contract but a duplication: `read_tiff_f32` in
`vat-cache/fetch_dem.py` has a second copy in the sidecar's `tiff.py`. Before
the split the image copied this file; now it carries its own. One float-TIFF
endpoint, one set of quirks — a fix learned at either end is carried to the
other by hand (`vat-cache/README.md`).
