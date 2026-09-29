# Identity

One account, three consumers. A reader signs in once and is then known to the
SPA, to PocketBase and to the comment engine.

```
browser ──► Caddy $CASDOOR_HOST ──► casdoor:8000    the identity provider
        ──► Caddy /pb/*         ──► pocketbase:8090  OAuth2 client (the app)
        ──► Caddy /remark42/*   ──► remark42:8080    OAuth2 client (the threads)
```

Casdoor is the only place a credential is ever entered. PocketBase and Remark42
each hold their own user row keyed to the Casdoor subject, and neither of them
authenticates anybody itself.

## Why Casdoor

Remark42 federates to exactly one custom OAuth2 provider and wants three URLs
from it — authorize, token, userinfo. Any OIDC provider satisfies that.
Casdoor is the one that matches how the rest of this stack is built: a single
Go binary on SQLite under Apache-2.0, no worker, no PostgreSQL, no SMTP
dependency. Authentik would do the same job with a flow editor, SAML and LDAP
on top, at a documented 2 GB floor and four containers, on a host already
carrying wmscache's 25 GB cache and rendersvc's memory cap. If those features
are ever wanted, swapping the provider touches this document and the
`casdoor` service only — the two clients are configured by URL.

## Its own hostname

**Casdoor cannot live under a subpath**, and there is no setting that makes it.
Its console is a create-react-app build with `/static/js/main.*.js` baked into
the HTML as a root-absolute path, its XHRs go to `/api/*`, and its router owns
several dozen more root paths (`/login`, `/users`, `/applications`, …).
Strip a `/id` prefix in front of that and the browser asks the SPA's origin for
the bundle, gets the app's 404 page, and renders nothing. Casdoor's own
deployment docs only ever describe a whole domain proxied at `/`.

So `CASDOOR_HOST` in `.env` is a hostname of its own — `id.<app host>` by
convention, though nothing requires it to be a subdomain of anything. It is
**not** a second listener: it points at the same `127.0.0.1:3030` the app does,
and a `host` matcher at the top of `Caddyfile`'s route hands it to
`casdoor:8000`. Only the `Host` header separates the two, which is why the
matcher stands before any path matcher could claim one of them.

It stands above the `header Content-Security-Policy` line for the same reason
`/stats/` does — directives inside a `route` run in order, and under the app's
`script-src 'self'` the console would not run. It sets no CSP of its own, so
the block restates `Strict-Transport-Security` and `X-Content-Type-Options` by
hand and adds `X-Robots-Tag: noindex`.

`origin=https://$CASDOOR_HOST` tells Casdoor the address it is reached at.
Every link it prints and every redirect it issues is composed from that — so a
mismatch shows up as a login that loops rather than as an error. The scheme is
fixed in `docker-compose.yml` rather than asked for in `.env`: an identity
provider on plain http is not one.

## Front and back channel

The reader's browser reaches Casdoor at its public hostname. The two calls
that follow — the code-for-token exchange and the userinfo fetch — are made by
`remark42` and by PocketBase, not by the browser, and those two point at
`http://casdoor:8000` inside the compose network instead. A container reaching
its own public hostname works only if the host does NAT loopback, and a
sign-in should not rest on that.

PocketBase's OAuth2 config is set from the discovery document, which advertises
the public URLs, so its back channel *does* hairpin. If sign-in fails there
with a connection error while `remark42` is fine, that is the cause: type the
token and userinfo endpoints in by hand, pointed at `http://casdoor:8000`.

## Configuration

`app.conf` lives inside the image and every key in it is overridable by an
environment variable of the same name, the variable winning. So the service
declares the four that matter — `driverName`, `dataSourceName`, `runmode`,
`httpport` — and leaves the rest.

Three traps, all of which present as a container restarting in a loop:

- The SQLite DSN must **not** carry the `file:` scheme, even though Casdoor's
  own default config does. modernc.org/sqlite takes the prefix as part of the
  path and creates a file called `file:casdoor.db`, leaving the real one
  empty. `/data/casdoor.db?cache=shared` is right.
- The data directory must be owned by uid/gid 1000. `sudo mkdir -p` leaves it
  owned by root and Casdoor cannot create its database.
- **No `--createDatabase=true`.** Casdoor's docs offer it and the flag is
  MySQL-only: it issues `CREATE DATABASE … default charset utf8mb4`, which
  SQLite rejects with a syntax error and Casdoor turns into a panic. Nothing
  is lost by leaving it off — `/server` creates the tables and seeds the
  built-in organisation on an empty volume either way.

## Registering the clients

**Readers do not belong in the `built-in` organization.** Every member of it
has full Casdoor admin rights, and this is a site people sign themselves up
for — so the first thing to make is an organization of their own, with both
applications under it. Users belong to the organization rather than to an
application, which is what lets one sign-in serve both clients.

Both are applications in Casdoor's console, and both hand back a client id and
a secret.

| Client | Redirect URI |
| --- | --- |
| PocketBase | `$PUBLIC_ORIGIN/pb/api/oauth2-redirect` |
| Remark42 | `$PUBLIC_ORIGIN/remark42/auth/tufteseid/callback` |

Both are on the **app's** origin, not Casdoor's: a redirect URI is where the
reader is sent back to.

Remark42's path segment is its `AUTH_CUSTOM_NAME`, so the two have to be
changed together. The name must match `^[a-z0-9][a-z0-9_-]*$` and must not
collide with one of the built-in provider names.

The Remark42 pair goes in `.env` (`REMARK42_OIDC_CID`, `REMARK42_OIDC_CSEC`).
The PocketBase pair is typed into PocketBase's own admin UI: Collections →
`users` → Edit collection → Options → OAuth2 → the generic `oidc` provider,
pointed at `https://$CASDOOR_HOST/.well-known/openid-configuration`. Provider
config is not versioned in `pb_migrations/`, so it is set by hand on each host
and the `displayName` typed there is the button text `AuthDialog` renders.

## Two things OIDC does not carry

**`role = "admin"` is a PocketBase field, not a claim.** Every collection rule
in `pb_migrations/` reads `@request.auth.role`, and nothing in the token
populates it. An administrator is made by editing the `users` record in
PocketBase's admin UI, and stays made until it is edited back.

**Accounts are matched by email, or not at all.** `spots.owner` and
`evidence.owner` are relations to `users`, and `spots.credit` is a denormalized
display name. Signing in through a new provider creates a *new* `users` row
unless an existing one carries the same verified email, in which case
PocketBase links them. Decide what to do about pre-existing rows before the
first sign-in through Casdoor — afterwards the ambiguity is real records with
real owners, and the only way back is re-pointing them by hand.
