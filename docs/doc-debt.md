# Doc debt — a brief for cleaning out stale assumptions

This file is a **work order, not a reference**. It exists so an agent arriving
with no memory of how these docs got this way can make the pass without
destroying the parts that look like debt and aren't. When the worklist below is
empty, delete this file and the pointer to it in `CLAUDE.md`.

## What the debt actually is

Not dead symbol references. Those are rare and mostly deliberate. The debt in
this repo has one dominant shape:

> **Layered narration.** A decision gets written up. It is later reversed. The
> reversal is *appended* to the paragraph that stated the old rule — "…and that
> half is reversed", "it used to be X; now it is Y" — instead of replacing it.
> Do that three times to one paragraph and the live description of the feature
> is buried inside its own changelog, and a reader who stops at the first
> sentence gets the opposite of the truth.

Two of those layers had already drifted into flat contradiction before anyone
noticed, both in `docs/ui-architecture.md` and both fixed on the way to writing
this file:

- §8.7.1 said "the cursor and the map are independent" while §8.7.2, three
  pages later, said the rail shows what it points at. The first had been false
  since `7e87778`.
- §8.1 said "three of the four groups wear `LayerGroup`". All four do; the
  sentence was written when the fourth was still being built.
- §15's pin-mechanism entry justified deleting the fold/unfold restore with
  "walking the rail stopped moving what is on the map" — true for one release,
  reversed by `7e87778` / `d559c5a`.

That is the failure mode to hunt. A doc sentence is wrong here far more often
because it is *one revision behind* than because it names something that never
existed.

## The rule the pass enforces

Stated in `CLAUDE.md` under conventions, repeated here because it is the whole
point of the pass:

> Prose states what the code does **now**. A reversal rewrites the paragraph
> that stated the old rule. The *record* of the reversal goes in the one place
> that exists for it.

## What must not be touched

There are three places where "this used to be different" is the content, not
the debt. A cleaner that greps for historical language and deletes it will
destroy all three.

1. **`docs/ui-architecture.md` §15 — removed upstream machinery.** Every entry
   names deleted symbols on purpose, and closes with a "do not re-add this,
   here is what it cost" clause. `LocalityDock`, `dockOpenAtom`,
   `groundOverlayOwner`, `groundShownAtom`, `canPinBilde`, `usePinnedBilde`,
   `RecreateButton`, `pinnedFailed`, `hideGroundOverlay`,
   `terrainStandaloneBboxAtom`, `useTerrainViewport`, `drawLayer` — all
   correctly absent from `src/`. **Keep every one.** What §15 *can* have wrong
   is the surrounding argument, as the third bullet above shows: check the
   reasoning against today's code, leave the inventory alone.
2. **`docs/lokalitet-view.md` §12 and §13.10 — the build orders.** These are
   numbered plans that have been executed. A step describing what it replaced
   is the design argument for the step, which is what the doc owns (`CLAUDE.md`
   says so: lokalitet-view holds the *why*, ui-architecture holds what the code
   does now). Do not rewrite these into present tense. Do fix a step that
   claims an outcome the code no longer has.
3. **`docs/ui-architecture.md` §12 and §14** — the kvib migration and the
   inherited rough edges. Both are retrospectives by construction.

Everything else is live description and answers to the present tense.

## The test

For each hit: **can a reader act on this sentence today, and would acting on it
be correct?**

- Live description, still true → leave it.
- Live description, false or superseded → rewrite in the present tense. If the
  reversal is load-bearing (someone will otherwise re-add the thing), move one
  sentence of it into §15 or into the relevant build step, and cite that from
  the rewritten paragraph.
- Deliberate record (the three above) → leave the inventory, verify the
  argument.

## Worklist, ranked

Counts are hits for history-narration phrasing (`used to`, `no longer`, `that
half is reversed`, `formerly`, `the old`, `deleted`, `replaced by`, …), by
nearest heading. Regenerate with the census script below. **A high count is not
by itself a defect** — §15 and the build orders score high correctly. The rank
is where to *look*, in order.

`docs/ui-architecture.md` (131 hits total — the main body of the work):

