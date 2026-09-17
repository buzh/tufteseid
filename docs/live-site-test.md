# Testing a live deployment

How to find out whether a running Tufteseid works, from outside it. Two halves:
a machine pass (`scripts/live-check.sh`, every request the app makes, none of
what it does with them) and an eye pass (the part that only a browser can
answer). Run the machine pass after every deploy and whenever an upstream is
suspected; run the signed-out eye pass after any change under `src/`, and the
signed-in one after a change to the lokalitet surfaces or a PocketBase
migration.

Nothing here needs a node toolchain, a shell on the server, or credentials for
the anonymous half — it is all HTTP against the public origin, so it runs from
the workstation as well as from the server.

## The fixture

`https://kart.scheen.no/l/JYBNQC` — *Løkstad* in Kragerø, public: at least nine
ploughed-down gravhauger in a v-formation, read off LiDAR.

| Property | Value |
| --- | --- |
| Rectangle | `187045,6536056,187291,6536224` EPSG:25833 — 246 × 168 m |
| LiDAR | NDH Kragerø-Drangedal 2pkt 2016, and the national mosaic |
| Flyfoto | NiB mosaic plus a dozen acquisitions |
| Funn | 12: GH1–GH9 and Funn 10–12, all `mulig`, one with two features |
| Bilder | 12: 11 `extract` Views and one `sketch` |

A *public* lokalitet with content is the fixture because the anonymous read path
is the widest surface the app has — the register reads, the rail, the layer row,
`[Visning ▾]`'s re-creation of a ground, the funn layer and `Last ned`'s
stamped file all answer without an account, and a reader is the one visitor who
can be reproduced exactly.

What it deliberately does not hold, and what therefore has to be tested on a
scratch lokalitet of your own: `screenshot`, `upload`, `flyfoto` and `scene`
attachments, a caption, a hidden frame, a funn in any other status, and
`derivedFrom`.

What must stay true of it: public, at least one funn, at least one attachment
with a file. Rename it, move it, add to it — the machine pass reads the code and
derives the rest. If it is deleted or turned private, every check below the
`lokalitet` row fails; point the script at another code rather than patching it.

## 1. The machine pass

```sh
scripts/live-check.sh                              # the reference deployment
scripts/live-check.sh https://your-host YOURCODE   # anywhere else
```

33 requests, about ten seconds warm, exit status is the verdict. It writes
nothing: the one `POST` is there to be refused.

**Run it twice.** Every row in the same-origin group prints `X-Cache-Status`,
and on the second run all ten must read `HIT`. A row stuck on `MISS` is a
response under `$skip_cache`'s 300-byte floor or a cache that is not storing at
all — `docs/wms-proxy-and-tiles.md`.

| Group | A red line means |
| --- | --- |
| Shell | Caddy is serving something other than the built SPA: a stale `/var/www`, a `config.js` that did not mount, a lost CSP header, or a rewrite that turned wrong paths into 200s |
| PocketBase | the backend, its list rules or the `pbdata` volume — a failed migration shows up here first, as a 404 on the collection |
| Same-origin upstreams | one prefix of the Caddy → wmscache → origin chain: the prefix itself, nginx's location for it, or the origin behind it |
| Direct upstreams | a host the browser talks to itself. The deployment is innocent; search, the Standard ground or the elevation readout are down anyway |

Five checks assert an absence, and each is a rule rather than a screen:

- `no-private-leak` — an anonymous reader may list public records and nothing
  else. The list rule is the whole privacy model.
- `anon-write-refused` — a `POST` to `finds` without a session is refused by the
  create rule.
- `owner-not-expanded` — migration `1700000900` opened `localities`, `finds` and
  `attachments` to guests, and deliberately not `users`. So `expand=owner` comes
  back empty for a signed-out reader. A non-empty expand means somebody opened
  the users collection, which is a privacy decision and not a bug fix. The
  surfaces that name an author read `credit` off the lokalitet instead
  (migration `1700001000`); a record created before that field, or one whose
  owner cleared it, still has no name to print.
- `unknown-path` — `file_server` still has no SPA fallback.
- `help-route-404` — `/hjelp` is a client-side route and a cold load of it 404s
  (`docs/ui-architecture.md` §8). A 200 means somebody added a catch-all.

The probe rectangle is the fixture's, hardcoded: a raster liveness check does not
care where it looks as long as the place has coverage, and deriving it from the
record would cost a reprojection and so a dependency. Two things the script
encodes that cost an afternoon to rediscover — Riksantikvaren's MapServer 8
answers a `GetMap` without `STYLES` as a 200 carrying a `ServiceException`, and
WMS 1.3.0 takes EPSG:25833's own axis order, easting first, answering a swapped
box with a blank tile rather than an error.

## 2. The eye pass, signed out

A private window on `https://kart.scheen.no/l/JYBNQC`, console open. Anybody can
run this; it needs no account and touches nothing.

1. **Landing.** The URL becomes `/?lok=JYBNQC`, the map frames the rectangle,
   and the lokalitet row reads *Løkstad* with its code chip and a `public`
   badge, and a *Delt av* banner naming whatever the owner put in `credit` —
   absent where they cleared it, since the `users` record behind it is not a
   guest's to read.
2. **Stance.** The exits are `[Lukk] [⋮]` and nothing else — no `Rediger`
   (not the owner), no `Lag min kopi` (not signed in). `Nytt funn`, `Behold`,
   `Hent ▾` and `Skjermbilde` are absent, not greyed. `⋮` offers Zoom til
   lokaliteten, Detaljer, Del and Rapportpakke, and neither Juster området nor
   Slett.
