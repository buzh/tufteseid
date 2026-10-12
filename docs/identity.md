# Identity

One account, held by PocketBase: an email address, a password it hashes
itself, and the `users` row every collection rule is written against. There is
no identity provider, no redirect and nothing to federate to.

## Signing in

**Nothing leaves the page.** The account button is a menu whether or not
anybody is signed in — a guest's carries *Logg inn* and the size preference
(`docs/architecture.md`) — and *Logg inn* opens one Mantine modal,
`src/auth/AuthDialog.tsx`, which is three modes on a single form:

| mode | what it posts |
| --- | --- |
| *Logg inn* | `authWithPassword` — email and password against `users` |
| *Lag ny konto* | a record create on `users`, then the same `authWithPassword` |
| *Glemt passord* | `requestPasswordReset`, which posts the letter |

`src/auth/session.ts` holds all three and nothing else does. The SDK's
`authStore` is the one source of truth for who is signed in; `src/auth/atoms.ts`
mirrors it into Jotai through `pbAuthSyncEffect` and nothing writes that atom
directly.

**Registering and signing in are one round trip each, in that order.** The
create answers with the record but no token — PocketBase does not authenticate
a collection create — so the dialog signs in immediately afterwards with the
password it still has in hand. A create that succeeds and a sign-in that fails
would leave an account the reader has to sign into by hand, which is the one
seam here; it needs PocketBase to accept a password it has just stored and
refuse it a moment later.

**Password reset needs SMTP**, the same settings the invite mail already uses
(`docs/closed-beta.md`). The route answers 204 whether or not the address is
one we know, so nothing in it can be used to ask whether somebody has an
account, and the box says so in the conditional: *er adressen registrert hos
oss*.

**Verification is not required to sign in.** `1700002500_password_auth.js`
pins the collection's auth rule to empty — any record of it may
authenticate — so a new account works at once, rather than being made and
then refused its own sign-in. Demanding a confirmed address is one admin-UI
edit, `users` → Options → *Authentication rule* → `verified = true`, at the
cost of stranding everybody who registered before it.

### Signing out

`pb.authStore.clear()`, in `src/auth/AuthButton.tsx`. There is no second
session anywhere and nothing to tell: the token is a JWT the client holds, and
dropping it is the whole of it.

## What the `users` row carries

The row cannot go away. `spots.owner`, `evidence.owner`, `votes.owner` and
`invites.issuer` are all relations to it, every collection rule is written
against `@request.auth.*`, and PocketBase can only judge a record of its own.

Three fields on it are **not the reader's to set**, and it takes two
mechanisms to hold that — one at create, one after:

| field | what it decides |
| --- | --- |
| `role` | `admin` reaches every spot in the register; `queued` may not sign in at all (below) |
| `features` | what this account may spend (below) |
| `inviteQuota` | how many invites it may ever mint |

- **At create**, `pb_hooks/identity.pb.js` pins all three: `role` to `user`,
  `features` to empty, the quota to zero. It has to, because registration
  is a plain record create against an open create rule and *a collection rule
  cannot name a field* — without the hook, a POST carrying `role: "admin"`
  would be honoured. A superuser create is left alone, so adding somebody by
  hand in the admin UI still chooses the whole row.
- **On every update**, the same hook puts all three back from
  `record.original()`, which is the row as the database holds it. PocketBase
  loads the request body onto the record *before* a `*Request` hook runs and
  validates it inside `e.next()`, so what the handler sets is what gets saved.
  A superuser edit is left alone the same way.

`1700002200_users_not_self_writable.js` took the update rule away entirely
rather than pin anything, there being no field on the row the reader had any
business setting. `1700002900_user_profile.js` hands it back as
`id = @request.auth.id`, because there are three now (below); the pinning hook
is what pays for that.

**Granting a rank or a feature is an admin-UI edit**: Collections → `users` →
the row → `role`, or an entry on the `features` array. It takes effect on the
reader's next `authRefresh`, which is their next page load — not their next
sign-in.

### Membership and what it may spend

Some of what the app can do costs somebody real money — a server-side render is
minutes of CPU, and a session on the Flyfoto ground is a stream of calls
against an upstream quota the installation does not own — so it is not every
account's to ask for. `users.features` is a list of names, `render` and
`flyfoto` so far, and `src/auth/features.ts` is where the client side of it
lives.