| Hits | Section | Note |
| --- | --- | --- |
| 12 | §8.7.2 The bottom edge — one rail, two stances | Most-revised surface in the repo; the rail's relationship to the map reversed twice |
| 10 | §10 Analysis panels | Terreng's entrance moved; check every "standalone" claim |
| 8 | §8.7.1 The image on the map | Already corrected once; re-read the whole section, not just the fixed line |
| 7 | §8.11 The edit transaction | |
| 6 | §8.1 Anatomy | Already corrected once |
| 6 | §10.1 `[Visning ▾]` / `[Bilde ▾]` | Newest text in the doc; likely the *least* stale despite the count |
| 5 | §12 kvib migration | Retrospective — verify, don't rewrite |
| 5 | §15 Removed machinery | Inventory is correct; check the arguments |
| 4 | §7.1 Feature info | |
| 4 | §8.6 How a lokalitet and its funn draw | |
| 4 | §8.7.4 View/File split and the pin queue | |
| 4 | §9.3 Tegning mode | |

`docs/lokalitet-view.md` (45 hits): §13.10 build order (14), §14 (5), the
starter three (3), §5.6 (3), §12 build order (3). Mostly legitimate — this doc
is the design argument. Its one real risk is a step that claims an outcome the
code has since walked back.

`CLAUDE.md` (9 hits): Terrenganalyse (4), Lokaliteter (3). The Terrenganalyse
reversal paragraph ("reading the ground is not an act of ownership") is a
*deliberate* record of a policy change and should stay; verify the rest.

`docs/terrain-analysis.md` (5), `docs/analysis-roadmap.md` (3),
`docs/map-layers.md` (2) — small, check them last.

## Grandfathered conventions

Rules that are stated as conventions but may no longer be true, or were never
true. The exemplar has been fixed; the rest are candidates to confirm or drop.

- ~~"The `Co-Authored-By` trailer is added by the commit workflow."~~ **False.**
  It is written by hand on every commit. Fixed in `CLAUDE.md`. This is the
  shape of the problem: a convention nobody re-read, quietly wrong for as long
  as anyone can remember.
- `CLAUDE.md`'s "What is already built" list is a summary of six other docs and
  drifts by construction. Each bullet ends in a section citation — spot-check
  that the cited section still says what the bullet claims.
- The companion-doc bullets describe what each doc *owns*. The
  `docs/lokalitet-view.md` bullet was 128 lines of re-narrated design before
  this pass and is now 42; check the others for the same creep.
- "Feature scope is deliberately narrow" and the de-branding rule are both live
  and both worth keeping — do not treat them as debt.
- The `limited` visibility placeholder has behaved as `private` since the first
  migration. Still true, still a placeholder; leave it, but confirm no doc
  promises it does something.

## Checks available, and what each is worth

There is **no typecheck and no build** on this workstation (`CLAUDE.md`,
Deploy). Four things run:

**1. oxlint.** `npx oxlint@1.83.0 <paths>`. Over `src` it reports 50
pre-existing findings (42 errors, 8 warnings): 25 `react(refs)`, 15
`react(set-state-in-effect)`, 2 `react(immutability)`, 8
`react(only-export-components)`. Scope it to the files you touch, and name
pre-existing findings as pre-existing rather than claiming "clean".

**2. Symbol existence — high false-positive rate, read the §15 warning first.**
89 of 930 distinct backticked identifiers in the docs are absent from the tree.
Almost all are correct: deleted machinery named as deleted, DOM APIs
(`classList`, `pushState`, `replaceChildren`), OpenLayers internals
(`handleWheelZoom_`), Material Symbol names (`filter_hdr`), WMS layer names
(`Losmasser_temakart_sammenstilt`), GeoTIFF tags (`ModelPixelScale`), Python
libraries in the roadmap (`rasterio`, `samgeo`). Useful only as a list to read
by hand.

```python
# $CLAUDE_JOB_DIR/tmp/symbols.py
import re, pathlib, subprocess
ident = re.compile(r"`([A-Za-z_$][A-Za-z0-9_$]*)`")
docs = list(pathlib.Path("docs").glob("*.md")) + [pathlib.Path("CLAUDE.md")]
hits = {}
for d in docs:
    for i, l in enumerate(d.read_text().splitlines(), 1):
        for m in ident.finditer(l):
            n = m.group(1)
            if len(n) < 4 or not re.search(r"[a-z]", n): continue
            hits.setdefault(n, []).append(f"{d}:{i}")
src = subprocess.run(["grep", "-rhoE", r"[A-Za-z_$][A-Za-z0-9_$]*", "src",
                      "pocketbase", "nginx", "nib-proxy", "Caddyfile",
                      "docker-compose.yml"], capture_output=True, text=True).stdout
present = set(src.split())
for k in sorted(k for k in hits if k not in present):
    print(f"  {k:32s} {hits[k][0]}  ({len(hits[k])}x)")
```