3. **Funn.** `Funn ▾` counts 12. The rectangle carries their outlines; ↑ / ↓
   walks the list as a zoom tour, Enter zooms to the selected one, hover on the
   map selects in the list and the reverse. `H` takes the whole group off and
   brings it back.
4. **Bilder.** The rail along the bottom holds 12 frames; ← / → and A / D walk
   it, and each frame you land on goes up on the ground. `Bilder ▾` folds the
   edge away and back without moving the map. The frame on the ground carries
   no furniture: the store holds bare pixels. `Åpne originalen` opens exactly
   those; `Last ned` saves the same picture with a provenance plate inset in
   the bottom-left corner — title, dataset, settings, centre, scale bar and one
   rights line per holder, in the language the app is in. Both work without an
   account; switch to `en` and download again to see the plate follow.
5. **The layer row.** `[Visning ▾]` lists the eleven extracts; picking one puts
   it on the ground *and takes the map back the way it was made*. `[Skisse ▾]`
   switches the sketch on over whatever ground is up. Every member has a fade;
   nothing in the row writes.
6. **Grounds.** 1–5 walk Kart, LiDAR, Hybrid, Flyfoto, Terreng. Hold `X` to peek
   at the previous one. On LiDAR, W / S walks `[Visning ▾]` here rather than the
   dataset ring, because a lokalitet is open. `Sammenlign` puts a second ground
   behind a draggable seam; `C` flips which half row 1 describes; leaving takes
   the second stack down.
7. **Terreng.** Runs over the rectangle with no account: pick a visualization,
   move a slider, watch it recompute. `Behold` is absent — keeping costs a
   record.
8. **Write keys are dead.** `N`, `U` and `B` do nothing at all. They are gated on
   `canAdd`, which a reader never has.
9. **Rapportpakke.** `⋮ → Rapportpakke` downloads
   `løkstad-YYYY-MM-DD.zip`; it opens on `index.html` with the bilder in the
   rail's order and `funn/funn.geojson` + `funn.csv` beside them. A reader
   cannot pin, so any unpinned View is named on the front page instead of
   silently missing. Every image in the zip carries the same plate `Last ned`
   stamps. The front page and the plate's authored half both name the
   lokalitet's `credit`, and read *Ukjent* only where that field is empty.
10. **Del.** `⋮ → Del` copies `/l/JYBNQC` and says that anybody can open it.
11. **Housekeeping.** Switch language nb → nn → en: no raw translation keys
    anywhere, and no `Norgeskart` or `Kartverket` in the chrome in any of the
    three. The console stays clean — a CSP violation is reported there and
    nowhere else.

## 3. The eye pass, signed in

Sign in, then work on a *scratch* lokalitet — never the fixture. Delete it at the
end; the checks below are the parts a reader cannot reach.

1. `Ny lokalitet`, drag the rectangle by a corner and an edge, watch the live
   readout, be refused past 1500 m and under 50 m with a message naming the
   limit. `Opprett` names it after the nearest stedsnavn and opens it in `edit`.
2. The starter set fills the bottom edge with three readings of the best LiDAR
   dataset, filling in as they render.
3. `Nytt funn` (or `N`) freezes the map and arms the pen; the first finished
   shape becomes a buffered funn with a name. Draw a second, undo, redo. Rename
   one, note it, set it `sannsynlig`. Zoom out until one escapes the rectangle
   and take the "Utvid området" offer.
4. `Skjermbilde` (`B`), `LiDAR-uttrekk` (`U`) at a chosen source and resolution,
   `Hent ▾ → Flyfoto` as a batch, and `Last opp` for a file from disk. Give the
   upload an extent with `Plasser i ruta` and file it under a funn with
   `Hører til`.
5. Caption a frame, hide one (dashed on the rail while editing), drag another to
   the front and watch the cover follow.
6. Arrange the ground, the members and their fades, then `Oppsett`; change
   everything; `Legg ut igjen` from the rail restores it.
7. `Lagre`, then `Avbryt` after a further edit, then `Avslutt` over unsaved work
   — three answers, all three honoured. Reload mid-edit and confirm the
   recovered-buffer banner.
8. From another account (or a private window signed in as someone else), open
   the scratch lokalitet's link while it is `public` and press `Lag min kopi`:
   the copy carries the rectangle, the details, every funn and every View, starts
   `private`, and names the original in its banner. The Files left behind appear
   at the end of the carousel with `Ta med`.
9. `⋮ → Slett` both records. The machine pass's `no-private-leak` row is the
   proof that nothing you made along the way is visible to a stranger.

## 4. Around a deploy

```sh
curl -s https://your-host/ | grep -o '/assets/index-[^"]*\.js'   # before
git pull && docker compose build --pull tufteseid && docker compose up -d
curl -s https://your-host/ | grep -o '/assets/index-[^"]*\.js'   # after
scripts/live-check.sh https://your-host YOURCODE
```

The entry-bundle hash is the only version stamp there is — nothing in the UI
reports a build — so a hash that did not move means the browser and the server
are still on the old SPA, whatever the build log said. `live-check.sh` prints
the same hash on its `index` row.

Changed `nginx/`? `docker compose restart wmscache` first, or the config is
still the old one and the cache rows lie. Added a migration? `docker compose
restart pocketbase` first, then the PocketBase group is the check — a migration
that did not register answers 404 on its collection, and the SPA shows that only
in the console.

## What this does not cover

The machine pass proves a byte came back, never that it was drawn: the canvas,
Excalidraw, the provenance plate a download is stamped with, and every stitcher
are the eye pass's job. Nothing here tests load, cache
eviction, a cold upstream's 5–14 s render, or the signed-in write rules beyond
the steps above. And neither pass tests the admin asymmetry — an admin may
rename and delete anybody's lokalitet but may not add funn or bilder to it —
which needs two accounts and is worth a walk after any change to the rules.
