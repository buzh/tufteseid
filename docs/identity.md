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

### Where the sessions live

The database on `/data` is not the whole of Casdoor's state. Beego keeps the
SSO sessions as files under `./tmp` and the image's `WORKDIR` is `/`, so left
alone they land on the container's writable layer: the cookie promises up to
30 days and the state behind it lasts until the next recreate — a pin bump, an
`.env` edit, a `down`, a reboot. `casdoortmp:/tmp` in `docker-compose.yml` is
what makes the two agree. Losing it signs every reader out of the identity
provider at once while leaving them signed in to the app, so what it looks
like from the outside is the threads asking for a password that nothing else
asks for.

Neither path is configurable. `./tmp` is fixed against the working directory,
and the working directory cannot move either — `./conf/app.conf`,
`./web/build` and the log file are all relative to it as well. Setting
`redisEndpoint` puts the sessions in Redis instead, at the cost of a
container.

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
| PocketBase | `$PUBLIC_ORIGIN/auth/callback` |
| Remark42 | `$PUBLIC_ORIGIN/remark42/auth/tufteseid/callback` |

Both are on the **app's** origin, not Casdoor's: a redirect URI is where the
reader is sent back to. PocketBase's is the SPA's own route rather than
anything under `/pb/` — the app takes the code off the query string itself and
trades it (`CALLBACK_PATH` in `src/auth/trip.ts`), so the two have to be
changed together.

**Tick *Signin session* on both of them** — the switch is labelled that, not
*Enable signin session*, and it sits directly above *Auto signin* on the
application's first tab. A new application has it
off, and off means Casdoor hands back an authorization code without
remembering anybody: `EnableSigninSession` is what decides whether the
authorize leg calls `SetSessionUsername`, so there is no SSO session for a
second client to find and no reader is ever *already signed in*. One identity
provider still serves both clients — it just asks for the password again every
time, which is the whole thing Casdoor was added to stop. The app's own leg
meets the login form on every visit, the threads' silent frame meets it in a
place nobody can type into, and `silentSignin=1` suppresses a panel that was
never going to be drawn.

**Nothing outside Casdoor can read the setting back.** Both redirects are the
right shape either way, and `GetMaskedApplication` forces
`EnableSigninSession` to false for every caller who is not that application's
own admin — along with `EnablePassword`, `EnableWebAuthn`,
`EnableLinkWithEmail`, `RedirectUris` and `TokenFields` — so
`/api/get-app-login` reports it off whatever it is, and a config read from
outside says nothing about any of them. The check is to sign in and ask
`/api/get-account`: a session, or *Please login first*.

The session then lasts the application's *Cookie expire in hours* — 720 where
it is left at zero — except that Casdoor caps it at 24 for a reader who
unticks *Auto sign in* on the form.

The two switches are interlocked, which is the one thing that can be read
from outside: the console refuses *Auto signin* while *Signin session* is
off, and turning *Signin session* off switches *Auto signin* off with it. So
an application reporting `enableAutoSignin` true — that field is not
masked — had *Signin session* on when it was last saved.

Casdoor answers a reader it already knows with a *Continue with …* panel
rather than a redirect, and nothing here wants one: a sign-in already made
should cost no clicks at all. **Tick *Auto signin* on both applications**, and
such a reader is sent straight back with a code and never sees Casdoor's page.
Remark42's authorize URL carries `silentSignin=1` to the same end for the leg
that runs in a hidden frame, where nobody could press a button anyway
(`docs/discussion-and-votes.md`).

The panel is also *Or sign in with another account*, and turning it off is
therefore only safe because signing out ends Casdoor's session too. Changing
who a shared browser belongs to is signing out and signing back in, and the
reader needs to know nothing beyond that — see *Signing out* below, which is
what makes it true.

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
and the `displayName` typed there is the button text `AuthDialog` renders —
*Fortsett med …*, so the provider's own `OIDC` left in place puts a protocol
name in front of the reader.

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

**An identity is not an account.** While the closed beta is shut, PocketBase
creates the `users` row only for a reader who takes a free place or presents
an invite code, and the box asks for one before the reader leaves
(`docs/closed-beta.md`). Casdoor's own sign-up stays open either way: the
identity is made before the app ever sees it, so closing sign-up there would
close it for invited readers too. Somebody refused by the gate keeps their
Casdoor identity and can sign in later with a code.

