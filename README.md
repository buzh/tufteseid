# Tufteseid

A map viewer for **armchair archaeology on Norwegian public data**:
Riksantikvaren's Kulturminner register (heritage sites, SEFRAK
buildings, protected buildings, cultural environments, public
submissions) overlaid on Kartverket's LiDAR hillshade, so terrain
relief and the heritage record can be read together.

> Tufteseid is **not** Norgeskart, and is not affiliated with or
> operated by Kartverket (the Norwegian Mapping Authority) or
> Riksantikvaren (the Directorate for Cultural Heritage). It is an
> independent, non-commercial hobby project that consumes their public
> web services. Derived from
> [Kartverket's Norgeskart](https://github.com/kartverket/Norgeskart);
> a hard fork, not tracking upstream.

## What it does

- **LiDAR terrain** as a background map: Kartverket's national hillshade
  mosaic plus the ~1900 per-project DTM/DOM datasets, switchable by
  relief style. A *hybrid* mode draws roads, railways and place names
  transparently on top so you can tell where you are without leaving the
  terrain.
- **Kulturminner** as theme layers straight from Riksantikvaren's WMS
  services, with structured feature-info on click.
- **Lokaliteter** — sign in and mark out an area to explore. Inside a
  lokalitet you can record individual *funn* (drawn shapes with a title,
  note and a `mulig → sannsynlig → avkreftet → rapportert` status), keep
  *bilder* (LiDAR extracts, map screenshots, uploads), and get a readout
  of already-registered kulturminner inside the rectangle.
- **LiDAR extract**: pull a high-resolution tile of terrain for the
  current area and compare relief styles side by side.
- Place, address and cadastral property search, and measuring, without
  signing in. Drawing lives inside a lokalitet.

Keyboard, while a LiDAR background is active: `W`/`S` cycle the dataset,
`A`/`D` cycle the relief style, `E` toggles DTM (bare terrain) against
DOM (everything the laser hit).

## Requirements

- A Linux host with **Docker Engine** and the **Compose v2 plugin**
  (`docker compose`, not `docker-compose`).
- **x86-64.** The PocketBase image downloads the upstream `linux_amd64`
  release; on arm64, change that URL in `pocketbase/Dockerfile` to the
  `linux_arm64` asset before building.
- **~30 GB free disk.** The WMS cache is capped at 25 GB, on top of
  PocketBase's database and uploaded images.
- **≥ 2 GB RAM for the build step.** Compiling the SPA is the heaviest
  thing here; add swap on a small VPS if the build gets OOM-killed.
- No Node toolchain on the host — the SPA is built inside the image.

Network access the **server** needs (outbound HTTPS): `wms.geonorge.no`,
`wfs.geonorge.no`, `kart.ra.no`, `testapi.norgeskart.no`, plus
`registry.npmjs.org` and `github.com` at build time.

Network access the **browser** needs: your Tufteseid host, and directly
`cache.kartverket.no` (base map tiles), `ws.geonorge.no` and
`api.norgeskart.no` (search), `fonts.googleapis.com` /
`fonts.gstatic.com`. Everything else is proxied same-origin.

## Install

### 1. Clone

```sh
git clone https://github.com/buzh/tufteseid.git
cd tufteseid
```

### 2. Create `config.js`

```sh
cp config.example.js config.js
```

`config.js` is git-ignored and bind-mounted into the container. The
defaults work as-is for a first run; see
[Configuration](#configuration) for what you may want to change.

> **Create the file before the first `docker compose up`.** If it
> doesn't exist, Docker helpfully creates a *directory* named
> `config.js`; `index.html` then loads nothing from `/config.js` and the
> app silently runs on its compiled-in defaults. If that happens:
> `docker compose down && rm -rf config.js` and start over from this
> step.

### 3. Build and start

```sh
docker compose build --pull
docker compose up -d
docker compose logs -f tufteseid pocketbase wmscache
```

In the `pocketbase` logs you should see the three migrations applied
(`localities`, `finds`, `attachments`). Ctrl-C stops following the logs;
the stack keeps running.

### 4. Reach it

The stack publishes **`127.0.0.1:3030`** only — nothing is exposed to
the network by design. From the host:

```sh
curl -I http://localhost:3030
```

From your own machine, tunnel it:

```sh
ssh -N -L 3030:localhost:3030 you@your-host
```

then open <http://localhost:3030>. The map, search and all layers work
at this point; only the lokalitet features need the next steps.

See [Putting it on the internet](#putting-it-on-the-internet) when
you're ready to give it a hostname.

### 5. Create the PocketBase admin account

Open **<http://localhost:3030/pb/_/>**. On first visit PocketBase asks
you to create its admin account — this is the database administrator,
separate from the app's own admin role in step 7.

Under **Settings → Application**, set the Application URL to the URL
users will actually visit.

> If the admin UI doesn't load through the `/pb/` path, publish
> PocketBase directly for the duration of the setup: add
> `ports: ["127.0.0.1:8090:8090"]` to the `pocketbase` service in
> `docker-compose.yml`, `docker compose up -d pocketbase`, tunnel 8090
> the same way, and use <http://localhost:8090/_/>. Remove it again
> afterwards.

### 6. Enable a sign-in provider

Lokaliteter, funn and bilder all require sign-in, and sign-in is OAuth
only — there is no username/password path in the UI. In the PocketBase
admin: **Settings → Auth providers**, enable at least one (Google,
GitHub, Microsoft, or a generic OIDC endpoint) and paste in the client
id and secret from that provider.

In the provider's own console, register the redirect / callback URL:

```
https://<your-host>/pb/api/oauth2-redirect
```

It is always your **Tufteseid** origin plus `/pb/api/oauth2-redirect`,
never PocketBase's internal address. While testing over the SSH tunnel
the origin is `http://localhost:3030`, which Google and GitHub both
accept; a public deployment needs https.

No code change is needed to add a provider later — the sign-in dialog
lists whatever is enabled here.

### 7. Give yourself the app admin role

Sign in through the app once so PocketBase creates your user record.
Then in the admin UI: **Collections → users → your record → `role` =
`admin`**.

The app role is separate from the PocketBase admin account. `admin`
means: see every lokalitet regardless of visibility, and edit or delete
anyone's. A missing role is treated as an ordinary `user`.

> **There is no signup allowlist.** Anyone who can reach the site and
> has an account with an enabled provider can sign in and create their
> own lokaliteter. If you want a closed instance, put authentication in
> front of it at your reverse proxy, or don't publish it.

### 8. Check the cache is working

```sh
curl -sI "http://localhost:3030/wms/geonorge/wms.hoyde-dtm-nhm-topobathy-25833?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=NHM_DTM_TOPOBATHY_25833:skyggerelieff&CRS=EPSG:25833&BBOX=200000,6500000,300000,6600000&WIDTH=256&HEIGHT=256&FORMAT=image/png" | grep -i x-cache
```

First call reports `X-Cache-Status: MISS`, a repeat reports `HIT`.
Current cache size on disk:

```sh
docker run --rm -v tufteseid_wmscache:/c alpine du -sh /c
```

## Configuration

Everything runtime-configurable lives in `config.js` at the repo root,
served to the browser as `/config.js`. Values there override the
compiled-in defaults from `src/env.ts`; omit a key to keep the default.
Edits take effect on the next page load — no rebuild, no restart.

| Key | Default | What it's for |
| --- | --- | --- |
| `envName` | `'selfhost'` | Only used to pick an operational-message channel from Kartverket's config repo. Any value other than `local`/`dev`/`test`/`prod` means no banner is fetched, which is what you want. |
| `apiUrl` | `https://api.norgeskart.no` | Kartverket's cadastral (matrikkel) API, called from the browser for property search and property outlines. It reflects the caller's `Origin`, so it works from a self-hosted site. |
| `geoNorgeApiBaseUrl` | `https://ws.geonorge.no` | Place-name and address search. Public, browser-callable. |
| `pocketbaseUrl` | `/pb` | Where the SPA looks for PocketBase. Same-origin by default so auth cookies and the OAuth redirect just work; only change it for a `vite dev` setup. |
| `layerProviderParameters.kartverketCache.baseUrl` | `https://cache.kartverket.no` | The topographic base map tiles, fetched by the browser directly. |
| `layerProviderParameters.geoNorgeWMS.baseUrl` | `/wms/geonorge/wms` | Kartverket WMS prefix. Same-origin, so it goes through the caching sidecar. Point it at `https://wms.geonorge.no/skwms1/wms` only if you deliberately want to bypass the cache. |

The browser console logging `Unknown domain: <your host>` on load is
expected: the upstream code picks defaults by hostname, doesn't
recognise yours, and `config.js` then overrides them anyway.

### The stack

Four moving parts, defined in `docker-compose.yml`:

- **tufteseid** — multi-stage build: `node:24-alpine` compiles the SPA,
  `caddy:2.10-alpine` serves it. Caddy listens on `:3000` inside the
  container (mapped to host `3030`), serves the static files, and
  reverse-proxies the `/wms/*`, `/wfs/*` and `/pb/*` paths. The
  `Caddyfile` is baked into the image.
- **pocketbase** — auth and storage for lokaliteter. Reachable only
  through Caddy's `/pb/*`. SQLite state on the `tufteseid_pbdata`
  volume; schema versioned as JS migrations in
  `pocketbase/pb_migrations/`, bind-mounted read-only.
- **wmscache** — nginx sidecar that reverse-proxies and caches every
  external WMS the app uses, 25 GB LRU on the `tufteseid_wmscache`
  volume. Not published on the host. Config bind-mounted from `nginx/`.

Because every map request is same-origin from the browser's point of
view, no upstream host needs a Content-Security-Policy entry, and there
is no CORS to configure.

## Putting it on the internet

### Behind a reverse proxy you already run

Leave the loopback binding as it is and proxy to `127.0.0.1:3030`.
Forward the original `Host` header and set `X-Forwarded-Proto: https`.
Nothing else is needed — Caddy inside the container already sets HSTS
and the CSP.

### Letting Caddy terminate TLS itself

1. In `Caddyfile`, change the `:3000` site address to your hostname,
   e.g. `maps.example.com`.
2. In `docker-compose.yml`, replace the `127.0.0.1:3030:3000` mapping
   with `80:80` and `443:443`.
3. **Add a volume for Caddy's certificates**, or it will request new
   ones from Let's Encrypt every time the container is recreated and
   you will hit their rate limits:

   ```yaml
   services:
     tufteseid:
       volumes:
         - caddydata:/data
   volumes:
     caddydata:
   ```

4. Rebuild — the `Caddyfile` is copied into the image. (Alternatively,
   uncomment the `Caddyfile` bind-mount in `docker-compose.yml` and
   restart instead of rebuilding, which is handy while iterating.)

Either way, remember to update the OAuth redirect URL in your
provider's console and PocketBase's Application URL to the new origin.

## Day-to-day operation

### Upgrading

```sh
git pull
docker compose build --pull tufteseid
docker compose up -d
docker compose logs -f tufteseid
```

### What needs restarting after what

`docker compose up -d` only recreates containers whose image or
definition changed. Several config files are bind-mounted, so the file
on disk is current but the process hasn't re-read it:

| Changed | Do this |
| --- | --- |
| `config.js` | Nothing. Reload the browser. |
| `src/**`, `Caddyfile`, `Dockerfile` | `docker compose build tufteseid && docker compose up -d` |
| `nginx/wms-cache.conf`, `nginx/wms-proxy-common.conf` | `docker compose restart wmscache` |
| `pocketbase/pb_migrations/*` | `docker compose restart pocketbase` then check `docker compose logs pocketbase` |

### Backup

The `tufteseid_pbdata` volume is the only irreplaceable state — user
accounts, lokaliteter, funn and uploaded images. (`tufteseid_wmscache`
is disposable; it re-warms. `config.js` is not in git, so keep a copy
of it too.)

Easiest route: PocketBase admin UI → **Settings → Backups**, which can
also run on a schedule and lets you download a zip.

From the host, with the service stopped so SQLite is quiescent:

```sh
docker compose stop pocketbase
docker run --rm -v tufteseid_pbdata:/data -v "$PWD":/backup alpine \
  tar czf "/backup/pbdata-$(date +%F).tar.gz" -C /data .
docker compose start pocketbase
```

Restore the same way, in reverse:

```sh
docker compose stop pocketbase
docker run --rm -v tufteseid_pbdata:/data -v "$PWD":/backup alpine \
  sh -c 'rm -rf /data/* && tar xzf /backup/pbdata-2026-01-01.tar.gz -C /data'
docker compose start pocketbase
```

## Troubleshooting

**A `/wms/...` or `/wfs/...` URL returns nginx's default 404 page**, even
though the Caddyfile and layer configs look right — wmscache is running
an older copy of its config. `docker compose restart wmscache`.

**"Ny lokalitet" appears to do nothing**, or the browser console shows
404s from `/pb/api/collections/...` — PocketBase hasn't applied a
migration. `docker compose restart pocketbase`, then check its logs.

**Sign-in fails with a generic error**, or the provider shows
"redirect_uri_mismatch" — the registered callback URL must be exactly
your site's origin plus `/pb/api/oauth2-redirect`, and the origin the
user is browsing must match it (https vs http, www vs bare hostname).

**Nothing answers on port 3030 from another machine** — that's the
loopback binding in `docker-compose.yml`, working as intended. Tunnel
in, or put a reverse proxy in front.

**The map is blank in LiDAR mode** while topo works — either that area
has no coverage in the selected dataset (try `W`/`S` to another one, or
the national mosaic), or the selected relief style doesn't exist for
that dataset. DOM publishes only `skyggerelieff`. Upstream reports these
as an HTTP 200 with an almost-empty body, so nothing appears in the
console.

**Tiles load slowly the first time and instantly afterwards** — that's
the cache doing its job. Riksantikvaren's origin in particular is slow
when cold.

**The SPA loads but with default endpoints** — check that `config.js` is
a file, not a directory, and that `curl http://localhost:3030/config.js`
returns JavaScript.

## Data sources

All map data comes from Norwegian public services. Requests are
proxied through the `wmscache` sidecar, so they are same-origin from
the browser and cached on disk:

| Source | Upstream | Proxied as |
| --- | --- | --- |
| Kulturminner theme layers | `kart.ra.no/wms/*` (Riksantikvaren) | `/wms/ra/*` |
| LiDAR hillshade, per-project LiDAR, topo overlay | `wms.geonorge.no/skwms1/*` (Kartverket) | `/wms/geonorge/*` |
| Known-kulturminner readout | `wfs.geonorge.no/skwms1/*` | `/wfs/geonorge/*` (deliberately uncached) |
| Matrikkel (cadastral) | `testapi.norgeskart.no/v1/*` | `/wms/testapi/*` |

The base map tiles (`cache.kartverket.no`) and the search APIs
(`ws.geonorge.no`, `api.norgeskart.no`) are called by the browser
directly.

These are other people's servers, offered as a public good. The disk
cache exists partly to be a polite client — please don't remove it or
crank the extract resolution far beyond what you need. The matrikkel
endpoint is a *test* endpoint and carries no stability promise.

## Development

Rebuilding the Docker image is the normal loop, and the only one that
exercises the whole stack:

```sh
docker compose build --pull tufteseid && docker compose up -d
```

TypeScript errors surface in the build output. For editing:

```sh
npm ci
npm run lint
npx vitest run
npm run dev        # vite on :3000
```

Note that `npm run dev` serves the SPA alone: the same-origin `/wms/*`,
`/wfs/*` and `/pb/*` paths have no handler there, so the base map and
search work but LiDAR, Kulturminner and sign-in do not. Either add a
proxy to `vite.config.ts` pointing at a running stack, or build the
image.

`CLAUDE.md` documents the internals — how the background layer stack is
assembled, why the LiDAR tile loader is custom, and the recipes for
adding another theme or background layer.

## Licence

MIT — see [`LICENCE`](LICENCE). Upstream copyright by Statens Kartverk
(The Norwegian Mapping Authority) is preserved as required. Web
services from Kartverket and Riksantikvaren are subject to their own
licences (mostly CC-BY 3.0 Norway) and the Norwegian Geodata law.