**Enforcement is where the cost is, not in a collection rule.** An `evidence`
row is parameters, and parameters cost nothing until something renders them —
so `rendersvc` reads the caller's own row and refuses (`docs/render-sidecar.md`).
The SPA hides what would only meet that 403: the card's `fx` button with the
two render lines behind it, and the gallery's retry on a row that renders on
the server. A courtesy, not a gate.

**`flyfoto` has no such end, and is the courtesy alone.** The ortofoto tiles
carry the installation's own Norge i bilder token rather than the reader's, so
nothing upstream can tell two accounts apart. What the feature decides is what
the ground switch does: without it the Flyfoto button opens norgeibilder.no in
a new tab over the view on screen instead of entering the ground, the pictures
being that site's to give away (`src/grounds/norgeIBilder.ts`). A hand-written
`?backgroundLayer=flyfoto` still seats the ground, and the archive walk over a
spot's footprint is the *service's* to offer, not the feature's.

**An administrator holds every feature.** `src/auth/features.ts` and
`rendersvc/server.py` both say so, so that a `features` entry nobody
remembered to grant cannot lock an installation out of its own renders.

**Pictures already rendered stay readable to everybody who can see the spot**,
guests included: a feature decides what may be *asked for*, never what a spot
already carries. Flyfoto bends that — browsing an archive is reading, and it is
gated because every pan is another call on the quota — but no evidence row goes
dark for want of a feature.

### `name` is what gets the credit

The reader may type a display name when they register, and `spots.credit` is
denormalized from it at save time rather than joined: `users` is closed to a
guest, so a public spot's author could not otherwise be shown to one. A reader
who renames themselves does not rename the credit on spots already saved.

## Managing the account

The account button's cogwheel opens `src/auth/ProfileDialog.tsx`, one Mantine
modal holding three forms that save one at a time. They are apart because they
cost different things, not for want of room.

| form | what it posts |
| --- | --- |
| *Profil* | a PATCH on the reader's own `users` row: `name`, `description`, `avatar` |
| *E-postadresse* | `POST /pb/api/profile/email`, carrying the new address and the current password |
| *Bytt passord* | a PATCH carrying `oldPassword`, `password`, `passwordConfirm`, then a sign-in |

`src/api/profile.ts` holds all three and nothing else does.

**`name`, `description` and `avatar` are the whole of what a PATCH may move.**
`description` is a 120-character line the reader writes about themselves, new
in `1700002900_user_profile.js`; `avatar` is the stock collection's own file
field, which was always there. Everything else on the row is either pinned
back by the hook or refused by the upsert form.

**Nobody but the reader sees either one yet.** `users` keeps its stock list
and view rules, `id = @request.auth.id`, so nothing can read somebody else's
row — the same closure that has `spots.credit` denormalized. The avatar
appears twice, in the account menu and in the box itself, and both are the
reader's own. Showing an author's picture on a public spot would mean a view
the way `spotScores` is one, and there is no such view.

`avatar` is **unprotected**, like `evidence.file` and for the same reason: an
`<img>` carries no Authorization header, so a protected field would not render
at all. A file URL works for anybody who has it; what the view rule keeps is
that nobody else can find out the filename.

**Changing the address costs the current password, and sends no letter.**
PocketBase will not take `email` on a self-PATCH at all: the upsert form pins
it to the stored value for anything short of manage access, and what it offers
instead is `requestEmailChange` and a confirmation link — the verification
step this installation does not run. `pb_hooks/profile.pb.js` is a route that
does it without one, and the password is what stands in for the letter: with
nothing to confirm, the address is the whole of account recovery, so a
borrowed tab must not be able to move it. The route clears `verified`, which
nothing reads, and leaves the token key alone, so the session survives.

Setting `manageRule` on `users` would have let the SPA PATCH the address
directly and spared the route. It also drops PocketBase's `oldPassword`
requirement on a password change, which is the one guard worth keeping here,
so it stays unset.

**A password change ends every session, the reader's own included.**
PocketBase refreshes the record's token key, so the token in hand dies with
the old password. `changePassword` signs straight back in with the new one;
when that does not land, the dialog closes and the sign-in box opens, because
the account is fine and the session is not.

## Adding an OAuth2 provider later

