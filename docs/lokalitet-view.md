# The lokalitet view — a draft

**Status: design draft, nothing built.** When it is built this folds into
`docs/ui-architecture.md` §8 and the deletions land in §15; until then this
file is the argument, not the record.

Today "a lokalitet is open" is a context strip plus a dock column, and the rest
of the app carries on unchanged — Terreng and Sammenlign sit in row 1 whether
or not there is a site to point them at, and the only thing the app knows about
permission is the boolean `isMine`, which it spends on hiding buttons.

What it becomes: **a view with two stances.** Selecting a lokalitet is a change
of subject, and once you are in it you are either *looking at* the reading or
*doing* the reading. The lifecycle the whole thing serves:

> work on a lokalitet until you are happy → show it → hand it over.

**The workshop, the exhibit, the catalogue.** Edit is where the tools are.
Show is what the work was for. The takeout is the exhibit made portable — a
bundle for Riksantikvaren, or a link for a colleague.

---

## 1. Two axes, not one

The last draft collapsed permission and stance into one axis. They are
orthogonal, and separating them is what makes the interface fall out:

| | **Show** | **Edit** |
|---|---|---|
| **Owner** | your own site, as you left it | the workshop |
| **Reader** | someone else's site, as they left it | — offers a copy |

Permission is a fact about the record. Stance is a choice you make inside it.
An owner opening their own lokalitet lands in **show**, exactly like a visitor
does — because what you want first is to see what you already worked out, not
a wall of tools.

```ts
type Access = 'owner' | 'admin' | 'reader'   // fact
type Stance = 'show' | 'edit'                // choice
const canEdit = access !== 'reader'
```

`canEdit` is what the ~50 existing `isMine` lines become, across six files
(`useLocalityWorkspace`, `LocalityDock`, `RibbonLocalityRow`, `BilderSection`,
`LocalityDetails`, `LocalitiesPanel`). Mechanical, but not small. `admin` is not a
courtesy: the PocketBase rules already grant update and delete to
`@request.auth.role = "admin"`, so the UI has been quietly lying to admins
about records the server would let them change.

**A copy is not a third stance.** It is how a reader gets to edit: an ordinary
lokalitet you own, and the moment it exists you are an owner in edit with
nothing left over.

---

## 2. The invariant: nothing in show writes

One rule, and everything else in this document is downstream of it.

**In show mode nothing you do leaves a trace.** Change the ground, sweep the
azimuth, drag the compare curtain, walk the funn, fade an old photograph over
the live relief — none of it touches the record. Show is a lens.

That is worth having as a hard rule rather than a tendency for three reasons:

- It makes show mode **safe to hand to someone**. When sharing lands, a link
  opens in show, and the guarantee that a visitor cannot disturb what you sent
  them is the guarantee that makes sending it comfortable.
- It re-instates, at the right level, the principle that moving Terreng off
  row 1 costs us (§8): *reading the ground is not an act of ownership.* It
  stops being true of the app as a whole and becomes true of show mode, which
  is where it was always doing its real work.
- It gives write verbs one uniform behaviour instead of two.

### Show has no write verbs at all

Not disabled ones, not escalating ones — **absent**. The write-verb zone of
the row, which is where every verb that leaves something behind lives (§5),
simply does not render in show mode. There is exactly one way to write to a
lokalitet, and it is to press `Rediger` first.

An earlier draft had write verbs *escalate* — press `Lagre` in show and the
app quietly flips you to edit and saves. That was the right instinct with the
wrong mechanism. It bought convenience at the cost of the one thing this
section exists to guarantee, because "nothing in show writes" and "reaching
for a write in show writes" cannot both be true, and a rule with a hole in it
is not a rule you can hand to a stranger.

What replaces it is cheaper and more honest: **`Rediger` costs nothing.**
Entering edit is a client-side state change — no fetch, no write, the map does
not move and the render does not blink. So a visitor who dials up a better
render than the one they were shown is one button from keeping it, and the
button says what it does. That is not friction worth engineering away; it is
the moment where the app tells you that you are about to change something.

**For a reader, that button is `Lag min kopi`** — same slot, same gesture, and
it is the only escalation left in the design: it copies, swaps you to the
copy, and drops you in edit there. One prompt, one place, rather than an
`authorThen` wrapper around every write path.

**Slett is not an exception to anything.** It is hidden for readers, full
stop; offering to duplicate a record so you can delete the duplicate is
nonsense.

**Downloading an image is not a write, and stays available in show.** Every
raster the app hands out carries its provenance caption (§8.10) — dataset,
parameters, extent, licence — so a figure taken out of someone else's
lokalitet still says what it is. That is what `src/figure/` is for, and it is
what makes show mode safe to be generous with.

### Edit is a transaction

The second half of the invariant, and it is what the row's right zone is for.
Entering edit opens a **draft**; `Lagre` commits it; `Avbryt` throws it away
and returns you to show with the record exactly as it was. §5.3 draws the
exits and §5.6 itemises what the transaction costs, including the one place it
genuinely cannot hold.

---

## 3. Entering and leaving

- **Opening any lokalitet lands in show.** Yours, theirs, from the panel, from
  a link.
- **One exception: a brand-new lokalitet opens in edit.** A rectangle you
  framed thirty seconds ago has nothing to show, and making the first press on
  every fresh site be "Rediger" is a click that teaches nothing. Same for the
  lokalitet that Terreng creates when you press `5` with none open (§8) — you
  are there to save a render.
- **The way in is one button in one slot**: `Rediger` for an owner,
  `Lag min kopi` for a reader. Honest labels beat one label with two
  behaviours.
- **The way out is two buttons**, because edit is a transaction: `Lagre`
  commits, `Avbryt` discards. There is no `Ferdig` — a stance you can leave
  without answering "keep this?" is not a transaction.
- **Stance is per session, not stored on the record.** It is a stance, not a
  property of the site. (When sharing lands, a link must pin `show`
  regardless — noted in §10.)
- **An uncommitted draft blocks the exits.** `Lukk` and `Del` are absent while
  editing: you cannot close or hand out a record whose current state exists
  only in your browser. This is the modality made visible rather than
  enforced with a dialog.
- Edit mode tints its ribbon row. Which stance you are in should be legible
  without reading a label, and the row's contents already differ; the tint is
  the confirmation, not the signal.

---

## 4. Images

This is the part to get right, because in show mode the images **are** the
content. Everything else on the screen is the ground they were made from.

### 4.1 A bilde is a reproducible view, and the data already nearly proves it

The gallery today presents attachments as files: a grid of thumbnails, a
lightbox, a caption. But look at what `meta` actually holds (§8.7):

| Kind | Recorded now | Can be re-laid on the map | Can restore the view that made it |
|---|---|---|---|
| terrain (`extract` + `meta.style`) | `style`, `model`, `azimuth`, `altitude`, `zFactor`, `radius`, `metresPerPx`, `bbox25833`, `imageRect` | ✔ | **✔ completely** |
| LiDAR extract | `sourceKey`, `sourceLabel`, `style`, `metresPerPx`, `bbox25833`, `imageRect` | ✔ | ✔ (dataset + style) |
| flyfoto | `sourceLabel`, `projectName`, `year`, `photoDate`, `metresPerPx`, `bbox25833`, `imageRect` | ✔ | ~ by name only — **gap** |
| screenshot | `metresPerPx`, `bbox25833`, `imageRect` | ✔ | ✘ — **gap** |
| upload | nothing | ✘ | ✘ |

So the claim *a saved image is a reproducible reading of this rectangle, not a
picture of it* is already true for the two kinds that matter most, and the
gaps are named fields:

- **flyfoto**: record the acquisition's **project id**, not just its name.
  Matching "1937" by string against a live NiB list is the kind of thing that
  works until two projects share a year.
- **LiDAR extract**: record the **model**. It is DTM-only today so the field
  is implicit, and it stops being implicit the moment step 9 teaches
  `sources.ts` about DOM. Cheap to add now, a data migration to add later.
- **screenshot**: record the **background layer name, the active theme layers
  and the heritage render settings**. The figure caption already prints the
  ground (`GROUND_LABEL_KEY` in `useLocalityWorkspace`) — it is in the baked
  pixels but not in the record.
- **upload** stays unrestorable and un-overlayable, and that is correct: its
  provenance is unknown to the app, which is why it is the one producer that
  bypasses the figure stage.

### 4.1.1 Two kinds of bilde: a View and a File

The table above is really drawing a line, and the line is worth promoting to
a concept because a surprising amount of this document simplifies once it
has a name.

| | **View** | **File** |
|---|---|---|
| Kinds | terrain render, LiDAR extract, flyfoto | screenshot, upload |
| What it fundamentally is | a row of parameters | bytes |
| Can be produced from the record alone | ✔ | ✘ |
| Costs | a few hundred bytes | up to 20 MB |
| `Gjenskap` (§4.2) | the point of it | meaningless |

**The category is derivable from `kind`**, so it needs no field and no
migration: `extract` and `flyfoto` are Views, `screenshot` and `upload` are
Files. A screenshot is a File not because it is unimportant but because it is
a picture of *other layers at a moment* — theme rendering, labels, funn, zoom
— and no realistic amount of recorded state reproduces that. Recording its
ground (the gap above) is for the caption, not for restore, which downgrades
that gap's priority without deleting it.

