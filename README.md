# Tufteseid

A map viewer for **armchair archaeology on Norwegian public data**:
Riksantikvaren's Kulturminner register (heritage sites, SEFRAK
buildings, protected buildings, cultural environments, user-reported
finds) overlaid on Kartverket's LiDAR hillshade, so terrain relief and
the heritage record can be read together.

> Tufteseid is **not** Norgeskart, and is not affiliated with or
> operated by Kartverket (the Norwegian Mapping Authority) or
> Riksantikvaren (the Directorate for Cultural Heritage). It is an
> independent, non-commercial hobby project that consumes their public
> web services. Derived from
> [Kartverket's Norgeskart](https://github.com/kartverket/Norgeskart);
> a hard fork, not tracking upstream.

## Deploy

Runs as a Docker Compose stack (Caddy-served SPA + `wmscache` nginx
sidecar that caches every external WMS the app hits). Standard rebuild
on the host:

```sh
git pull
docker compose build --pull tufteseid
docker compose up -d
docker compose logs -f tufteseid wmscache
```

Caddy inside the container listens on `:3000`; compose maps host
`3030 → container 3000`.

Runtime config lives in `config.js` (bind-mounted into the container).
Copy `config.example.js` and edit the endpoints. See
[`CLAUDE.md`](CLAUDE.md) for the full deploy and services rundown,
including when to restart `wmscache` and how the WMS proxy paths work.

### Migrating from a `norgeskart`-named stack

The compose project is now pinned to `tufteseid`, so the volumes are
named `tufteseid_pbdata` / `tufteseid_wmscache`. An existing deployment
has them under the `norgeskart_` prefix. The WMS cache can just be left
to re-warm, but PocketBase state (users, finds) needs copying over with
the stack down:

```sh
docker compose -p norgeskart down
docker volume create tufteseid_pbdata
docker run --rm -v norgeskart_pbdata:/from -v tufteseid_pbdata:/to \
  alpine sh -c 'cd /from && cp -a . /to'
docker compose up -d
```

Keep `norgeskart_pbdata` around until you've confirmed sign-in and your
finds still work; `docker volume rm norgeskart_pbdata norgeskart_wmscache`
once you have.

## Data sources

All same-origin from the browser's point of view — the `wmscache`
nginx sidecar reverse-proxies + caches each upstream:

- **Kulturminner** (theme layers) — `kart.ra.no/wms/*`, via `/wms/ra/*`
- **LiDAR hillshade** and per-project LiDAR (background layers) —
  `wms.geonorge.no/skwms1/*`, via `/wms/geonorge/*`
- **Matrikkel** (cadastral, for property lookup) —
  `testapi.norgeskart.no/v1/*`, via `/wms/testapi/*`

## Licence

MIT — see [`LICENCE`](LICENCE). Upstream copyright by Statens Kartverk
(The Norwegian Mapping Authority) is preserved as required. Web
services from Kartverket and Riksantikvaren are subject to their own
licences (mostly CC-BY 3.0 Norway) and the Norwegian Geodata law.