Not currently wired, and nothing in the SPA draws a button for one — the
dialog is a password form, not a provider list. `1700002500_password_auth.js`
switches `oauth2` off and clears `providers`, which is deliberate: a config
left enabled but unused still answers `listAuthMethods` and still accepts a
code, and `scripts/live-check.sh` asserts that it reports none.

Turning one on again means the admin-UI half (Collections → `users` → Options
→ OAuth2), the migration half, and a button in `AuthDialog.tsx`. Two things
that caught this repository out before, worth writing down:

- **PocketBase's popup and framed OAuth2 flows wait for the code over
  `/pb/api/realtime`.** Anything fronting the stack that times an idle stream
  out makes signing in fail outright, and PocketBase closes an idle one itself
  after five minutes. The redirect flow has no such clock; it needs a
  `/auth/callback` matcher of its own in `Caddyfile`, since `/l/<code>` is a
  narrow `redir` on purpose and there is no SPA fallback to catch anything
  else.
- **A provider links on `sub`, not on the address.** PocketBase records the
  provider and the subject in `_externalAuths` and resolves a returning reader
  by that pair, falling back to a verified email match for a row carrying no
  such link yet. So the accounts that predate the provider are the only ones
  where the match is ambiguous.

## How many may hold a place

`MAXUSERS` in `.env` caps how many accounts this installation seats. **0 is no
cap**, and so is unset, blank, unparseable or negative — a cap has to be asked
for, and there is no reading of a bad value that should lock everybody out.
Compose passes the key to the `pocketbase` service alone;
`pb_hooks/capacity.js` is the only thing that reads it, and the SPA asks
`/pb/api/capacity` rather than being told at build time.

**Being full refuses nobody.** Registration works at the cap exactly as it
does below it, and whatever paid for it — a free place, an invite — is spent
all the same. What changes is the role the row is written with:

- **Under the cap**, `pb_hooks/identity.pb.js` pins `role` to `user` as it
  always did, and the account is seated.
- **At the cap**, it pins `queued` instead. The account exists, owns nothing
  yet, and holds no place.

**A queued account cannot hold a token.** `pb_hooks/capacity.pb.js` hooks
`onRecordAuthRequest`, which every way of getting one comes through — a
password sign-in and an `authRefresh` alike — so a page left open signs itself
out on its next load rather than keeping a session the cap no longer allows.
The refusal is a 403 the sign-in box reads off the `ValidationError` under
`queue`, the same shape the closed beta's two refusals use
(`src/auth/session.ts`).

That is also the one seam in registering: the create succeeds, the
`authWithPassword` straight after it is refused, and the box says *Ingen
ledige plasser, men du er registrert* rather than a failure — because it is
not one. The account is there to come back to.

**Signing in is also how a queue is drained.** The same hook promotes a
queued account to `user` the moment it authenticates with a place free,
whether the place came from `MAXUSERS` going up or from an account going away.
First come, first served: there is no position in the queue and nothing
reserves one, so raising the cap admits whoever comes back soonest rather than
whoever waited longest.

**Queued rows do not count against the cap** — counting them would have the
queue fill the very places it is waiting for — so what `/pb/api/capacity`
reports as `users` is every row that is *not* queued. The sign-in box and the
invite panel both show it as *Nå: 11 brukere av 20 maks*, and say nothing at
all on an installation with no cap.

**Lowering `MAXUSERS` demotes nobody.** Roles only ever move up here; an
installation taken below its own count simply seats nobody new until it is
back under. Raising it costs one sign-in per waiting reader, and nothing
notifies them — there is no mail on promotion.

The count is read and the row written in one transaction, but the registration
count is read before the row it will be written against exists, so two
registrations landing in the same instant can both see the last place. The
window is the same unthrottled one the free places already have
(`docs/closed-beta.md`), and overshooting by one seats one account too many
rather than losing anything.

## The closed beta sits on top of this

Who may hold an account at all is a separate mechanism, enforced in
`pb_hooks/closed_beta.pb.js` on the same create this file's hook pins:
`docs/closed-beta.md` has the whole of it. The two compose in one order —
`closed_beta` decides *whether* the row is written, `identity` decides *what is
on it*, the user cap above being one of the things it decides. That order is
load order, which is alphabetical by filename, and the cap's count has to be
taken inside the transaction `closed_beta` opened.