**A View's `meta` is already its complete specification.** Nothing new to
store: `meta` holds the parameters today because the figure caption needs to
print them, and printing them and re-rendering from them want exactly the
same fields. The only schema change the whole idea needs is making
`attachments.file` **optional** (§11).

That is the seam. What follows from it is §4.1.2.

### 4.1.2 A View is stored as a spec; the file is a pin, not the record

A View can exist in three states, and the app should be able to move it
between them without the user thinking about it:

| State | Has | Costs | What it is for |
|---|---|---|---|
| **spec** | `meta` only, no file | ~300 bytes | working state — kept, ordered, discarded, copied |
| **pinned** | spec + the figure PNG | up to 20 MB | the citable artifact: exactly the pixels the author saw |
| **stale** | spec + a file whose spec has moved on | — | after `Gjenskap` edits the parameters |

**The record is the spec. The file is a pin on it.** That inversion is the
whole idea, and three things fall out of it that are each worth more than the
storage saving:

- **Keeping an image becomes free.** `Behold` writes a few hundred bytes, not
  a 20 MB upload. Triage in the carousel and the picker stops having a cost
  per keep, which is what triage wants.
- **Discarding becomes genuinely free**, which is what dissolves the
  compensating transaction (§5.6).
- **A copy can carry the images** (§7), because they are now kilobytes.

**But "just store the parameters" cannot be the whole answer**, and this is
the limit worth being precise about. Reproducible is not the same as
reproducible *forever*. Kartverket re-flies LiDAR projects and retires the
old ones; NiB re-processes orthomosaics; hoydedata updates a DTM when new
laser lands. A spec re-rendered in 2029 may honestly not be the image its
author was looking at in 2026, and the caption would say the same words over
different pixels — which is the precise failure `src/figure/` exists to
prevent, in a new place.

This app's product is evidence. So:

> **Pin on commit, in the background.** `Lagre` writes rows and returns; a
> queue then renders and uploads the figure for every unpinned View. The
> commit is fast, the pixels are pinned within seconds of the author deciding
> they were worth keeping, and a failed upload is retryable because the spec
> is still there.

Pinning is also forced, regardless of the queue, at the two moments bytes
must exist and be *these* bytes: **Rapportpakke** (§9) and **Last ned**. And
`meta.renderedAt` records when the pixels were made, so a pin and its spec
can be compared later rather than merely trusted.

What this deliberately does **not** do is materialise on `Behold`. The
session where you keep twelve renders and throw eight away should cost eight
nothing.

### 4.2 The map is the lightbox

Picking an image does not open a modal over the map. It **puts the image in
the rectangle it is of** — georeferenced at its `bbox25833`, cropped to
`imageRect`, sitting inside the lokalitet's own outline with the live map
around it. You then zoom and pan as usual, because it is on the map.

That deletes the lightbox rather than keeping it, and everything it was for
comes back better:

| The lightbox gave you | The map gives you |
|---|---|
| a bigger view | zoom, to native resolution and past it |
| the image alone | the image **in context** — the ground around it, the funn on top |
| next / previous | the filmstrip, and the ground stays put between images |
| — | scale, orientation and position for free; they are the map's |
| — | fade it against whatever is underneath |

This is the same argument that already put the terrain render on the map
instead of in a thumbnail on the ribbon (§10): *relief is the ground*, and so
is a 1937 ortofoto of it. A photograph of a hillside shown at an arbitrary
size in a modal is a picture. The same photograph pinned to the hillside, at
the right scale, with a hillshade of the same ground fading in under it, is
evidence.

So each image offers:

1. **Vis i ruta** — the above. Selecting it in the strip *is* this; there is no
   separate verb.
2. **Toning** — an opacity slider beside the strip, fading it towards whatever
   ground is live underneath. The one control that makes the overlay a
   comparison rather than a picture.
3. **Gjenskap** — put the live map back into the state that produced it:
   ground, dataset, style or visualization, DTM/DOM, the sliders. For a
   terrain render this means the app recomputes the same view live, at full
   map resolution, instead of showing you the PNG of it.
4. **Last ned** — the figure PNG, provenance baked in. For an unpinned View
   this pins it first (§4.1.2); there is no such thing as downloading a
   parameter row.

Under §4.1.2, (1) and (3) stop being two verbs with a family resemblance and
become the same mechanism seen from two sides. **Vis i ruta on an unpinned
View *is* Gjenskap, drawn into the rectangle instead of onto the whole map.**
That is worth saying plainly because it decides what the strip does when a
spec has no pixels yet: it does not fail and it does not show a placeholder,
it renders — the same code path `Behold` would have run. Gjenskap stops being
the clever extra at position 3 and becomes the primitive the other three are
written on top of.

Files keep exactly two of the four: **Vis i ruta** (a screenshot has a
`bbox25833` and an `imageRect`, so it lays down like anything else) and **Last
ned**. Gjenskap is meaningless for them and the button is absent, not
disabled — there is no state to restore.

`meta.imageRect` is what makes (1) possible and it already exists — the caption
panel is drawn below the image, so the file is not pixel-registered to the
bbox and something had to record where the ground is inside it. Written for
the figure stage; exactly what an overlay needs.

And (1) plus (2) is the thing the whole app is for: **the owner's 1937
ortofoto, faded over the reader's live LiDAR hillshade, with the funn drawn on
top.** Two readings of one hillside in register, one of them made two years ago
by someone else.

All four are pure reads, available to readers, and available in both stances.

Three details this pins down:

- **One image at a time, and it takes the terrain render's slot.** Both are "an
  image of this rectangle" at `zIndex: 1`, and two of them stacked is a
  question nobody asked. Showing a bilde hides a live terrain render and vice
  versa. The layer itself is `terrainOverlayLayer.ts` generalised — an
  `ol/layer/Image` over an `ImageCanvasSource` pinned to `EPSG:25833`,
  imperative and module-level so a dragged opacity slider does not re-render
  the shell.
- **Smoothing off past native resolution**, the same rule and for the same
  reason as the terrain overlay: upscale smoothing blurs away the single-pixel
  step — a ditch edge, the lip of a mound — that the image exists to show. The
  strip shows the image's `metresPerPx` so you can see when you have gone past
  it.
