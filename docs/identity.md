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
subdomain of the app's host rather than a domain of its own for a reason: the
comment threads' silent leg runs Casdoor inside a frame on the app's page, and
only a Casdoor that is *same-site* with the app keeps its own cookies there.
On a registrable domain of its own the browser counts them third-party and the
leg falls back. It is **not** a second listener: it
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
(`docs/discussion-and-votes.md`). The app's own leg keeps the panel, on
Casdoor's page like everything else the reader sees there: it is also *Or sign
in with another account*, and it is the only way to change who a shared
browser is signed in as. `enableAutoSignin` on the application in
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

## Signing in

**The reader leaves the page.** The account button opens one Mantine modal —
a line on why an account is wanted and a button per provider — and pressing a
provider hands the browser to Casdoor's own login page on `$CASDOOR_HOST`.
Casdoor sends them back to `$PUBLIC_ORIGIN/auth/callback` carrying an
authorization code, and `src/auth/trip.ts` trades it for a session before
React mounts.

What makes leaving affordable is that **the whole view is already in the URL**.
A trip stores the address it left from in `sessionStorage` beside the PKCE
verifier and the `state`, and puts it back with `history.replaceState` on the
way in — so the reader returns to the map they left, at the zoom and with the
layers and the open spot they had. Nothing else in the app has to know a trip
happened.

Three things follow from the order that happens in:

- **The restore runs before the app is imported.** Several modules take a boot
  value off the address bar as they are evaluated — `src/spots/shareLink.ts`
  reads `lok` at import — and on the way back the address bar is the
  callback's. So `src/mainApp.tsx` awaits `completeSignIn` and only then
  imports `App`, dynamically: a static import is hoisted above any statement
  that could fix the URL first.
- **`/auth/callback` needs a matcher of its own** in `Caddyfile`. There is no
  SPA fallback here — `/l/<code>` is a narrow `redir` on purpose, so that a
  wrong path still 404s rather than answering 200 with the app. The callback
  is a `rewrite` to `/index.html`, and the path is registered in Casdoor,
  which matches it exactly, so the two move together.
- **Nothing rests on the realtime channel.** PocketBase's other two OAuth2
  legs — a popup and a framed form — both wait for the code to arrive over
  `/pb/api/realtime`, which makes signing in fail outright if anything
  fronting the stack times an idle stream out, and PocketBase closes an idle
  one itself after five minutes. A code on the query string has no such
  clock. The stream still carries finished renders, so the
  `proxy_read_timeout` advice in `README.md` stands — it no longer decides
  whether anybody can sign in.

**Casdoor is still framed, for the threads.** The comment engine's silent
sign-in leg runs its own round trip in a hidden iframe
(`src/api/remark42.ts`), so `frame-src https://$CASDOOR_HOST` on the app's
policy and `frame-ancestors 'self' $PUBLIC_ORIGIN` on the Casdoor block both
stay, and `CASDOOR_HOST` is still a subdomain of the app's host rather than a
domain of its own — on one of those the frame's cookies count as third-party
and the leg falls back to the widget's own button. Signing in to the app
depends on none of it.

**A trip that comes back without a session says so.** No `code`, a `state`
that does not match the one that left, or an exchange that fails or runs past
its 15 s deadline, and the box comes back up on the reader's own page with
`auth.signInFailed` on it — otherwise nothing would show they had tried. A
cold visit to `/auth/callback` with no trip in `sessionStorage` is not a
failure: it restores to `/` and says nothing.

### Its looks are Casdoor's to set

The login page is Casdoor's own page on Casdoor's own host, so no stylesheet
in the app reaches it and the reader sees `$CASDOOR_HOST` in the address bar
for the length of the form. What is worth setting is what keeps it from
reading as a different product.

**The dark algorithm is not the application's to set.** The theme below
decides `colorPrimary` and `borderRadius`, but light-versus-dark comes off
`?theme=dark|default` in the URL, is remembered in that origin's
`localStorage`, and is light when neither says otherwise — `themeType` on the
application never reaches it. So `src/auth/trip.ts` appends `theme=dark` to
the authorize URL; without it the reader lands on a white form with a papaya
button in it. It sticks, which is why Casdoor's own console turns dark for
whoever signs in here — `?theme=default` on the console URL puts it back.

The rest is per application, typed in by hand on each host like the OAuth2
provider config. All of it lives on one tab of the application editor —
`https://<CASDOOR_HOST>/applications/admin/<application>#ui-customization`,
`admin` being the application's *owner* rather than the organization it
serves. Header HTML, Page HTML and Footer HTML look like one-line text inputs
and have no Edit button beside them: clicking the input is what opens the code
editor.

- **Theme** — primary colour `#ff8b3d`, border radius 6: papaya 5 and `md` out
  of `src/ui/theme.ts`. Set *Theme type* to dark as well, so the console
  previews what the reader sees, but it is the URL above that does the work.
- **Logo** — on the application's first tab, and it is the app's own mark that
  belongs there rather than Casdoor's default. It is the one piece of the page
  a reader will read as branding.
- **Header HTML** — the block below, and note the **`<style>` tag is part of
  it**: the field's contents are appended to `document.head` as markup, so
  bare CSS pasted in there is inert text that changes nothing and reports
  nothing.

  ```html
  <style>
    body {
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    }
    .login-button,
    .signup-button {
      color: #1f2628;
      font-weight: 600;
    }
  </style>
  ```

  The papaya button is painted anthracite because antd would put white on it
  and papaya 5 is too light to read white on — the app's own buttons get the
  same treatment from `autoContrast`. Mulish cannot cross the origin: it is
  served under a hashed filename by Vite, so there is no stable URL for an
  `@font-face` here and the page runs on the rest of the stack.

  Header HTML rather than the application's **Custom CSS** field — `formCss`,
  on the tab below, and not to be confused with the Custom CSS a signin *item*
  carries — because Casdoor renders that one behind
  `inIframe() || isMobile() ? null : …`, along with the background image and
  the form offset. Unframed it finally works, and then vanishes on a phone.
  Header HTML runs with no check at all and on every entry page, which also
  makes it the only hook that reaches the signup page and the "Continue with …"
  panel.

- **Signin items → Languages** and **Signup items → Languages** — clear
  *visible* in the two tables higher up the same tab. One language needs no
  picker. The Signup items table only appears at all while sign-up is enabled.

Two limits worth knowing before reaching for any of this:

- **The application's Custom CSS does nothing in Casdoor 4.x either**
  (casdoor/casdoor#5800), framed or not. Whether Header HTML survives that
  version is untested. One more thing the 3.119.0 pin is holding.
- **The form speaks English.** 3.119.0 ships eleven UI locales and Norwegian
  is not among them, so the only user-visible strings in the whole sign-in
  flow that are not `nb` are the ones on Casdoor's page.

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
