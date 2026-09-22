# Tufteseid

tuft: sted der et hus har stått; spor etter gammel bebyggelse
seid: norrønt ord for magi/trolldom


Tilpasset kartløsning for lenestolsarkeologi 

## Install/Run:

```sh
git clone https://github.com/buzh/tufteseid.git
cd tufteseid
docker compose build --pull
docker compose up -d
```

## Create admin user:

```sh
docker compose exec pocketbase /pb/pocketbase superuser create \
  you@example.com 'a-password-of-8-or-more-chars' --dir=/pb_data
```

Then open **<http://localhost:3030/pb/_/>** and sign in with it. Under
**Settings → Application**, set the Application URL to the URL users
will actually visit.

### Enable a sign-in provider (optional)

In the provider's own console, register the redirect / callback URL:

```
https://<your-host>/pb/api/oauth2-redirect
```

### Give yourself the app admin role

Sign in through the app once so PocketBase creates your user record.
Then in the admin UI: **Collections → users → your record → `role` =
`admin`**.

## Check that it works

```sh
scripts/live-check.sh https://<your-host> <a-public-lokalitet-code>
```

One request per thing the app depends on — the SPA, PocketBase, each
proxied map service and each service the browser calls directly — with
the exit status as the verdict. curl is all it needs, it writes
nothing, and it is safe to run against a live install.

## See who is using it

Caddy writes an access log to a host path, which needs to exist before
the stack starts:

```sh
sudo mkdir -p /site/tufteseid/data/logs /site/tufteseid/data/stats
docker compose up -d
docker compose restart wmscache
scripts/usage-report.sh
```

That writes a GoAccess report to the stats directory and prints what the
traffic was made of and how much of it reached Kartverket, Riksantikvaren
or Norge i bilder rather than being answered from cache here. Its
companion `scripts/health-check.sh` is the same data with thresholds on
it, silent unless something is wrong, meant for cron.

No analytics are collected in the browser: the app ships no tracker, and
every number comes out of logs the server writes anyway. See
[`docs/monitoring.md`](docs/monitoring.md), including what to change if
you do not want a request log at all.

## Licence

Tufteseid is not Norgeskart and is not operated by Kartverket. It is an
independent, non-commercial hobby project built on the source code of
Kartverket's Norgeskart. Map and elevation data come from Kartverket and
Geonorge, heritage data from Riksantikvaren; nothing you find here has
been vetted by any of them.

The **Arkeologisk relieff** background is the one picture this project
computes rather than fetches: relief visualizations made with the Relief
Visualization Toolbox from Kartverket's LiDAR terrain model and stored as
tiles ([`vat-cache/`](vat-cache/README.md)). The elevation data behind it
stays Kartverket's, on Kartverket's licence. The store is optional and
read at runtime — an install without it simply shows the national mosaic
there, and one that grows by another acquisition offers it on the next
page load, with no rebuild. It need not be computed here either:
`vat-cache/makevat.py` renders one acquisition into one self-contained
file on whatever machine has the cores, and copying that file into the
store is the whole of the deploy.

MIT — see [`LICENCE`](LICENCE). Upstream copyright by Statens Kartverk
(The Norwegian Mapping Authority) is preserved as required. Web
services from Kartverket and Riksantikvaren are subject to their own
licences (mostly CC-BY 3.0 Norway) and the Norwegian Geodata law.