**Casdoor is still framed, twice.** The comment engine's silent sign-in leg
runs its own round trip in a hidden iframe (`src/api/remark42.ts`), and
signing out ends Casdoor's session in another (`src/auth/casdoor.ts`). So
`frame-src https://$CASDOOR_HOST` on the app's policy and
`frame-ancestors 'self' $PUBLIC_ORIGIN` on the Casdoor block both stay, and
`CASDOOR_HOST` is still a subdomain of the app's host rather than a domain of
its own — on one of those the frames' cookies count as third-party, the
sign-in leg falls back to the widget's own button and the sign-out reaches a
Casdoor that cannot see the session it was sent to end. Signing in to the app
depends on neither frame.

**A trip that comes back without a session says so.** No `code`, a `state`
that does not match the one that left, or an exchange that fails or runs past
its 15 s deadline, and the box comes back up on the reader's own page with
`auth.signInFailed` on it — otherwise nothing would show they had tried. A
cold visit to `/auth/callback` with no trip in `sessionStorage` is not a
failure: it restores to `/` and says nothing.

### Signing out

**Three sessions end, and the app's own goes last.** Remark42's first,
because the thread box re-creates its widget the moment the auth store
changes and one created while that cookie is still there shows the reader as
signed in to a site they have just left. Casdoor's in the same breath rather
than after it: the two are unrelated round trips and a sign-out should be one
wait, not two. `src/auth/hooks.ts` holds the order.

Casdoor's leg is `GET /api/logout` on its own hostname with no parameters at
all. Without an `id_token_hint` Casdoor ends whatever session the cookie
names, which is the one thing wanted here, and asks for no registered
post-logout URI — so neither application needs one. It runs in a hidden frame
because the app's CSP names `$CASDOOR_HOST` under `frame-src` and not under
`connect-src`; widening `connect-src` for a single request is the worse
trade. The origin is read off the authorize URL in `listAuthMethods()` rather
than configured, since `CASDOOR_HOST` already lives in `.env` and in
`Caddyfile` and a third copy is one that can drift.

**This is what keeps a shared browser honest.** *Auto signin* means a reader
Casdoor remembers never sees a form, so if its session outlived the app's
then signing out and back in would return the same account and there would be
no way at all to become somebody else. Ending all three is what makes *sign
out, sign back in* mean what a reader expects it to, with nothing else for
them to know.

A sign-out that cannot reach Casdoor still clears both sessions on this side.
What it leaves is an identity provider holding a session the app walks back
into on the next sign-in, silently — the one failure here worth recognising,
and `$CASDOOR_HOST/api/get-account` is what answers it.

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
the authorize URL, and the threads' authorize URL carries it from
`AUTH_CUSTOM_AUTH_URL` in `docker-compose.yml` because nothing in the app
composes that one. Without it the reader lands on a white form with a papaya
button in it. It sticks, which is why Casdoor's own console turns dark for
whoever signs in here — `?theme=default` on the console URL puts it back.

The rest is per application and wants doing **twice**, typed in by hand on
each host like the OAuth2 provider config. The threads' application is the
one easiest to forget and the easier one to meet: a reader whose silent leg
did not take is sent to its form from inside the thread box, and an
application left at its defaults draws Casdoor's own cube on a white page.
All of it lives on one tab of the application editor —
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

## The `users` row is a mirror

The row cannot go away. `spots.owner`, `evidence.owner`, `votes.owner` and
`invites.issuer` are all relations to it, every collection rule is written
against `@request.auth.*`, and PocketBase can only judge a record of its own —
there is no way to authorize a request against a foreign token. What the row
can stop being is a second place a fact about a reader is *decided*.

**`role` comes from Casdoor.** Its userinfo response lists the reader's role
*names* under the `profile` scope, which PocketBase's OIDC provider already
asks for, and PocketBase keeps the whole response on `oAuth2User.rawUser`.
`pb_hooks/identity.pb.js` reads it on every sign-in: a reader in a Casdoor role
named `admin` is an administrator here, and an administrator is made and unmade
in Casdoor's console.

It is a mirror rather than a merge, and that is forced. Casdoor leaves `roles`
out of the response altogether for a reader holding none, so no handler can
tell an identity provider with no roles configured from a reader with none.
An account Casdoor does not call an administrator therefore stops being one
here at its next sign-in, whatever the row says and whoever typed it. Two
things follow:

- **Make the role in Casdoor before restarting PocketBase with the hook.**
  Under the readers' organization, named `admin`, with whoever should keep the
  rank in it. Forget, and every administrator is demoted at their next
  sign-in. The way back is to make the role and sign in again — PocketBase's
  superuser account is a different thing entirely and is not touched by any of
  this.
