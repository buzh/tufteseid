# Identity

One account, held by PocketBase: an email address, a password it hashes
itself, and the `users` row every collection rule is written against. There is
no identity provider, no redirect and nothing to federate to.

## Signing in

**Nothing leaves the page.** The account button opens one Mantine modal,
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

Four fields on it are **not the reader's to set**, and it takes two mechanisms
to hold that — one at create, one after:

| field | what it decides |
| --- | --- |
| `role` | `admin` reaches every spot in the register |
| `features` | what this account may spend (below) |
| `inviteQuota` | how many invites it may ever mint |
| `invitesSent` | how many letters it has posted |

- **At create**, `pb_hooks/identity.pb.js` pins all four: `role` to `user`,
  `features` to empty, the counters to zero. It has to, because registration
  is a plain record create against an open create rule and *a collection rule
  cannot name a field* — without the hook, a POST carrying `role: "admin"`
  would be honoured. A superuser create is left alone, so adding somebody by
  hand in the admin UI still chooses the whole row.
- **After create**, `1700002200_users_not_self_writable.js` takes the update
  rule away entirely. Nothing in the SPA has ever PATCHed a user row. A
  superuser and a hook save records directly and are not held by an API rule,
  so the admin UI and `pb_hooks/` are the only two ways any of the four moves.

**Granting a rank or a feature is an admin-UI edit**: Collections → `users` →
the row → `role`, or an entry on the `features` array. It takes effect on the
reader's next `authRefresh`, which is their next page load — not their next
sign-in.

### Membership and what it may spend

Some of what the app can do costs the installation real money — a server-side
render is minutes of CPU — so it is not every account's to ask for.
`users.features` is a list of names, `render` being the only one so far, and
`src/auth/features.ts` is where the client side of it lives.

**Enforcement is where the cost is, not in a collection rule.** An `evidence`
row is parameters, and parameters cost nothing until something renders them —
so `rendersvc` reads the caller's own row and refuses (`docs/render-sidecar.md`).
The SPA hides what would only meet that 403: the two order chips, and the
gallery's retry on a row that renders on the server. A courtesy, not a gate.

**An administrator holds every feature.** `src/auth/features.ts` and
`rendersvc/server.py` both say so, so that a `features` entry nobody
remembered to grant cannot lock an installation out of its own renders.

**Pictures already rendered stay readable to everybody who can see the spot**,
guests included. A feature decides what may be *made*, never what may be
looked at — the same rule a service follows (`docs/architecture.md`).

### `name` is what gets the credit

The reader may type a display name when they register, and `spots.credit` is
denormalized from it at save time rather than joined: `users` is closed to a
guest, so a public spot's author could not otherwise be shown to one. A reader
who renames themselves does not rename the credit on spots already saved.

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

## The closed beta sits on top of this

Who may hold an account at all is a separate mechanism, enforced in
`pb_hooks/closed_beta.pb.js` on the same create this file's hook pins:
`docs/closed-beta.md` has the whole of it. The two compose in one order —
`closed_beta` decides *whether* the row is written, `identity` decides *what is
on it*.
