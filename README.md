# Tufteseid

*tuft*: sted der et hus har stått; spor etter gammel bebyggelse
*seid*: norrønt ord for magi/trolldom

Tilpasset kartløsning for lenestolsarkeologi — a map viewer for reading
Norwegian LiDAR terrain against the Riksantikvaren heritage register.

## Install

Six directories are bind-mounted from the host and must exist before the stack
starts, or Docker creates them root-owned and the service that wanted one fails
— MapProxy answers every `/cache/…` with a 502, Casdoor cannot create its
database and restarts in a loop:

```sh
sudo mkdir -p /site/tufteseid/data/{logs,stats,cvat,mapproxy,casdoor,remark42}
sudo chown -R 100:101 /site/tufteseid/data/mapproxy
sudo chown -R 1000:1000 /site/tufteseid/data/casdoor
```

`100:101` is the `mapproxy` user inside `mapproxy:7.0.0-alpine-nginx`;
[`docs/wms-proxy-and-tiles.md`](docs/wms-proxy-and-tiles.md) has the one-liner
that asks the image, for when that tag moves. `1000:1000` is Casdoor's user,
which its image drops to at build time and so cannot chown the directory for
itself. Remark42 starts as root and chowns its own store on the way down to its
user, so that one only has to exist. Point the paths anywhere writable — they are set in
`docker-compose.yml`. The `cvat` store may stay empty: an empty directory
answers 404, which is what ground outside the LiDAR footprint looks like
anyway.

Secrets live in a `.env` beside `docker-compose.yml`, which is gitignored.
Copy the committed shape and set `PUBLIC_ORIGIN`, `CASDOOR_HOST` and
`REMARK42_SECRET`. The OAuth2 pair comes out of Casdoor, which is not running
yet, so leave those two on the placeholders `.env.example` ships — blanking
them aborts `docker compose up` before anything starts, Casdoor included.

```sh
git clone https://github.com/buzh/tufteseid.git
cd tufteseid
cp .env.example .env
$EDITOR .env            # PUBLIC_ORIGIN, CASDOOR_HOST, REMARK42_SECRET
docker compose build --pull
docker compose up -d
```

Sign-in is broken until the next section fills the pair in. Everything else —
the map, the terrain, spots you already have — works.

That listens on `127.0.0.1:3030`, expecting another reverse proxy in front.
**Both names go to that one port.** Casdoor cannot share a hostname with the
app, so `CASDOOR_HOST` needs a DNS record and a server block of its own in
that proxy — same backend, different `server_name`. Caddy sorts them out on
the `Host` header.

**That proxy must not time `/pb/` out.** PocketBase pushes spots, votes and
finished renders down one long-lived event stream, and sends nothing between
events — so a proxy that times an idle upstream out closes it on schedule.
nginx does, after 60 seconds by default, which makes a spot, a vote or a
finished render take up to a minute to appear while the stream reconnects
under it. Giving it a location of its own in an nginx server block:

```nginx
location /pb/ {
    proxy_pass http://127.0.0.1:3030;
    proxy_redirect off;

    proxy_http_version      1.1;
    proxy_buffering         off;
    proxy_request_buffering off;

    proxy_read_timeout 1h;
    proxy_send_timeout 1h;

    proxy_set_header Connection        "Keep-Alive";
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
}
```

Every header is repeated on purpose: **a location inherits from `server`, not
from a sibling location**, so the ones set for `/` do not reach here. Dropping
the forwarded-for pair is the quiet failure — the stack keeps working, Caddy
logs every reader as 127.0.0.1, PocketBase rate-limits them as one, and
`scripts/usage-report.sh` counts one visitor. Watch the spelling of `Host`
too: nginx takes `Host:` with a stray colon as a *different* header, adds its
own `Host` alongside, and Caddy answers 400 to every request carrying two.

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

## Sign-in, and the comment threads

Readers sign in through the `casdoor` container, which is the only place a
credential is entered. Both the app and the comment engine are OAuth2 clients
of it, so a reader signs in once and can then comment without signing in
again. [`docs/identity.md`](docs/identity.md) has the full account.

Open Casdoor at **`https://<CASDOOR_HOST>/`** and sign in as `built-in` /
`admin` / `123`. **Change that password before the host is reachable from the
internet.**

**Make an organization for readers first.** Every member of Casdoor's
`built-in` organization has full Casdoor admin rights, so readers must not
land there. **Organizations → Add**, name it `tufteseid`, and create both
applications under it. Each hands back a client id and a secret when saved:

| Application | Redirect URL |
| --- | --- |
| the app | `https://<your-host>/auth/callback` |
| the threads | `https://<your-host>/remark42/auth/tufteseid/callback` |

**Tick *Enable signin session* on both.** A new application has it off, and
off it means Casdoor forgets each reader the moment it has handed back an
authorization code — so the app asks for a password on every visit and the
threads ask again on top of that, which is the one thing having an identity
provider was meant to prevent.

The threads' pair goes into `.env` as `REMARK42_OIDC_CID` and
`REMARK42_OIDC_CSEC`, replacing the placeholders; `docker compose up -d` again
to pick them up. The app's pair is typed into PocketBase instead:
**Collections → users → Edit collection → Options → OAuth2**, the generic
**OIDC** provider, pointed at

```
https://<CASDOOR_HOST>/.well-known/openid-configuration
```

The display name typed there is the text on the app's sign-in button, so the
provider's own `OIDC` left in place is what readers are asked to continue
with.

**Give yourself the app admin role**: open a place first (see below, or your
own first sign-in is refused), sign in through the app once so PocketBase
creates your user record, then **Collections → users → your record → `role` =
`admin`**. To moderate comments as well, put that account's Casdoor id in
`.env` as `REMARK42_ADMIN_ID` — the two are separate permissions in separate
systems.

## Who may register

A fresh install **registers nobody**. The app ships as a closed beta: a reader
signing in for the first time gets an account only if a free place is left or
they present an invite code, and until you say otherwise there are none of
either. Existing accounts are never re-checked, and the map, the public spots
and their threads stay open to anybody with the address.

Open some places:

```sh
docker run --rm -it -v tufteseid_pbdata:/pb_data alpine:3.20 \
  sh -c 'apk add --no-cache sqlite &&
         sqlite3 /pb_data/data.db "UPDATE registration SET openSlots = 50;"'
```

Or, to run the site as an ordinary open registration instead, turn the gate
off once and forget it:

```sh
docker run --rm -it -v tufteseid_pbdata:/pb_data alpine:3.20 \
  sh -c 'apk add --no-cache sqlite &&
         sqlite3 /pb_data/data.db "UPDATE registration SET closed = 0;"'
```

Readers you have granted invites to can pass codes on themselves or have the
site mail them, which needs SMTP under **Settings → Mail settings**; without
it the send fails and the reader is told to send the code by hand.
[`docs/closed-beta.md`](docs/closed-beta.md) has the rest — the SQL for
granting invites, what the gate does not cover, and how it is enforced.

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
