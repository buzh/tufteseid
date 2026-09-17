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
nothing, and it is safe to run against a live install. The manual pass
that goes with it is [`docs/live-site-test.md`](docs/live-site-test.md).

## Licence

Tufteseid is not Norgeskart and is not operated by Kartverket. It is an
independent, non-commercial hobby project built on the source code of
Kartverket's Norgeskart. Map and elevation data come from Kartverket and
Geonorge, heritage data from Riksantikvaren; nothing you find here has
been vetted by any of them.

MIT — see [`LICENCE`](LICENCE). Upstream copyright by Statens Kartverk
(The Norwegian Mapping Authority) is preserved as required. Web
services from Kartverket and Riksantikvaren are subject to their own
licences (mostly CC-BY 3.0 Norway) and the Norwegian Geodata law.
