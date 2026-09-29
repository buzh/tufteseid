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

So `CASDOOR_HOST` in `.env` is a hostname of its own — `id.<app host>`, and a
subdomain of the app's host rather than a domain of its own for a reason: both
the sign-in box and the comment threads' silent leg run Casdoor inside a frame
on the app's page, and only a Casdoor that is *same-site* with the app keeps
its own cookies there. On a registrable domain of its own the browser counts
them third-party and both fall back. It is **not** a second listener: it
points at the same `127.0.0.1:3030` the app does,
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
  empty.
- The data directory must be owned by uid/gid 1000. `sudo mkdir -p` leaves it
  owned by root and Casdoor cannot create its database.
- **No `--createDatabase=true`.** Casdoor's docs offer it and the flag is
  MySQL-only: it issues `CREATE DATABASE … default charset utf8mb4`, which
  SQLite rejects with a syntax error and Casdoor turns into a panic. Nothing
  is lost by leaving it off — `/server` creates the tables and seeds the
  built-in organisation on an empty volume either way.

### "database is locked"

Casdoor on SQLite hits `SQLITE_BUSY` under nothing much at all — adding a
user, changing a password — and turns it into a panic rather than a retry, so
the admin UI answers 500 while the container stays up. It is a default
problem, not a load problem: xorm holds a connection pool, SQLite takes one
writer, and Casdoor's own DSN asks for shared cache, which makes contention
worse.

The DSN in `docker-compose.yml` answers all of it:

| | |
| --- | --- |
| `_pragma=journal_mode(WAL)` | readers do not block the writer |
| `_pragma=busy_timeout(10000)` | wait and retry rather than fail at once |
| `_txlock=immediate` | take the write lock up front — the deferred-to-write upgrade is the one deadlock no timeout retries its way out of |
| no `cache=shared` | shared cache turns file contention into table contention, which `busy_timeout` does not cover |

WAL leaves `casdoor.db-wal` and `casdoor.db-shm` beside the database. Both
belong there; a backup that takes only the `.db` is not a backup.

## Registering the clients

**Readers do not belong in the `built-in` organization.** Every member of it
has full Casdoor admin rights, and this is a site people sign themselves up
for — so the first thing to make is an organization of their own, with both
applications under it. Users belong to the organization rather than to an
application, which is what lets one sign-in serve both clients.

Once readers exist, **the console's own login is at
`https://$CASDOOR_HOST/login/built-in`.** Casdoor sends an unauthenticated
visitor to `/login/${lastLoginOrg}`, out of `localStorage`, so a browser that
last signed in as a reader offers the `tufteseid` organization's login page
and reports the admin account as unknown. The value is per-browser: the
organization-specific URL, or `localStorage.removeItem('lastLoginOrg')`, is
the way back.

Both applications are made in Casdoor's console, and both hand back a client
id and a secret.

| Client | Redirect URI |
| --- | --- |
| PocketBase | `$PUBLIC_ORIGIN/pb/api/oauth2-redirect` |
| Remark42 | `$PUBLIC_ORIGIN/remark42/auth/tufteseid/callback` |

Both are on the **app's** origin, not Casdoor's: a redirect URI is where the
reader is sent back to.

Casdoor answers a reader it already knows with a *Continue with …* panel
rather than a redirect, which would make the comment engine's leg a second
click. Remark42's authorize URL carries `silentSignin=1` to turn that off for
that client alone, so the app can run the leg in a hidden iframe
(`docs/discussion-and-votes.md`). The app's own leg keeps the panel — drawn
inside the sign-in box like everything else Casdoor shows there: it is also
*Or sign in with another account*, and it is the only way to change who a
shared browser is signed in as. `enableAutoSignin` on the application in
Casdoor's console would do the same thing for both, and take that away.

The panel only appears at all when the reader's organization matches the
application's, which is another reason both applications belong under the
readers' organization rather than `built-in`.

Remark42's path segment is its `AUTH_CUSTOM_NAME`, so the two have to be
changed together. The name must match `^[a-z0-9][a-z0-9_-]*$` and must not
collide with one of the built-in provider names.

The Remark42 pair goes in `.env` (`REMARK42_OIDC_CID`, `REMARK42_OIDC_CSEC`).
The PocketBase pair is typed into PocketBase's own admin UI: Collections →
`users` → Edit collection → Options → OAuth2 → the generic `oidc` provider,
pointed at `https://$CASDOOR_HOST/.well-known/openid-configuration`. Provider
config is not versioned in `pb_migrations/`, so it is set by hand on each host
and the `displayName` typed there is the button text `AuthDialog` renders.

## The sign-in box

The reader never leaves the page to sign in. The account button opens one
Mantine modal, and that modal holds Casdoor's own login page in a frame
(`src/auth/AuthDialog.tsx`).

What makes the frame possible is that **PocketBase's popup is optional**.
`authWithOAuth2` opens a window only when it is not given a `urlCallback`;
given one it hands the authorize URL over and waits, and the code arrives from
`/pb/api/oauth2-redirect` over PocketBase's realtime channel rather than
through `window.opener`. Nothing in the round trip cares whether it happened
in a window.

Four things follow from that:

- **One provider means no choice to make**, so the box starts the trip as it
  opens rather than asking the reader to press a name first. Two or more and
  it lists them. After a failure the list comes back either way, because
  pressing a provider is also how the trip is retried.
- **Closing the box does not cancel it.** The OAuth2 state, the realtime
  subscription and the promise waiting on it all outlive the modal, so
  reopening puts the same authorize URL back in the frame instead of starting
  a second trip.
- **Two CSP directives hold it up**, and they are on opposite hosts:
  `frame-src` on the app's policy names `$CASDOOR_HOST`, and the Casdoor block
  in `Caddyfile` answers with `frame-ancestors 'self' $PUBLIC_ORIGIN`. The
  second is new protection rather than a concession — Casdoor sends no framing
  header at all, so until it was added the one page on the stack where a
  password is typed could be embedded by anybody.
- **The frame can still be refused**, by a browser that partitions its
  cookies or a Casdoor that is not same-site with the app. Under the box is a
  link that opens the same authorize URL in a window; the code comes back on
  the same channel.

### Its looks are Casdoor's to set

The frame is cross-origin, so no stylesheet in the app reaches inside it. Two
fields in Casdoor's console do, and like the OAuth2 provider config they are
typed in by hand on each host:

- **Application → Theme** — dark, primary colour `#ff8b3d`, border radius 6.
  That is papaya 5 and `md` out of `src/ui/theme.ts`.
- **Application → Form CSS** — raw CSS, no `<style>` wrapper, Casdoor adds
  one:

  ```css
  body,
  .login-content,
  .login-panel {
    background: transparent;
    box-shadow: none;
  }
  .login-panel {
    padding: 0;
  }
  .login-form {
    width: 100%;
    padding: 0;
  }
  ```

  `.login-panel` and `.login-form` are the two containers Casdoor documents.
  The logo above them and the language footer below go by whatever selector
  the browser's inspector shows in the version installed.

The frame's height is fixed at 460 px in `AuthDialog.module.css` because a
cross-origin frame cannot be measured from outside. A form that outgrows it
scrolls inside itself, and that number is the thing to change.

Two limits worth knowing before reaching for any of this:

- **Form CSS does nothing in Casdoor 4.x** (casdoor/casdoor#5800): the fields
  save and the pages ignore them. One more thing the 3.119.0 pin is holding.
- **The form speaks English.** 3.119.0 ships eleven UI locales and Norwegian
  is not among them, so the only user-visible strings in the app that are not
  `nb` are the ones inside this frame.

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