**3. i18n unused keys — clean.** 653 keys in `src/locales/nb/translation.json`,
**0 genuinely unused**. Two classes of false positive have to be handled or the
script reports dozens: keys reached through a template literal
(`` t(`ribbon.lidar.${x}`) `` — 29 such prefixes in `src/`), and i18next plural
suffixes (`_one` / `_other`, 22 keys — the base key is what appears in the
source). The script below handles the first and leaves the second visible; if
its output is exactly the 22 `_one`/`_other` pairs, the locales are clean.

```python
# $CLAUDE_JOB_DIR/tmp/i18n.py
import json, re, pathlib
keys = []
def walk(o, p=""):
    for k, v in o.items():
        q = f"{p}{k}"
        walk(v, q + ".") if isinstance(v, dict) else keys.append(q)
walk(json.load(open("src/locales/nb/translation.json")))
blob = "\n".join(p.read_text() for p in pathlib.Path("src").rglob("*.ts*"))
lits = set(re.findall(r"""['"`]([A-Za-z0-9_.-]+)['"`]""", blob))
prefixes = {m for m in re.findall(r"""`([A-Za-z0-9_.-]*)\$\{""", blob) if m}
for k in keys:
    if k not in lits and not any(k.startswith(p) for p in prefixes): print("  ", k)
```

Parity between the three locale files is a separate check and worth running
after any string change:

```bash
for l in nb nn en; do python3 -c "
import json;d=json.load(open('src/locales/$l/translation.json'))
def w(o,p=''):
  for k,v in o.items():
    yield from w(v,p+k+'.') if isinstance(v,dict) else iter([p+k])
print('$l', len(list(w(d))))"; done
```

**4. The census** that produced the worklist above. It scans this file too,
which quotes every phrase it hunts for — ignore its own row.

```python
# $CLAUDE_JOB_DIR/tmp/census.py
import re, pathlib
PAT = re.compile(r"\b(used to|no longer|that half is reversed|is reversed|"
                 r"reverses|formerly|previously|the old |once was|was once|"
                 r"earlier rule|deleted|replaced by|instead of the|has moved|"
                 r"now [a-z]+s? rather than|rather than the old|used to be)\b", re.I)
for f in ["CLAUDE.md"] + sorted(str(p) for p in pathlib.Path("docs").glob("*.md")):
    lines = pathlib.Path(f).read_text().splitlines()
    head, counts = "(top)", {}
    for i, l in enumerate(lines, 1):
        if l.startswith("#"): head = l.strip("# ").strip()[:60]
        if PAT.search(l): counts.setdefault(head, []).append(i)
    if counts:
        print(f"== {f} ({sum(len(v) for v in counts.values())} hits)")
        for h, v in sorted(counts.items(), key=lambda kv: -len(kv[1]))[:12]:
            print(f"   {len(v):3d}  {h}   {v[:6]}")
```

Temp files belong in `$CLAUDE_JOB_DIR/tmp`, not `/tmp`.

## Ground truth, when a doc and the code disagree

The code wins, and `docs/ui-architecture.md` is the record where two docs
disagree (`CLAUDE.md` says so explicitly for lokalitet-view). Load-bearing
source of truth for the surfaces most of the worklist touches:

- the layer row: `src/shell/LayerGroup.tsx`, `VisningControl.tsx`,
  `BildeControl.tsx`, `src/map/groundOverlay.ts`
- the rail: `src/localities/useLocalityWorkspace.ts` (`selectBilde`,
  `stripNavigable`)
- the keyboard: `src/map/useBackgroundCyclingKeys.ts` (the listener),
  `src/shell/useGroundMode.ts` (the routing), `src/shell/visningRing.ts` and
  `src/localities/bilderRing.ts` (the two rings a lokalitet takes off the
  ground)
- specs vs files: `src/localities/pinQueue.ts`, `src/api/attachments.ts`
- the schema: `pocketbase/pb_migrations/` — read the migrations, not the prose

## Constraints on the pass

All of `CLAUDE.md`'s conventions apply. The four that bite a docs pass:

- Do not run `npm install` / `tsc` / `npm run build` / `docker compose …`.
  Nothing here needs them.
- Any user-visible string touched needs all three of
  `src/locales/{nb,nn,en}/translation.json`.
- Migration filenames are recorded in `_migrations` and must never be renamed.
- Short imperative commit subjects; the body says *why*; write the
  `Co-Authored-By` trailer yourself.

Commit in slices — one doc section or one theme per commit — so a rewrite that
turns out to have dropped something real can be read back out of the history.
