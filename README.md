# Tufteseid

*tuft*: sted der et hus har stått; spor etter gammel bebyggelse
*seid*: norrønt ord for magi/trolldom

Tilpasset kartløsning for lenestolsarkeologi — a map viewer for reading
Norwegian LiDAR terrain against the Riksantikvaren heritage register.

## Install

Four directories are bind-mounted from the host and must exist before the stack
starts, or Docker creates them root-owned and MapProxy answers every `/cache/…`
with a 502:

```sh
sudo mkdir -p /site/tufteseid/data/{logs,stats,cvat,mapproxy}
sudo chown -R 100:101 /site/tufteseid/data/mapproxy
```

`100:101` is the `mapproxy` user inside `mapproxy:7.0.0-alpine-nginx`;
[`docs/wms-proxy-and-tiles.md`](docs/wms-proxy-and-tiles.md) has the one-liner
that asks the image, for when that tag moves. Point the paths anywhere writable
— they are set in `docker-compose.yml`. The `cvat` store may stay empty: an
empty directory answers 404, which is what ground outside the LiDAR footprint
looks like anyway.

```sh
git clone https://github.com/buzh/tufteseid.git
cd tufteseid
docker compose build --pull
docker compose up -d
```

That listens on `127.0.0.1:3030`, expecting another reverse proxy in front.

To let Caddy terminate TLS itself instead: change the `:3000` line in `Caddyfile`
to your hostname and publish 80/443 rather than 3030. Certificates are then
provisioned automatically — but add `- caddydata:/data` to the `tufteseid`
service and a `caddydata:` entry under `volumes:`, or every container recreate
asks Let's Encrypt for fresh certificates and eventually trips their rate limit.

## Create an admin user

```sh
docker compose exec pocketbase /pb/pocketbase superuser create \
  you@example.com 'a-password-of-8-or-more-chars' --dir=/pb_data
```

Open **<http://localhost:3030/pb/_/>** and sign in. Under **Settings →
Application**, set the Application URL to the URL users will actually visit.

**A sign-in provider** (optional) is admin-UI only: **Collections → users → Edit
collection → Options → OAuth2**. Register this redirect URL in the provider's
own console:

```
https://<your-host>/pb/api/oauth2-redirect
```

**Give yourself the app admin role**: sign in through the app once so PocketBase
creates your user record, then **Collections → users → your record → `role` =
`admin`**.

## Check that it works

```sh
scripts/live-check.sh https://<your-host> [a-public-spot-code]
```

One request per thing the app depends on — the SPA, PocketBase, each proxied map
service and each service the browser calls directly — with the exit status as
the verdict. curl is all it needs, it writes nothing, and it is safe to run
against a live install. The spot code is optional; without one the PocketBase
half only asserts that the `spots` collection answers.

## Renders that cost you CPU

Most of what a reader keeps is rendered in their own browser. One kind — a 360°
sun rotation over a spot, stored as a WebM loop — is rendered on the server by
the `rendersvc` container, which is a minute of two cores per job.

It is capped for you: signed-in readers only, one job at a time per reader, a
queue of eight, `cpus: 2.0` and `mem_limit: 2g` in `docker-compose.yml`, and a
frame count and rectangle taken from the stored record rather than from the
request. The sidecar holds no credentials of its own — every call it makes to
PocketBase carries the requesting reader's token, so it can touch exactly what
that reader can.

Set `PUBLIC_ORIGIN` on that service to the address your own readers visit. A sun
loop is cited in its own pixels, and the short link in that band is composed
from the stored record and this origin rather than taken from the request, so
that nobody can forge one — which means it has to be your address and there is
no sensible default. Left unset, a loop is rendered with no link in its band.

To switch the feature off, remove the `rendersvc` service and its `/render/*`
route from the `Caddyfile`. Nothing else breaks: the button is still offered and
reports a failed render when pressed, and `live-check.sh` fails its two render
assertions.
[`docs/render-sidecar.md`](docs/render-sidecar.md) has the details.

## See who is using it

Caddy writes an access log to the `logs` directory created above:

```sh
docker compose restart wmscache
scripts/usage-report.sh
```

That writes a GoAccess report to the stats directory and prints what the traffic
was made of and how much of it reached Kartverket, Riksantikvaren or Norge i
bilder rather than being answered from cache here. Caddy serves the report at
`/stats/`, which the account menu links to for an app admin — **unauthenticated,
so treat it as public**: it is `noindex` and the addresses in it are anonymized
to a /24, but nothing stops a visitor who guesses the path. Put a password in
front of it in your own reverse proxy, or leave the stats directory out of
`docker-compose.yml` and read the report on the host. Its companion
`scripts/health-check.sh` is the same data with thresholds on it, silent unless
something is wrong, meant for cron.

No analytics are collected in the browser: the app ships no tracker, and every
number comes out of logs the server writes anyway. See
[`docs/monitoring.md`](docs/monitoring.md), including how to turn the request
log off entirely.

## Licence

Tufteseid is not Norgeskart and is not operated by Kartverket. It is an
independent, non-commercial hobby project built on the source code of
Kartverket's Norgeskart. Map and elevation data come from Kartverket and
Geonorge, heritage data from Riksantikvaren; nothing you find here has been
vetted by any of them.

The **Arkeologisk relieff** background is the one picture this project computes
rather than fetches: relief visualizations made with the Relief Visualization
Toolbox from Kartverket's LiDAR terrain model and stored as tiles
([`vat-cache/`](vat-cache/README.md)). The elevation data behind it stays
Kartverket's, on Kartverket's licence. The store is optional and read at
runtime: an install without it shows the national mosaic there, and one that
grows by another acquisition offers it on the next page load with no rebuild. It
need not be computed here either — `vat-cache/makevat.py` renders one
acquisition into one self-contained file on whatever machine has the cores, and
copying that file into the store is the whole of the deploy.

The Toolbox is ZRC SAZU's, and its authors ask that work using the tools cite
them. A figure whose relief came from it carries a short *metode:* line in its
legend, pointing here:

> Zakšek, K., Oštir, K., Kokalj, Ž. 2011. Sky-View Factor as a Relief
> Visualization Technique. *Remote Sensing* 3: 398–415.
>
> Kokalj, Ž., Zakšek, K., Oštir, K. 2011. Application of Sky-View Factor for the
> Visualization of Historic Landscape Features in Lidar-Derived Relief Models.
> *Antiquity* 85, 327: 263–273.
>
> Kokalj, Ž., Somrak, M. 2019. Why Not a Single Image? Combining Visualizations
> to Facilitate Fieldwork and On-Screen Mapping. *Remote Sensing* 11(7): 747.

MIT — see [`LICENCE`](LICENCE). Upstream copyright by Statens Kartverk (The
Norwegian Mapping Authority) is preserved as required. Web services from
Kartverket and Riksantikvaren are subject to their own licences (mostly CC-BY
3.0 Norway) and the Norwegian Geodata law.