- **Load the 800 px preview first, the original behind it.** PB's `800x0`
  thumb arrives fast and is enough until you zoom; the original can be tens of
  megabytes for a stitched extract, and PB regularly cannot generate thumbs
  for those at all (already handled in `useAttachmentUrl`'s fallback). Swap
  when it lands.

### 4.3 The bottom edge, and its occupants

The dock is gone (§6). The images live along the bottom of the map, and the
surface differs by stance because the jobs are not the same one:

| Stance | Surface | Job |
|---|---|---|
| **Show** | **filmstrip** — a rail of thumbnails | walk a curated sequence |
| **Edit** | **carousel** — one card at a time, big | curate what is kept, and receive what arrives |

**Built, then reversed on the second row.** Edit is a rail too — the same
geometry as show, with the write verbs added under it. The argument for the big
card was that judging a caption off an 88×64 thumbnail is judging it blind,
which is true of looking at one image and false of arranging a set: curating an
exhibit is mostly deciding what follows what, and one card at a time makes
every reorder a move you have to go and verify afterwards. What the big card
was for is better served by `Vis i ruta`, which puts the image on the ground it
is of at full size. `docs/ui-architecture.md` §8.7.2 is what is actually there;
the rest of this section still holds.

Both declare `data-chrome="bottom"` and join `chromeInsets` with nothing to
register — the mechanism the dock already used when it became a bottom sheet
below the md breakpoint (§3.1). Both are collapsible to a tab.

**One rule for the bottom edge: exactly one surface at a time.** Its three
possible occupants — filmstrip, carousel, and the draw toolbar while a funn
draft is open — are mutually exclusive, and none of them may stack. This is
the `data-chrome="bottom"` version of the rule that keeps the ribbon to thin
rows, and it exists for the same reason: the bottom edge is over the map.
Drawing yields the images, because you are not curating a gallery while the
pen is down.

#### Show: the filmstrip

Horizontal rail of thumbnails in curated order, the active one marked, its
caption under it, the opacity slider beside it. ←/→ walk it. The ground does
not move as you walk, so stepping the strip is **flipping between readings of
one rectangle in register** — which is the temporal-stack trick from Flyfoto
and the curtain's trick, applied to the images someone already decided were
worth keeping.

Nothing here writes.

#### Edit: the carousel holds what you kept

**Every card in the lokalitet carousel is an `attachments` record.** There are
no "candidate" cards — no rail entry for an image nobody has fetched. An
earlier draft of this document had the carousel enumerate everything the
rectangle could produce and let you walk it; that is the wrong shape, because
eight visualizations × two models × N LiDAR projects × M acquisitions is
hundreds of entries for a well-flown rectangle, and a rail you cannot reach
the end of is not a rail.

So the carousel is the **collection**, shown one at a time and large enough to
judge rather than as a contact sheet: caption, position in the exhibit order,
hide, delete, download. It is where images *land*; it is not where they are
chosen.

Choosing happens in four places, and it always ends in one of two gestures —
an image is kept the moment it is produced, or it is produced into a
short-lived picker where you keep or discard it.

| Route | Ground / trigger | Produces | Lands via |
|---|---|---|---|
| **The starter three** | a brand-new lokalitet, automatic | 3 LiDAR extracts | straight into the carousel |
| **LiDAR, tuned by hand** | ground 2, pick dataset/style/model, `Behold` | 1 extract | straight into the carousel |
| **Terrenganalyse** | ground 5, move the knobs, `Behold` | 1 render | straight into the carousel |
| **LiDAR-uttrekk** | row button → project × style dialog | N extracts | **picker carousel** |
| **Flyfoto** | row button → terms → acquisition dialog | N mosaics | **picker carousel** |

Plus `Skjermbilde` and `Last opp`, which are single images and land directly,
as they do today.

#### The starter three

A new lokalitet auto-sources exactly three images, all LiDAR extracts over the
rectangle, from the one source chosen for it:

`skyggerelieff` · `multiskyggerelieff` · `helning_prosent`

— from the **best** LiDAR project covering the rectangle, which is the densest
newest per-project acquisition and falls back to the national 1 m mosaic.
`bestLidarSource` in `starterPack.ts` already computes exactly this; reuse it
unchanged.

Three facts make that set the right one, and each of them constrains it:

- **All three are one service and one fetch path.** `extractCanvas` against
  `LIDAR_PROJECT_WMS_URL.dtm`, three style strings. No ArcGIS DEM, no NiB
  token, no client-side render — one upstream, three sequential runs.
- **`helning_prosent` and `multiskyggerelieff` are DTM-only**, which is
  already true of the extract tool (`sources.ts` pins the DTM URL). Consistent
  by construction.
- **The national mosaic publishes only `skyggerelieff`** (`docs/map-layers.md`;
  asking it for a per-project style answers HTTP 200 with a JSON body the
  browser renders as a broken image). So where no project covers the
  rectangle, the starter set is **one** image, not three failures. This has to
  be an explicit branch — it is precisely the silent failure the style clamp
  exists to prevent.

Three changes from today's `Hent grunnpakke`:

- It stops being a menu item and becomes what a new lokalitet does on arrival.
- **Flyfoto leaves the starter set.** It is by request only now (below), so
  creating a lokalitet no longer touches NiB at all — which also means the
  licensing notice no longer fires at the one moment the user has not asked
  for a photograph.
- **The terrain render leaves the starter set.** A terrain image is a function
  of its settings (§4.1), and handing someone a multidirectional hillshade
  nobody chose the azimuth for is the one thing `src/figure/` exists to make
  visible. It is replaced by `multiskyggerelieff`, which is Kartverket's
  pre-baked equivalent and needs no settings recorded that the WMS did not
  pick.

`starterPack.ts` therefore loses its `flyfoto` and `terrain` steps and becomes
three calls to `starterExtract` with three styles. `STARTER_VIS` and the
`terrainFigure` import go with them.

#### `Behold`: keep the ground you are looking at

One verb on the lokalitet row, and it is the general answer to "how do I add
an image": **dial the ground up on the map the way you want it, then press
`Behold`.** It produces the rectangle in that ground, at the source's native
resolution — not a screenshot of it — runs it through the provenance figure,
and puts it in the carousel.

That unifies two things this document had as separate features and the app has
as separate surfaces:

| Ground on screen | What `Behold` produces |
|---|---|
| **2 LiDAR** | `extractCanvas` at the active dataset, style and model |
| **5 Terreng** | `renderTerrain` at the current visualization and knobs |
| **4 Flyfoto** | `fetchFlyfoto` for the active acquisition (raises the notice) |
| **1 Standard, 3 Hybrid** | nothing — disabled, and the tooltip says `Skjermbilde` |

Standard and Hybrid are disabled rather than fudged. There is no
rectangle-fetch path for the topo WMS, and worse, Hybrid's overlay is a
separate layer the extract path cannot see — so a `Behold` there would hand
back a plain LiDAR hillshade labelled as the hybrid view the user was reading.
`Skjermbilde` is the honest verb for those two, and it already exists.

Terreng's existing `Behold` on the terrain settings strip is this same button;
it moves to the lokalitet row so there is one place to look, and the terrain
strip keeps only knobs.

**Load-bearing: `Behold` in DOM mode.** The LiDAR ground can be set to DOM, but
the extract tool is DTM-only, so a naive implementation silently returns
surface-model-free terrain for a view the user was reading as canopy. Two
acceptable fixes — teach `sources.ts` the model (one URL swap, and
`effectiveLidarStyle` already clamps DOM to `skyggerelieff`), or disable
`Behold` under DOM. The first is better and cheap. What is not acceptable is
the third option, which is what falls out of doing nothing.

#### Picker carousels: the transient keep-or-discard surface

`LiDAR-uttrekk` and `Flyfoto` stay on the row. Both ask a question `Behold`
cannot: *give me several of these at once, so I can compare and pick.* Both
keep their existing selection dialog — the project × style grid,
the acquisition list — and both change what happens **after** it: instead of
each result being saved, the results open a **picker carousel** in the bottom
slot, and each card is keep or discard. Close the picker and the kept ones
join the collection; the rest were never records.

The picker **borrows the bottom slot** from the lokalitet carousel rather than
being a fifth occupant of it, so the one-surface rule holds unchanged. It is
visually distinct (a header naming the run and its progress, a `Ferdig`
button) because "these are proposals" and "these are yours" must not look
alike.

- **LiDAR-uttrekk** keeps `LidarExtractPanel`'s source-and-style grid as its
  selection dialog. What it loses is the drawable sub-selection and the
  fullscreen viewer (§6).
- **Flyfoto is by request only, and the terms come first.** The licensing
  notice (`flyfotoNotice`) is deliberate product policy, not a leftover — it
  gates every NiB grab and it stays gating both the picker and `Behold` on the
  flyfoto ground. §8.8 records why.

**Enumerate everything; fetch one at a time.** The rule survives, narrowed to
where it belongs. Enumeration is cheap and happens in the dialog —
`fetchFlyfotoProjectsForBbox` and the LiDAR project list are catalogue queries
the app already makes. *Producing* is a tile burst against a shared public
edge, which is why `FLYFOTO_BATCH_MAX` is 8 and why the grunnpakke runs
sequentially (§8.9). So a picker fetches its selection **sequentially, one
card ahead of where you are standing**, each in-flight card carrying its own
spinner. That is strictly better than today's single progress line, and it
means you can start judging the first image while the fourth is still
arriving.

Keyboard in a picker, because triage speed is the entire point: ←/→ walk,
**Enter/K** keep, **Delete/X** discard, discarded cards leave the rail rather
than greying out, `Esc` ends the run and cancels what has not been fetched.

**Duplicates.** `Behold` pressed twice on unchanged settings makes two identical
records, and so does re-running a picker over ground already covered. The
`meta` block is the natural key — same source, style, model and parameters
over the same `bbox25833` is the same image. Cheap version: the button reads
`Beholdt` and does nothing while the current settings match an existing record.
Worth doing in the first build; without it a session of scrubbing a slider
leaves forty near-identical renders, and `hidden` (§4.4) is then curation
against a mess this made.

Under §4.1.2 this gets both easier and more necessary. Easier because a View
*is* its `meta`, so "same image" stops being a heuristic over a blob and
becomes record equality — the natural key is the whole record. More necessary
because keeping is now free, and forty accidental renders that used to cost
forty uploads (and so were self-limiting) now cost twelve kilobytes and
nothing else. Removing the cost removes the brake, so the guard has to be the
brake.

### 4.4 Curation is order and concealment

Show mode presupposes something to curate with, and there is nothing. Two
fields:

- **`attachments.sort`** (number) — the exhibit order, dragged in edit mode.
  Newest-first is right for an inventory and meaningless for a sequence you
  are trying to make an argument with.
- **`attachments.hidden`** (bool) — keep it, do not show it. A ditch-hunting
  session leaves eight sky-view-factor renders at eight radii; the exhibit
  wants one. Without this the only curation is delete, and deleting your
  working record to make the exhibit look tidy is a bad trade — the discarded
  seven are the evidence that you checked.

**The cover is not a field.** It is the first non-hidden image in `sort` order,
computed where it is needed — same argument as the centre coordinate, which is
deliberately not stored because it is derivable and would otherwise go stale
when "Juster området" moves the rectangle (§8.2). One less thing that can
disagree with the list.

### 4.5 The caption is prose; the meta is the machine's copy

No new field. `caption` is currently a short label (`"Multidireksjonal ·
DTM"`), and `MetaLine` already renders source, style and resolution from
`meta` separately — so the caption is free to become the sentence an exhibit
needs: *"Voldgrava er tydeligst i negativ åpenhet; her med 6 m radius."*

Three copies of the truth, each doing a different job, and this is the shape
to keep: the **record's caption** is what the author says, the **record's
meta** is what the machine can act on, and the **baked figure caption** is what
survives the file leaving the app.

### 4.6 Terreng in show mode seeds from the site's own render

Small, cheap, and it makes show mode mean something for the live tools too:
entering Terreng over a lokalitet that already has a terrain bilde starts from
**that image's settings** — its visualization, model, azimuth, altitude,
z-factor and radius — rather than the app defaults, taken from the cover
terrain render.

So pressing Terreng over someone else's site shows you *what they saw*, live
and full-size and at your own zoom, and then you move the knobs and check them.
Every field it needs is already in `meta`. Without this, arriving at a shared
site and pressing Terreng gives you a default hillshade at 315°/35° that says
nothing about why the owner thought there was something there.

---

## 5. The lokalitet row

```
┌─ row 1 ── search · [1 Kart|▾][2 LiDAR][3 Hybrid][4 Flyfoto]
│           · 🏛Kulturminner|👁 · Stedsinfo · Mål · Mine lok. · Ny lok. · konto
├─ row 2 ── settings strip for the ground on screen        (A|B when comparing)
│           — absent under Kart, whose one pulldown is the ▾ above
├─ row 3 ── terrain sliders                                  (only in Terreng)
└─ row 4 ── the lokalitet
```

### 5.1 Three zones, and each answers one question

| Zone | Question | Present when |
|---|---|---|
| **left** — identity | *what am I looking at* | always |
| **left** — the contents | *what did someone put here* | always |
| **left** — the work | *what can I do to it* | **edit only** |
| **centre** — the ground tools | *what does this ground look like* | always |
| **right** — the exits | *how do I get out of here* | always |

Left is fixed, right is a stack, the work is a list. That is the whole
grammar, and it is what makes the row readable at a glance: your eye goes left
to know where you are and right to know what to press, and the left-hand cell
is either the record and its contents (show) or those plus a list of tools
(edit). Stance is legible from ten feet away without reading a word.

**Five zones in three cells, and the cells are a CSS grid of `1fr auto 1fr`.**
The reason for a grid rather than a flex row is the middle one: `Terreng` and
`Sammenlign` sit on the row's own midpoint, so the pair holds position however
long the lokalitet's name is. A control that walks sideways as you move
between sites is a control you have to look for each time.

**Why the centre is the ground tools and everything else is on the left.**
`Terreng` and `Sammenlign` interrogate the ground — one asks the rectangle
what shape it is, the other holds two acquisitions of it side by side — and
the data answers. `Funn` and `Bilder` interrogate what a *person* put here,
and you answer; so do the write verbs, which are aimed at this record. Those
belong with the name, and they are what the left-hand cell is: the record,
what is in it, what you can put in it next — three statements about the same
lokalitet, read left to right. The ground tools are the odd group out, which
is exactly why they get the middle to themselves. The right-hand cell holds
only the ways out, which is what a right edge is for.

`Funn` and `Bilder` come *before* the write verbs inside that cell rather than
after, so the pair keeps its position when `.tools` appears and disappears
with the stance: pressing `Rediger` must not move `Funn` out from under the
pointer.

Below 48 rem the grid collapses back to a flex row, because three columns of
wrapped buttons on a phone is three columns of nothing. The cells are real
elements, so the *grouping* survives the collapse: they become flex items and
the exits are pinned right by an `auto` margin, which is the layout this row
was designed against at 390 px.

The `[←]` back arrow **goes away**. Leaving is an exit, exits are on the
right, and one lokalitet should not have two ways out sitting at opposite ends
of the same row.

### 5.2 The left zone

```
Lokalitet: Storevike  [K7M2QX]  [privat]
```

- **`Lokalitet:`** — the literal word. The row already looks different from
  row 1, but "different-looking row" is not the same as "you are inside
  something", and this is the only chrome in the app that is *scoped* to a
  record. Cheap, and it is what makes the `[←]` removal safe.
- **The name** — the row's one clickable noun, and it carries whichever verb
  the stance has for the record: **click to rename** in edit, **click to zoom
  to the rectangle** in show. Under the transaction the rename goes to the
  draft rather than to PB, which incidentally removes today's commit-on-blur.
- **`[K7M2QX]`** — the short code (§11). Click to copy. Monospace, uppercase,
  gray badge — deliberately quieter than the name and the visibility chip,
  because it is a thing you *reach for*, not a thing you read.
- **`[privat]`** — the visibility badge, unchanged (`VISIBILITY_PALETTE`).

**The `⤢` zoom button is gone**, and the name is what replaced it: a whole
control for a verb the thing beside it could say by itself. It is not lost in
edit, where the name means rename — `Zoom til lokaliteten` is the first item
in `[⋮]`, unconditionally and in both stances, so the verb keeps one place
that does not depend on which stance you are in. The name is a real `<button>`
inside the `<h2>` rather than a click handler on the heading, because the
control it replaced was keyboard-reachable and this one has to stay so.

**What leaves the left zone:** today's `ws.summary` (`3 funn · 12 ha`). The
funn count is already a badge on the funn popover and the area belongs in
Detaljer, so the summary was two facts rendered twice. Dropping it is what
pays for the code chip, and it frees the slot the banner needs (below).

For a reader the visibility badge is followed by attribution rather than a
summary: `Lokalitet: Storevike [K7M2QX] [offentlig] · Delt av Ola Nordmann`.

### 5.3 The right zone is a stack, and depth wins

The exits, from the outside in. **The deepest thing in flight owns the zone**,
and everything shallower is hidden while it is open — you cannot close a
lokalitet out from under a half-drawn funn, and the row should not offer to
let you try.

| Depth | Context | The zone reads |
|---|---|---|
| 0 | show, owner or admin | `[Rediger]` `[Del]` `[Lukk]` `[⋮]` |
| 0 | show, reader | `[Lag min kopi]` `[Del]` `[Lukk]` `[⋮]` |
| 1 | edit, idle | `[Lagre]` `[Avbryt]` `[⋮]` |
| 2 | edit + funn draft | `[Ferdig med funn]` `[Forkast funn]` |
| 2 | edit + Juster området | `[Bruk]` `[Angre]` |
| 2 | edit + a picker run | owned by the picker in the bottom slot (§4.3) |

Three things this table is saying on purpose:

- **`Del` and `Lukk` are absent in edit** (§3). A record whose current state
  exists only in your browser cannot be handed to anyone, and closing it would
  need a "you have unsaved changes" dialog — which is the same information,
  delivered worse and later.
- **Depth 2 never says `Lagre` or `Avbryt`.** Committing a shape and
  committing the session are different acts a keystroke apart, so they get
  different words. `Ferdig med funn` closes the funn *into the draft*; the
  funn is not in PocketBase until you press `Lagre` one level up.
- **`⋮` survives both stances**, holding what is not part of any loop: Zoom
  til lokaliteten, Detaljer, Juster området, Last opp, Rapportpakke, Slett.
  `Slett` stays hidden for readers.

**`Del` is buildable before sharing is designed.** Its first version is a
popover with the visibility control (which exists) and *Kopier lenke*, which
the short code makes real — `?lok=K7M2QX` needs only the URL parameter and
the deep-link boot (§10). Everything else sharing eventually grows goes in
the same popover later. Until that parameter exists the button is absent
rather than disabled; a share button that shares nothing is worse than no
share button.

### 5.4 The write verbs

```
Nytt funn  ·  Behold  ·  Hent ▾  ·  Skjermbilde
```

Four entries, and two of them do most of the work.

- **`Behold`** — keep the ground on screen, over this rectangle (§4.3). The
  general route: everything you can put on the map you can keep. Disabled
  under Standard and Hybrid, where the honest verb is `Skjermbilde`.
- **`Hent ▾`** — a two-item popover holding `LiDAR-uttrekk` and `Flyfoto`,
  the two routes that produce *several* images to pick between. They belong
  together because they are the same gesture (choose a batch, triage it in a
  picker carousel) and they are the two rarest things on the row. A popover is
  the sanctioned way to keep a row one line (§5.1 of `ui-architecture.md`).
- **`Nytt funn`** and **`Skjermbilde`** — the two acts that are not about
  acquiring imagery of the rectangle at all.

**Load-bearing: the image verb is `Behold`, not `Lagre`.** With the
transaction model the right zone owns the word `Lagre`, and having two buttons
one divider apart both saying `Lagre` — one meaning "keep this picture", the
other "commit everything" — is the kind of collision that gets found in user
testing rather than in review. `Behold` is already the app's word for exactly
this gesture (it is the extract's keep button today), it is shorter, and it is
more precise: you are keeping *this one*, out of what is on screen.

Everything else in §4.3 is unchanged; only the label moves.

### 5.5 The rows, drawn

**Show, as owner:**

```
Lokalitet: Storevike [K7M2QX] [privat] · ⛨Funn 3|👁 · Bilder ▾
                    ┊ Terreng · Sammenlign ┊ [Rediger] [Del] [Lukk] [⋮]
```

**Show, as reader:**

```
Lokalitet: Storevike [K7M2QX] [offentlig] · Delt av Ola Nordmann
  · ⛨Funn 3|👁 · Bilder ▾
                    ┊ Terreng · Sammenlign ┊ [Lag min kopi] [Del] [Lukk] [⋮]
```

**Edit, idle:**

```
Lokalitet: Storevike [K7M2QX] [privat] · ⛨Funn 3|👁 · Bilder ▾
  · Nytt funn · Behold · Hent ▾ · Skjermbilde
                    ┊ Terreng · Sammenlign ┊ [Lagre] [Avbryt] [⋮]
```

**Edit, drawing a funn:** the write verbs stay (you may still want a
screenshot of what you are drawing), the exits collapse to depth 2.

```
Lokalitet: Storevike [K7M2QX] [privat] · ⛨Funn 3|👁 · Bilder ▾
  · Nytt funn · Behold · Hent ▾ · Skjermbilde
                    ┊ Terreng · Sammenlign ┊ [Ferdig med funn] [Forkast funn]
```

The centre pair (`Terreng`, `Sammenlign` — §8) and the contents pair (`Funn`,
`Bilder ▾`) are in both stances because reading is not writing, which is the
whole argument of §2.

**`Funn` is one control with a seam in it**, written `⛨Funn 3|👁` above: press
the labelled half to open the index, press the eye to take the funn off the
map. The eye is what used to be `Skjul merker` on row 1, and it is here
because this is the button that lists exactly what it hides — the funn layer
only ever holds the open lokalitet's funn. Two segments rather than an item
inside the list, because hiding the funn is something you do *while* dragging
the Sammenlign curtain and it has to stay one press; and the count stays on
the labelled half while they are hidden, so hiding never costs you the answer
to "is there anything in this rectangle". **H** still works.

The other half of `Skjul merker` — the lokalitet rectangles — has no control
at all now. A rectangle that is not the one you have open draws faint
(`localityLayer.ts`): dashed, half-alpha, its name chip barely there. That
answers the same complaint the switch existed for, without a control to find,
and it leaves the rectangle clickable, so opening a neighbour is still a
press on it.

### 5.6 What the transaction actually costs

This is the expensive choice in the document and it deserves its bill
itemised. PocketBase has no multi-record transaction over HTTP, so "commit"
is N writes no matter what. The question is only *when* they happen.

**Everything the draft holds is small, so everything buffers.** That sentence
is only true because of §4.1.2, and it is the main thing §4.1.2 buys:

| Draft content | How | On `Avbryt` |
|---|---|---|
| name, description, place, kommune, matrikkel, visibility | buffered client-side, never written until `Lagre` | dropped, nothing to undo |
| funn: title, note, status, geometry | buffered — today's autosave is **suspended** in edit | dropped |
| curation: `sort`, `hidden` | buffered | dropped |
| `bbox` (Juster området) | buffered | dropped |
| **Views** (`Behold`, the starter three, both pickers) | buffered as **specs** — a few hundred bytes each | dropped, nothing to undo |
| **Files** (screenshot, upload) | written **eagerly**, id tracked in the draft | **deleted** |
| **deletions** of funn | deferred — a tombstone in the draft, row greyed | dropped, the record comes back |
| **deletions** of a bilde | written through on confirm (see consequence 2) | nothing left to drop |

The version of this section that this document carried until now had *every*
attachment on the eager row, and reasoned about it correctly: a session that
keeps twelve extracts cannot buffer a couple of hundred megabytes of blobs and
then attempt a multi-minute upload on `Lagre`. Splitting Views from Files
removes the premise. Twelve kept extracts are now **twelve rows of JSON, about
four kilobytes**, and the pixels are pinned by the background queue *after*
the commit returns.

So the compensating half shrinks to exactly the two kinds that are genuinely
bytes — a screenshot and an upload, both of which arrive one at a time by
deliberate act, neither of which anybody produces twelve of in a session.
**Edit is a buffered transaction with a compensating edge**, and the edge is
narrow enough to be honest about.

Five consequences, each of which needs building rather than assuming:

1. **`Avbryt` is cheap in the ordinary case and only sometimes not.** Discard a
   session of kept renders and nothing goes over the network at all. It still
   needs a confirm naming the count (*"Forkast 12 bilder og 3 funn?"*) because
   the work is real even when the rollback is free — but the progress state and
   the partial-failure report are now for the rare session that took a
   screenshot or uploaded a photograph, not for every session.
2. **Deferred deletion is a feature, not a workaround** — for funn. `Slett` on
   a funn inside edit greys it and it returns on `Avbryt`: free undo, and the
   only way to make deletion compensable without keeping the blob.

   **It did not survive contact for bilder**, and the build reversed it there
   (`docs/ui-architecture.md` §8.11). Two reasons, both about the same card.
   The confirm on `Slett bildet` says the action cannot be undone — so the
   greyed card offering `Angre sletting` was contradicting the sentence the
   user had just agreed to. And the deletion only *happened* on `Lagre`, which
   also ends the session: pruning an exhibit of twelve working renders down to
   the three worth showing meant twelve rounds of leaving edit and pressing
   `Rediger` again. So a confirmed `Slett bildet` writes through and the buffer
   forgets the record; a failed DELETE falls back to the tombstone, which is
   the only path that still greys a frame. A funn keeps the deferral because a
   funn is geometry that took ten minutes to draw, deleted from a list where
   the next row is one keystroke away.
3. **`Lagre` returns before the pixels exist**, and the interface has to be
   truthful about that without being alarming. The commit writes rows and
   closes the transaction; the pin queue then runs. A View that is not pinned
   yet is not broken — it renders on demand (§4.2) — so the right treatment is
   a quiet per-card state, not a blocking spinner, and a retry when the queue
   fails. The one place it must *not* be quiet is Rapportpakke and `Last ned`,
   which wait for the pin because their whole purpose is the bytes.
4. **The draft must survive a crash.** Today the app autosaves, so closing the
   tab mid-session loses nothing; under a transaction it loses everything.
   Persist the draft to `localStorage` keyed on the lokalitet code and offer
   to restore it on the next open. This gets *easier* under the split — specs
   fit in `localStorage`, blobs never would — but it also gets more
   load-bearing, since the draft is now the only copy of a dozen kept views.
   For an app used outdoors on a phone with a bad connection this is not a
   nicety, and it is the one part of this section I would not ship without.
5. **Realtime has to stand down while a draft is open.** The workspace's two
   PB subscriptions currently reload on every event, which would stamp on the
   buffer mid-edit. Keep the subscription, stop *applying* it, and if an event
   arrives for something the draft touches, say so at commit time
   (*"Lokaliteten er endret et annet sted"*) rather than merging. Last write
   wins is acceptable here — only owners and admins can edit, so the realistic
   conflict is you in two tabs — but a *silent* overwrite is not.

The reader's side is unaffected: realtime keeps working in show mode, so a
reader watching an owner work still sees committed funn appear (§6). What they
no longer see is the owner's half-finished ones, which is an improvement.

### 5.7 The banner slot

Where a banner is needed it **takes the slot the summary vacated** (§5.2)
rather than adding a row. One slot, at most one banner, ranked, and it answers
exactly one question: **whose is this and what state is it in.**

| # | When | Reads |
|---|---|---|
| 1 | a draft was recovered from `localStorage` | *Gjenopprettet ulagret arbeid fra 14:32* · **Forkast** |
| 2 | copy in flight | *Lager din kopi… (3 av 7 funn)* |
| 3 | `reader` | *Delt av **Ola Nordmann** — du leser* |
| 4 | `admin`, not owner | *Du redigerer **Ola Nordmanns** lokalitet som administrator* |
| 5 | owner of a copy | *Kopiert fra **Olas** Storevike* · **Åpne originalen** |

Rank 1 is new with the transaction (§5.6) and outranks everything, because a
recovered draft is the one banner that is about *unsaved work* rather than
about ownership — and it is the only one whose message expires the moment the
user acts on it.

The ordinary "you have unsaved changes" case gets **no banner**. The right
zone already reads `[Lagre] [Avbryt]`, the row is tinted, and a banner saying
what two buttons and a colour already say is the first step toward the
notification stack the next paragraph is about.

That restriction is the design of the slot, not modesty about it. A banner area
that accepts "anything worth telling the user" becomes a notification stack, a
stack grows, and a growing thing at the top of the map is how the
five-hundred-pixel bar happened the first time (§5). Everything else stays next
to the thing it is about: "tegningen går utenfor området" belongs under the pen
in the draft row, a fetch in progress belongs on the carousel card it will
become, "dra i rammen" belongs to the adjust handles.

---

## 6. The dock is gone

The 360–400 px right column goes away entirely. The lokalitet ribbon and the
bottom edge carry what it held.

The reason is the one the dock was itself the answer to, applied once more. A
column costs a fixed slice of the map's *width* for as long as a lokalitet is
open — permanently, on the one screen the whole app exists to let you look at —
and most of what it held is either better on the map (the images, §4.2) or
consulted for ten seconds at a time (the registers, the details). What is left
after those two observations does not justify a column.

### Where the four sections went

| Section | Now |
|---|---|
| **Bilder** | the bottom edge — filmstrip in show, carousel in edit (§4.3) |
| **Funn** | a popover on the row, plus the map |
| **Kulturminner** | a popover on the row |
| **Detaljer** | a dialog from the `⋮` menu |
| the tool band | see below |

**Popovers are the sanctioned escape hatch, not a workaround.** §5.1 already
says it: anything a subject needs beyond one line goes in a popover anchored to
a control on the line, the way every dataset pulldown does. A funn list of
three to twenty rows and a kulturminner readout are exactly that shape.

**Funn: the popover is the index, the map is the content.** The list already
exists and already takes `editable`; what changes is that selecting a row shows
its title and note **on the map**, next to the thing, in the callout
`KulturminnerPopup` already establishes as a pattern for this app. A note about
a mound belongs beside the mound, not in a column 400 px to the right of it.

**Funn in show mode are a tour.** ↑/↓ already move the selection and Enter
zooms (§8.4); in show mode ↑/↓ *also* zoom, so walking the list walks the site
with the note arriving as you land. Three keystrokes to show someone three
finds, and the popover need not even be open. One condition in
`useWorkspaceKeys`.

**Detaljer is a dialog** because §8.2 already identified it as the one section
you set once and stop looking at — sted, kommune, matrikkel, beskrivelse,
synlighet, and the read-only coordinates and area. A form you visit rarely is a
dialog; the fields keep their commit-on-blur behaviour. It gains the
attribution block: owner, created, last changed, and where a copy came from.

### The funn draft is the real cost, and this is the answer

Everything above is a body you open, read and dismiss. The draft is not: while
you are drawing, the tools and the metadata have to stay on screen *and* you
have to keep clicking the map. A popover closes on outside click, which is
every stroke you make. This is the one thing the dock was genuinely good at,
and removing it has to be paid for rather than waved through.

It splits in two, along a line that is arguably better than the column was:

- **The draw tools go to the bottom edge**, taking the slot the carousel yields
  (§4.3). `BottomDrawToolSelector` already exists for exactly this on mobile;
  it stops being mobile-only. Tools belong near the hand.
- **The draft's metadata becomes a thin ribbon row** under the lokalitet row,
  for as long as the draft is open: `title` input · *Utvid området* when the
  drawing escapes the rectangle · **Ferdig**. One line, no body, which is what
  the ribbon rule permits.

**The note moves out of the draft and into the funn popover.** Accepted change,
not an oversight: a textarea will not fit a ribbon row, and a note is written
after you have looked at the thing rather than while your hand is on the pen.
Autosave (§8.5) is what makes this safe — the funn is a record from the moment
its first shape closes, so there is always something to attach a note to, and
nothing is lost by writing it thirty seconds later.

### What this deletes

`src/shell/Dock.tsx`, `DockTool`, `LocalityDock.tsx`, `dockSlot.ts`,
`dockOpenAtom`, `openSectionsAtom`, the `.right` slot's dock branch and the
bottom-sheet breakpoint that came with it. `LocalityDetails` becomes a dialog
body; `FunnList` and `KulturminnerSection` become popover bodies; the
`Section` primitive may have no callers left.

Also, given §4.3: **`LidarExtractViewer` goes; `LidarExtractPanel` is
demoted.** The viewer's fullscreen preview becomes the image in the rectangle
and its PNG download becomes the card's **Last ned**, which removes the
moved-canvas-node trap and the `lidarExtractViewerOpenAtom` guard in
`useGroundMode`'s cycling. The panel stops being a dock resident and keeps
only its source-and-style grid, as the selection dialog behind `Hent →
LiDAR-uttrekk`; everything downstream of pressing go becomes the picker
carousel.

**One capability goes with it, deliberately: the extract's own drawable
sub-selection** (`useDrawSelection`, `lidarExtractSelectionAtom`). Every other
producer already covers the lokalitet's rectangle, and the filmstrip's whole
value is that **the ground does not move as you walk it** — one image covering
a hand-drawn sub-rectangle breaks register for the entire strip. So the
invariant to adopt is:

> **Every image in a lokalitet covers the lokalitet's rectangle.**

which is also what makes "Juster området" a coherent operation, and what the
Rapportpakke needs to be a document rather than a folder.

`dockSlotAtom` does not disappear so much as move: the bottom surfaces still
render through one portal from the ribbon's subtree, since
`useLocalityWorkspace` must stay mounted exactly once (§5). Same mechanism,
renamed to a bottom slot.

**Realtime already works in the reader's favour.** The workspace holds two PB
subscriptions that reload on every event, so a reader watching an owner work
sees the funn appear. Nothing to build; worth not breaking.

### The honest worry: the row is now long

Identity, four write verbs, two ground tools, `Funn` with its eye, the strip
toggle, the stance button and the menu. On a laptop it fits; on a phone the
ribbon wraps, and it will wrap to three or four lines with the settings strip
above it. The mitigations available, in order of preference: icon-only popover
buttons with count badges (already the pattern for `HeritageControl`), the
stance button collapsing into the `⋮`, `Skjermbilde` joining `Hent ▾`, and
below the md breakpoint moving the read tools into the menu too. `Lagre` is
the one that must survive every one of those cuts — it is the general route
into the collection (§4.3), and a phone that can browse LiDAR but cannot keep
what it finds is a viewer, not this app. Worth designing against a 390 px
viewport explicitly before building, because the dock's bottom-sheet fallback
was what handled small screens and it is going away.

---

## 7. What a copy carries

**The rectangle, the details, the funn, and the Views. Not the Files.**

- `bbox`, `name`, `description`, `place`, `municipality`, `matrikkel`
- every `finds` row: `title`, `note`, `status`, `geometry`
- every **View**'s `meta`, `caption`, `sort` and `hidden` — copied as
  unpinned specs, a few hundred bytes each, pinned by the same background
  queue as any other commit (§4.1.2)
- **Files** — screenshots and uploads — are left behind
- `visibility` resets to `private` — inheriting `public` would republish
  someone else's reading under your name by default
- `derivedFrom` → the original

The line lands exactly where the cost is. Copying a View costs a row; copying
a File means duplicating up to 20 MB through the client, which turns a fork of
a worked-up lokalitet into a multi-minute upload. Before §4.1.2 that argument
applied to all bilder and the copy carried none of them, on the grounds that
extracts and renders are re-derivable and the starter three (§4.3) arrive on
their own anyway. That was true but lossy: the original author's *choices* —
which acquisition, which azimuth, which style at which resolution over which
sub-rectangle — were the reading being shared, and regenerating a default
starter set does not reproduce them. The split lets the copy carry the
choices and leave only the bytes behind, which is what was wanted all along.

For the Files, the parent link is the answer rather than a duplicate: the copy
shows them, greyed and marked as the original's, sourced through `derivedFrom`
and readable exactly when the original is (§1's read rules already do this —
a public lokalitet's attachments are readable by any signed-in user). One
button per card, **Ta med**, copies that single file into the copy when
someone actually wants it. Elective, per image, paid for by whoever asked.

The consequence to accept: those Files stop resolving if the original is
deleted or turned private. `derivedFrom` is `cascadeDelete: false`, so the
copy survives — but a greyed card whose parent went away should say so
(*"Bildet er ikke lenger tilgjengelig"*) rather than showing a broken thumb.
That is a real gap, and the right one to accept: it applies only to
screenshots and uploads, and only to ones the copier never claimed.

The copy dialog says it: *"Funn, område og bilder du kan gjenskape følger med.
Opplastede bilder og skjermbilder blir liggende hos originalen."*

The copy **keeps the original's name** — same argument as §8.3's auto-naming, a
good name is worth keeping and should not have `(kopi)` stapled to it. That it
is a copy is a fact the record carries in `derivedFrom`, so the Lokaliteter
panel shows a chip rather than putting it in the string.

### Load-bearing: the copy must not throw the DEM away

The likeliest path in the whole design is: open a shared site → Terreng →
better azimuth → Lagre → *yes, copy*. The copy's bbox is **identical**, so if
`useTerrainAnalysis` keys its DEM on the rectangle rather than on the record
id, that sequence costs one PocketBase write and no megabytes. Key it on the id
and the render the user just tuned blinks away and re-downloads.

That single detail decides whether copy-on-write feels like a click or a wait.

---

## 8. Terreng and Sammenlign move onto the row

Both stop being top-level tools. The argument is not real estate: neither
answers a question you can ask of the map in general — Terreng needs a
rectangle to download, and Sammenlign is for holding two readings of *one
place* in register.

They are **read tools**, so they are on the row in **both** stances and
available to readers in full. Only their exits write, and those escalate (§2).

### Terreng stays a ground; only its button moves

`GROUND_MODES` keeps five entries, digit `5` still selects it, the settings
strip still renders from `RibbonGlobalRow`,
`useTerrainAnalysis` is still mounted once and unconditionally, and the memo
split is untouched. What moves is the **`ModeButton`**, into the lokalitet row.
The ring is a fact about digits and W/S, not about DOM order, and `GROUND_KEYS`
is positional against the array.

**Pressing Terreng (or `5`) with no lokalitet open creates one** — signed in,
`createLocalityFromViewport()` over the inset viewport, then enter Terreng in it
in **edit** stance; signed out, `AuthDialog`. `useGroundMode` takes the create
callback in the argument slot `viewport` occupies today.

This is the part that pays for itself. It **deletes** the second entrance
rather than moving it:

| Gone | Why it existed |
|---|---|
| `terrainStandaloneBboxAtom` | the row-1 rectangle |
| `src/terrain/useTerrainViewport.ts` | framing it |
| "Flytt analysen hit" + `localities.terrain.reframe` ×3 locales | re-framing a rectangle that no longer floats free |
| the no-lokalitet branch of Lagre in `useTerrainAnalysis` | create-on-save, now create-on-enter |
| the two-entrance resolution in `useGroundMode` | there is one rectangle |

**The cost, stated plainly:** a signed-out visitor can no longer compute relief
at all. CLAUDE.md's *"reading the ground is not an act of ownership"* has to be
rewritten rather than quietly left standing, and §2 above is where the
principle goes to live instead.

### Sammenlign moves verbatim

`CompareControl` renders on the lokalitet row. The A|B switch stays on the
settings strip (§5.8), `C` stays global and is already a no-op with the curtain
down, Terreng-disabled-on-B stays.

One thing to add: **closing the lokalitet must tear the curtain down**
(`compareOnAtom = false`). Its only control leaves with the row, and a curtain
with no way to close it is a bar that has silently doubled the map's request
budget. Follows the existing "entered and left, not persistent" rule.

---

## 9. The takeout — a sketch

Not to be built yet, but show mode is shaped by where it is going, so the
target belongs on the record.

**The bundle is nearly free already**, and that is the argument for doing the
curation work first. Every image is a figure with its provenance baked into the
pixels; every funn is already a GeoJSON `FeatureCollection` in EPSG:4326; every
register fact is already a field. The export is a zip of things that exist plus
a manifest. **Order and concealment (§4.4) are the actual prerequisite, not the
export code.**

One thing it is no longer free of, under §4.1.2: **the bundle must pin every
unpinned View before it zips.** A Rapportpakke of parameter rows is not a
report. In the ordinary case the pin queue ran at commit and there is nothing
to do, but the export cannot assume that — it is the last honest moment, so it
renders what is missing, with a progress state, and refuses to produce a
partial zip silently. That is also the answer to *why pin at all* in one
sentence: **this is what the pixels were for.**

```
storevike-2026-09-11.zip
  index.html / README.txt   name · sted · kommune · matrikkel · bbox ·
                            centre · area · owner · date ·
                            attribution and licence for every source used
  bilder/01-flyfoto-1937.png   every non-hidden bilde, in curated order,
  bilder/02-negativ-apenhet.png   as its figure PNG — caption already baked in
  funn/funn.geojson         the FeatureCollection, with title/note/status
  funn/funn.csv             the same as a table, for people who don't do GIS
```

**Name it `Rapportpakke`, not `pakke`.** "Grunnpakke" is the word already in
the codebase for the three-image starter set — and although §4.3 takes it off
the menu and makes it automatic, `runStarterPack` and the strings stay, so
two unrelated "pakke" verbs is a collision worth avoiding before either is
built.

The `index.html` matters more than it looks: a bundle whose front page is a
plain-language summary with the images inline is a thing a
kulturminneforvaltning can open, and a folder of PNGs is not.

---

## 10. Sharing — deferred, but one fact to carry

Being fleshed out later. The one fact the rest of this depends on: **the open
lokalitet is not in the URL at all** (`ui-architecture.md` §4.3 flags it). So
today "shared" only means "appears in your Lokaliteter list", and nothing here
can be linked to.

Whenever it lands it will need a `lok` URL parameter, a deep-link boot that
fits the map to the bbox, and a sign-in wall (the read rules require auth even
for `public`). **A link must open in `show`, regardless of who follows it** —
that is the whole reason §2's invariant is a rule rather than a habit.

**The short code (§11) is most of that work already done.** `?lok=K7M2QX` is
the parameter, `/l/K7M2QX` is the short URL, and neither needs a redirect
table: the code *is* the key, so the "short URL" is a route on the app's own
Caddy rather than a service. That is why the code is worth a migration now,
before sharing is designed — it is the piece the rest hangs off, and
retrofitting it onto records people have already cited is worse than adding
it early.

Until then `limited` stays a placeholder behaving as `private`, and the copy is
the collaboration story: share read-only, and a collaborator forks.

---

## 11. Schema

One migration, `pocketbase/pb_migrations/1700000500_locality_view.js`:

| Collection | Field | Why |
|---|---|---|
| `localities` | `code` (text, **unique index**, required) | the short code on the row (§5.2) and the share slug (§10) |
| `attachments` | `sort` (number, default 0) | exhibit order (§4.4) |
| `attachments` | `hidden` (bool, default false) | keep working renders out of the exhibit (§4.4) |
| `attachments` | `file` → **not required** | a View is a spec before it is pixels (§4.1.2); this one-word change is the entire schema cost of the View/File split |
| `localities` | `derivedFrom` (relation → localities, optional, **`cascadeDelete: false`**) | deleting an original must not delete the forks; that is the point of a fork |
| `localities` | `derivedFromLabel` (text, optional) | the original's name and owner, denormalized at copy time — attribution that vanishes when the original is deleted is not attribution, and the same argument already put `owner` on `finds` |

No rule changes: a copy is an ordinary create by its owner, and the existing
create rule covers it. Known and accepted: nothing server-side stops a client
writing a `derivedFrom` it invented. For an amateur tool that is not worth a
hook.

**No `spec` field, and no `isView` field.** Both were tempting and both are
redundant: `meta` already holds every parameter a View needs, because the
figure caption needs to print the same set, and the category is a function of
`kind` (§4.1.1). The only thing that changes is that `file` may now be empty,
which is why the split costs one line of migration rather than a new
collection. `meta.renderedAt` — the timestamp a pin's pixels were made — goes
inside `meta` for the same reason: it is provenance, and provenance already
has a home.

### The short code

Six characters of **Crockford base32** — `0123456789ABCDEFGHJKMNPQRSTVWXYZ`,
which drops `I`, `L`, `O` and `U` precisely so a code can be read down a phone
without spelling it. 32⁶ ≈ 1.07 billion, so collisions are not a practical
concern at this scale; the unique index is there to make that a fact rather
than a hope.

- **Generated client-side at create, retried on conflict.** PB answers a
  unique-index violation with a 400; generate again and re-`create`. Two
  attempts covers any realistic corpus and it needs no Go hook, no JS event
  handler and nothing added to the pinned image.
- **Displayed uppercase, matched case-insensitively.** People will type it
  lowercase off a note.
- **Not derived from the id, the name or the bbox.** A code you can compute
  from the record is a code that changes when the record does, and this one
  has to survive a rename and a `Juster området` — it is what a report to
  Riksantikvaren cites.
- **Backfill is required**, since the field is non-optional and existing rows
  have none. The migration generates one per existing lokalitet in its `up`.
  That is the one thing in this file that must be written carefully, because
  a migration that half-applies leaves rows the unique index will not accept
  later.

Why not `locality.id`: PB's 15-char ids are already unique and already
address the record, but they are unreadable aloud, unmemorable, and too long
for the row without truncating — and a truncated id is one you cannot paste
back, which defeats the point of putting it there.

The `meta` gaps in §4.1 need **no** migration — `meta` is free-form JSON.
Old records simply lack the fields and degrade to overlay-only, which is the
correct behaviour and needs a `null` check rather than a backfill.

Remember the deploy gotcha: `docker compose restart pocketbase` after adding
the file, or every call against the new fields 404s and the SPA looks broken
(CLAUDE.md, Deploy).

---

## 12. Build order

Each step ships on its own with the dock still standing, right up until the
step that removes it. Three sequencing rules produced this order, and they are
worth more than the list:

- **Only one thing here is genuinely irreversible** — the `meta` gaps, because
  a record saved without them can never reconstruct itself. Everything else
  can be backfilled or rebuilt, so "do it early" has to be argued from
  unblocking, not from urgency.
- **Schema goes in one migration, applied once, early.** Fields may sit unused
  for six steps; that is free.
- **A surface that will be deleted is not a surface to build machinery
  against.** This is what moves the transaction to the end.

1. **The `meta` gaps** (§4.1) — flyfoto project id, LiDAR extract model,
   screenshot ground state. No migration, `meta` is free-form JSON. First, and
   alone in being urgent: every day it waits is another day of records that
   can never restore themselves. Under §4.1.2 this stops being a restore
   nicety and becomes **the record's integrity** — a View whose `meta` is
   incomplete is not a degraded record, it is a record that cannot be drawn.
   The screenshot half is the exception and drops to ordinary priority, since
   a screenshot is a File and its ground state is for the caption (§4.1.1).
2. **The starter three** (§4.3) — reshape `starterPack.ts` to
   `skyggerelieff` / `multiskyggerelieff` / `helning_prosent` with the
   national-mosaic branch, drop the flyfoto and terrain steps. Pure change to
   one module, no new UI, and it can ship behind today's `Hent grunnpakke`
   menu item before the carousel exists. Early because it is the cheapest
   visible improvement in the document and it stops the NiB licensing notice
   firing at people who never asked for a photograph.
3. **The migration** (§11) — `1700000500_locality_view.js` with **every field
   at once**: `code`, `sort`, `hidden`, `derivedFrom`, `derivedFromLabel`, and
   `attachments.file` relaxed to optional, plus the code backfill. Ship the
   code chip on the row with it; the rest wait for steps 8, 10 and 14. See the
   warning below.
4. **`access` / `canEdit`** — replace `isMine` (~50 lines, six files), give
   admins the verbs the server already grants them. No visible change for
   owners.
5. **The image on the map** — generalise `terrainOverlayLayer` to paint any
   attachment at its `bbox25833`/`imageRect`, plus the opacity slider and
   `Gjenskap`. Ships inside the existing Bilder section and **deletes the
   lightbox** on its own. Needs the zIndex arbiter (below). Build `Gjenskap`
   as the primitive it turns out to be (§4.2) — *given a `meta`, produce the
   view* — because steps 10 and 14 are both written on it. Every attachment
   still has a file at this point, so it can be verified against one: the
   render and the stored pixels should agree.
6. **The three zones** (§5.1–5.4) — the row split, the left zone's new shape,
   `Rediger` / `Lag min kopi`, Terreng seeding from the cover render (§4.6).
   **Depth 0 and 1 only**: the exits read `Ferdig`, not `Lagre`/`Avbryt`, and
   the depth-2 stack waits for step 11. Images stay in the dock. **Design
   against 390 px here** — this is the step that creates the width problem
   §6 worries about, not the one that removes the dock.
7. **The bottom slot and the filmstrip** — the portal, `data-chrome="bottom"`,
   the one-occupant rule, show mode's rail. Bilder leaves the dock.
8. **Curation** — `sort` + `hidden` (fields already there from step 3), drag
   order, the derived cover. Cheap now, and the next step is much less useful
   without it.
9. **The edit carousel and `Behold`** — the kept-cards rail in the bottom
   slot, the `Behold` button and its four-ground table, the DOM fix in
   `sources.ts`, the duplicate guard. Terreng's `Lagre` moves off the terrain
   strip and becomes this. Step 2 already did the starter set; this is where
   it stops being a menu item and becomes what a new lokalitet does. Still
   writing files at this point — one thing at a time.
10. **The View/File split** (§4.1.1, §4.1.2) — `Behold` and the starter set
    write **specs**, the card renders an unpinned View through step 5's
    `Gjenskap`, and the pin queue materialises after commit. Three sub-parts,
    and the middle one is the whole job: the writer, **the renderer**, the
    pinner. It goes after step 9 rather than before because it is a change to
    *how* `Behold` writes, and `Behold` has to exist to be changed; it goes
    before step 11 because the picker produces specs by the dozen and is the
    step that would hurt most under the old cost model. `Last ned` and
    Rapportpakke force a pin; `renderedAt` lands here.
11. **The picker carousel** — the transient keep/discard surface and its
    sequential fetch, wired to both `LiDAR-uttrekk` and `Flyfoto` behind
    `Hent ▾`, keeping the flyfoto notice gate. Deletes `LidarExtractViewer`,
    demotes `LidarExtractPanel` to a selection dialog, drops the extract
    sub-selection and adopts *every image covers the rectangle* (§6). Free
    keeps, thanks to step 10 — which is what makes a keep/discard rail a
    reasonable thing to put in front of someone.
12. **Remove the dock** — the funn popover and its map callout, the
    kulturminner popover, the Detaljer dialog, the draft metadata row, the
    draw toolbar promoted off mobile. **Depth 2 arrives here**
    (`Ferdig med funn` / `Forkast funn`), because this is where the funn
    draft's own controls leave the dock and stop competing with the row's.
13. **The transaction** (§5.6) — the draft buffer, suspended autosave,
    deferred deletion, buffered Views and compensated Files, `localStorage`
    recovery, realtime standing down. `Ferdig` becomes `Lagre` / `Avbryt`.
    **Last of the substantial steps, and see below for why.**
14. **The copy** — `derivedFrom`, the copy dialog, `Lag min kopi`, the View
    specs carried and the Files linked back with `Ta med` (§7).
15. **Move Terreng and Sammenlign**, delete the standalone terrain entrance.
16. Later: sharing and `Del` (§10), then the Rapportpakke (§9).

### Why the transaction is last, not sixth

An earlier version of this list had it at step 6, on the argument that the
highest-risk change should land on a row that is already the right shape. That
argument is right about the row and wrong about everything else the
transaction touches.

The draft's *shape* is the union of everything edit can change, and five later
steps change that set: curation adds `sort`/`hidden` to it (8), the carousel
and picker replace every surface that creates an attachment (9, 11), the
View/File split changes what those surfaces *write* and therefore which half
of the draft they land in (10), and dock removal moves the funn draft — and
therefore `useFunnAutosave`'s suspension point — to a different component
(12). Build the transaction at 6 and it gets revised at 8, 9, 10, 11 and 12,
each time against surfaces that are on their way out.

Step 10 is the sharpest case, because it is the one that would have been
missed. A transaction built at step 6 would have been built as the
compensating design this document carried until §4.1.2 existed — eager writes,
network rollback, partial-failure reporting — and step 10 deletes most of that
machinery rather than adding to it. Writing the expensive version and then
throwing it away is the specific waste this ordering avoids.

The reverse retrofit is much cheaper, and that asymmetry is the whole
argument: every one of those surfaces writes immediately whether or not a
transaction exists, so making them transaction-aware later is one "put this in
the draft" call per site, not a redesign.

What it costs to wait: the exits read `Ferdig` from step 6 to step 13, and the
app keeps autosaving until then. Both are fine — `Ferdig` over autosave is a
coherent design on its own, and it is what this document proposed before the
transaction was chosen. Users get one behaviour change at one moment rather
than a half-built one for six steps.

### Two traps worth writing down

**The migration file cannot be topped up later.** PocketBase records applied
migrations in `_migrations` and will not re-run a file whose name it has
already seen (CLAUDE.md). So adding `sort` and `hidden` to
`1700000500_locality_view.js` at step 8, after step 3 applied it, does
nothing at all — the fields never appear, and the failure is a silent 404 on
the field rather than an error. Same for relaxing `attachments.file` at step
10. Either ship every field at step 3, which is what the list says, or accept
several migration files with a `docker compose restart pocketbase` each. One
file is better.

**Step 5 needs an owner for `zIndex: 1`.** `terrainOverlayLayer` uses it
(`Z_INDEX = 1`), and a pinned attachment wants the same slot — nothing else
in the app is near it (the lokalitet rectangle is 4, funn highlight 4.5, funn
5, adjust handles 8), so the collision is exactly two-way and exactly the one
§4.2 describes. But Terreng stays on row 1 until step 15, so for ten steps a
terrain render and a pinned image can both be live over the same rectangle.
Decide the arbiter in step 5 and state it: **pinning an image stands the
terrain render down, and entering Terreng unpins the image.** Whichever way it
goes, it must be one rule in one place rather than two layers racing.

Docs to update: `docs/ui-architecture.md` §3.1 (the shell loses a slot), §5.1
(both tables), §5.3, §5.8, §8.1, **§8.2 deleted**, §8.7, §8.8, §8.9, §10, §15;
`docs/terrain-analysis.md`; and CLAUDE.md's Terrenganalyse paragraph.

---

## 13. Open, deliberately

- **Whether a picker run inside an aborted session should really be undone.**
  Consistent with §5.6, and it is also throwing away eight images somebody
  waited a minute for because they then changed the lokalitet's name and
  thought better of it. Less painful under §4.1.2 — what is lost is the
  choosing, not the bytes, and the fetch is warm in wmscache — but the minute
  spent choosing was the expensive part. Decide by watching someone use it.
- **What `Avbryt` does when a compensating delete fails.** Now only reachable
  for screenshots and uploads (§5.6), which makes it rare rather than solved.
  The record is then neither the state you started in nor the one you were
  building. Reporting it honestly is the floor.
- **How long a pin should be trusted, and what to do when it is not.** A
  pinned View records `renderedAt`; the upstream it came from can be re-flown
  or re-processed years later. Re-rendering to compare is cheap and would let
  the app *say* the source has moved — which is real provenance value and also
  a background job asking to be built, per lokalitet, forever. The floor is
  showing `renderedAt` and letting a person press `Gjenskap`. Anything above
  that floor is a maintenance commitment, and it should be entered
  deliberately or not at all.
- **Whether `Rediger` should be sticky per lokalitet.** Someone doing a long
  survey opens the same site nine times and presses Rediger nine times. Against
  it: §3 says stance is per session precisely so that opening a site is always
  the same act, and a remembered stance means a link and a list entry lead to
  different places.
- **Should a funn be able to cite a bilde?** *"This mound — see image 3."* It
  is the join the exhibit really wants, and it is the obvious next schema
  field. Left out of the first build because a curated order plus a caption
  gets most of the way there, and a relation invites a whole UI for managing
  it.
- **Groups.** `limited` is still a placeholder. A fork with attribution is
  arguably a better model for "two amateurs reading the same hillside" than a
  shared mutable record anyway.
- **A copy does not track the original.** No merge, no notification. Correct
  for now; the alternative is version control, which this is not.
- **Whether a copy should show the original's funn as a dimmed underlay.**
  Tempting — it is the comparison the fork exists for — and almost certainly
  too clever for a first build.
- **Whether the funn list should be a left-slot card rather than a popover.**
  The left slot exists and already holds search results and Mine lokaliteter,
  and a card there is dismissible in a way a column was not. Against it: it is
  a dock by another name and on the side the map is usually being read from.
  Worth a prototype before committing to the popover.
- **Whether `Lagre` on the Flyfoto ground is a trap.** It is the consistent
  rule — keep the ground you are looking at — but it is also the one ground
  whose ring is a *list of the very things the picker exists to batch*, so a
  user may reasonably read `Lagre` as "keep all of these". Alternative:
  disable it under Flyfoto and let `Hent → Flyfoto` be the only route, at the
  cost of the rule no longer being general. Decide by trying it.
- **Whether the starter three should be settable.** Three styles from the best
  project is a good default and a per-user preference is a settings screen
  this app does not have. But a user who reads slope maps first will re-derive
  the same three images on every new lokalitet, and the fetch is not free for
  the upstream either.
- **What happens to the starter three when "Juster området" moves the
  rectangle.** Every image in a lokalitet covers the lokalitet's rectangle
  (§6), so after a resize none of them do. `Gjenskap` (§4.2) is the manual
  answer and the invariant is really "covers the rectangle it was made
  against" — but the carousel should at least *say* which cards are stale, and
  the honest fix might be re-running the starter three on resize.
- **Whether a picker should be able to run in the background.** A ten-image
  flyfoto stack is a minute of sequential fetching, and holding the bottom
  slot hostage for it means you cannot do anything else meanwhile. Against:
  a background fetch that lands images without you looking at them is exactly
  the thing the keep/discard gesture exists to prevent.