- **Editing `role` in PocketBase's admin UI no longer holds.** It survives
  until the reader next signs in and is then overwritten.

### Membership and what it may spend

Some of what the app can do costs the installation real money — a server-side
render is minutes of CPU — and is therefore not every account's to ask for.
Casdoor already models that, so nothing here invents a second scheme:

| In Casdoor | Here |
| --- | --- |
| a **role** | a membership tier: `normal`, `member`, `vip`, `pro`, whatever the installation wants |
| a **permission** | a gated feature, named — `render` is the only one so far |
| the permission's *Roles* list | which tiers hold that feature |

Userinfo under the `profile` scope carries `permissions` beside `roles`, as a
flat list of permission **names**, and Casdoor resolves it through direct
assignment, through the reader's roles, through their groups and through role
hierarchy. `pb_hooks/identity.pb.js` writes the list to `users.features` on the
same pass that writes `role`, and it is a mirror on the same terms: nobody's to
edit, rewritten whole on every sign-in, and an account Casdoor stops granting a
permission stops holding it here.

So **re-assigning a feature is a console edit** — open the permission, change
which roles are on it, save. No migration, no deploy, and nothing in this
repository names a tier.

Three things to know before arranging them:

- **The tiers ladder by sub-role, and the containing role is the lower rung.**
  A role lists the roles it *contains*, and a user in a contained role holds
  the container too. So `normal` lists `member`, `member` lists `vip`, `vip`
  lists `pro`, and a `pro` reader resolves to all four — a permission granted
  to `member` is then held by `vip` and `pro` without being listed on either.
  Flat roles work as well if the tiers are not a ladder; grant each permission
  to each role that should have it.
- **A permission is Casbin's object and most of it is unused.** Resources,
  actions and effect have to be filled in to save one and nothing reads them —
  only the name and who holds it crosses to this side. Casdoor applies no
  enabled or state filter either, so a permission switched off is still
  reported: take the roles off it instead.
- **An application's *Token fields*, if set, must list `Permissions`.** Left
  empty, which is the default, every claim is sent.

**A new tier lands at the reader's next sign-in, not at their next load.** The
mirror is written by the OAuth2 handler, and `authRefresh` does not go back to
Casdoor — so an account granted `pro` keeps meeting the old gate until its
Casdoor session is spent, which is up to the application's *Cookie expire in
hours*. Signing out and back in is what collects it, and is worth saying to
whoever is granting the tier.

**The app's own side holds one rule rather than a mirror: an administrator
holds every feature.** `src/auth/features.ts` and `rendersvc/server.py` both
say so, so that a permission nobody remembered to grant cannot lock an
installation out of its own renders.

Which leaves the enforcement, and it is **not** in the collection rules.
`evidence` rows are parameters, and a row costs nothing until something renders
it; the gate therefore sits where the cost is, in `rendersvc`, which reads the
caller's own row to find it (`docs/render-sidecar.md`). The SPA hides what
would only meet that refusal — the two order chips, and the gallery's retry on
a row that renders on the server, which a reader can be left holding from
before the feature moved or from an administrator's render onto their spot. A
courtesy, not a gate. **Pictures already rendered stay readable to everybody
who can see the spot**, guests included: a membership decides what may be
made, never what may be looked at.

**Nobody may write their own `users` row.** PocketBase's stock collection ships
`updateRule = "id = @request.auth.id"`, and a rule cannot name a field — so a
reader could PATCH `role = "admin"` onto themselves, and an administrator
reaches every spot in the register. `1700002200_users_not_self_writable.js`
takes the rule away. Nothing in the SPA has ever written a user row.

**The link is to the Casdoor subject, not to the address.** PocketBase records
the provider and the `sub` in `_externalAuths` and resolves a returning reader
by that pair. An email match is only the fallback for a row carrying no such
link yet — a local account made before Casdoor, which PocketBase then links to
the first identity presenting the same verified address. So a reader changing
their address at the identity provider keeps their spots, and the ambiguity
worth settling before the first sign-in is only ever about rows that predate
the provider.

**`inviteQuota` and `invitesSent` stay here.** They are counters the
installation spends rather than facts about an identity, and a permission
cannot hold a number. They move
by SQL or in the admin UI (`docs/closed-beta.md`), and the rule above is what
keeps them out of the reader's reach.
