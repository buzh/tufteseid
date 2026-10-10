# The closed beta

While the beta is shut, a `users` row is only created for somebody who takes
one of a fixed number of free places or presents an invite code. Everything
else is unchanged: the map and the public spots are open to a guest as they
always were, and existing accounts are never re-checked.

```
registration   one row: openSlots, closed
invites        one row per code: issuer, redeemedBy, redeemedAt, email, sentAt
users          + inviteQuota, invitesSent
```

## Where it is enforced

`pocketbase/pb_hooks/closed_beta.pb.js`, on `onRecordCreateRequest` over
`users`, with the logic in `closed_beta.js` beside it for the reason under
*Deploying a change here*. Not in an API rule:

- Every account comes into being through the **record-create API** on
  `users` — registration is the SPA posting a row — so one hook there covers
  all of them.
- A rule cannot **count** rows or decrement a counter, which is what both
  halves of this need.
- The handler wraps the create in a **transaction**, so the counter is spent
  and the row written together or not at all. Without it a refusal thrown
  after the write would leak a free place.

An administrator adding somebody by hand is not a registration, so a request
carrying superuser auth skips the gate. The same request skips
`pb_hooks/identity.pb.js`, which is what pins `role` and the invite counters
on everybody else's row (`docs/identity.md`).

### What pays for an account

**The two ways in are independent.** Free places are for whoever walks up to
the page; an invite is a way in of its own and never looks at the counter. So
handing out fifty codes is handing out fifty possible accounts whatever
`openSlots` says, even at zero — that arithmetic is yours to do, not the
gate's.

1. `closed` is false, or the `registration` row is missing altogether — the
   beta is over or was never set up, everybody is admitted and nothing is
   spent. The hook and `src/api/invites.ts` read a missing row the same way
   on purpose: the alternative is a sign-in box that shows no gate while
   every registration behind it dies.
2. A code was submitted: it is spent and the reader admitted, or, if it does
   not resolve to an unspent invite, they are **refused** rather than fallen
   back on a free place. Admitting on a mistyped code would leave the reader
   believing it had worked and spend a place they did not ask for.
3. No code: a free place is spent if one remains, otherwise refused.

The code travels from the sign-in box as the `X-Invite-Code` **header** on the
create, not as a field on the record (`src/auth/session.ts`). It pays for the
row rather than belonging to it, and a header is what a hook can read on a
request whose body is the collection's to validate.

An invitation link is `?invite=<code>` on the app's own origin — no Caddy
route, unlike `/l/<code>`. Following one opens the sign-in box on its *Lag ny
konto* half with the code filled in and says why, and the parameter stays on
the URL until the box is dismissed or the account is made: the box is the only
place the code can be spent, and a reload before the reader gets that far must
not be what loses it. A reader who already has an account is just following a
link to the map, so the parameter is dropped on arrival instead. The box shows
nothing about free places to somebody holding a code — an invite never looks
at the counter, and *they are all taken* reads as a refusal to a reader who
has been let in.

A refusal costs the reader nothing: it is one 403 on the form they are still
looking at, with the code still in the field to be corrected. The box reads
the reason off the `ValidationError` under `invite`, which is the only shape
PocketBase passes through to the client intact.

Codes are eight characters of Crockford base32, the alphabet `spots.code`
already uses: no I, L, O or U, so a code read aloud cannot be mistyped into a
different valid one. The hook folds I and L onto 1 and O onto 0 on the way in.

## Invites

`users.inviteQuota` is how many invites an account may ever mint. What is left
to mint is the quota less the rows it has issued, so **revoking an unspent
invite gives the quota back**. A spent one cannot be revoked — the delete rule
refuses it — because it is the record of an admission.

The same number caps how many invite mails the installation will send on that
account's behalf, counted separately on `users.invitesSent` because that one
must not refund — see *Mailing an invite*.

`redeemedAt` rather than `redeemedBy` is what says an invite is spent:
`redeemedBy` empties if the invitee later closes their account, and an invite
must not look unused again.

A reader mints, copies and sends from the account menu → *Invitasjoner*.

## Running the SQL

PocketBase keeps its SQLite on the `pbdata` volume and the image carries no
`sqlite3`, so reach it from a throwaway container:

```
docker run --rm -it -v tufteseid_pbdata:/pb_data alpine:3.20 \
  sh -c 'apk add --no-cache sqlite && sqlite3 /pb_data/data.db'
```

It is safe to do this with the stack up — these are record writes, and
PocketBase caches collection definitions rather than rows. Two things follow
from doing it behind PocketBase's back, though: no realtime event is sent, and
a signed-in reader sees a changed `inviteQuota` only after their next
`authRefresh`, which is their next page load.

`data.db-wal` and `data.db-shm` belong beside `data.db`; a backup that takes
only the one file is not a backup.

### Opening places

```sql
-- Fifty free registrations, first come first served.
UPDATE registration SET openSlots = 50;

-- How many are left.
SELECT openSlots, closed FROM registration;

-- End the beta: everybody may register, invites stop mattering.
UPDATE registration SET closed = 0;
```

`closed` is a boolean column; SQLite takes `0`/`1` and `false`/`true` alike.
The migration seeds `openSlots = 0, closed = 1`, so the first boot after it
lands stops new registrations until this is run. That is the safe direction
for a gate to fail in.

### Granting invites

```sql
-- Everybody gets one.
UPDATE users SET inviteQuota = COALESCE(inviteQuota, 0) + 1;

-- One person gets five.
UPDATE users SET inviteQuota = COALESCE(inviteQuota, 0) + 5
WHERE email = 'navn@example.org';

-- One each to anybody whose spots have drawn more than 100 upvotes, unless
-- they already have three or more to give out.
UPDATE users
SET inviteQuota = COALESCE(inviteQuota, 0) + 1
WHERE (
        SELECT COUNT(*)
        FROM votes v
        JOIN spots s ON s.id = v.spot
        WHERE s.owner = users.id AND v.direction = 'up'
      ) > 100
  AND COALESCE(inviteQuota, 0)
      - (SELECT COUNT(*) FROM invites WHERE issuer = users.id) < 3;
```

*Available* is the quota less **every** row the account has issued, spent or
not — the same arithmetic the panel shows, so the third recipe will not top up
somebody sitting on three unsent codes.

### Seeing where they went

```sql
SELECT u.email,
       COALESCE(u.inviteQuota, 0)                                AS quota,
       COUNT(i.id)                                               AS minted,
       SUM(CASE WHEN i.redeemedAt != '' THEN 1 ELSE 0 END)       AS spent,
       COALESCE(u.inviteQuota, 0) - COUNT(i.id)                  AS available,
       COALESCE(u.invitesSent, 0)                                AS mailed
FROM users u
LEFT JOIN invites i ON i.issuer = u.id
GROUP BY u.id
HAVING quota > 0 OR minted > 0
ORDER BY available DESC, minted DESC;
```

`mailed` is the only one of these that cannot go down by itself. Giving
somebody their letters back after a run of bad addresses is a deliberate act:

```sql
UPDATE users SET invitesSent = 0 WHERE email = 'navn@example.org';
```

```sql
-- Who came in on whose invite.
SELECT issuer.email AS inviter, invitee.email AS joined, i.redeemedAt
FROM invites i
JOIN users issuer ON issuer.id = i.issuer
LEFT JOIN users invitee ON invitee.id = i.redeemedBy
WHERE i.redeemedAt != ''
ORDER BY i.redeemedAt DESC;
```

## Mailing an invite

`POST /pb/api/invites/{id}/send` takes `{ "email": "…" }` and is the only way
the row's `email` and `sentAt` are ever written. **One mail per invite**, and
**`inviteQuota` mails per account**, counted on `users.invitesSent`.

The second limit is what makes the first one mean anything. The mint quota
cannot double as a mail budget, because revoking refunds it: mint → send →
revoke → mint posts as many letters as the sender likes, to addresses of
their choosing, from the installation's own `From:`. `invitesSent` only ever
goes up, so a reader who mistyped the address still revokes, mints and sends
again — at the cost of one letter from the budget — but nobody gets an open
relay out of it. A letter SMTP refuses outright is refunded; an address that
simply bounces later is not, since nothing here hears about it.

The address is saved to the row **before** the mail goes out, so the
`EmailField` validator is what judges it and what SMTP is handed is exactly
what the row holds. A second send against the same invite answers 400 off
`sentAt`.

Three settings in PocketBase's admin UI have to be right, none of them
versioned in a migration:

| Setting | Why |
| --- | --- |
| *Mail settings* → SMTP | Without it PocketBase falls back to `sendmail`, which the alpine image does not have, and every send answers 502 |
| *Application* → Application URL | The redeem link in the mail is composed from it |
| *Mail settings* → sender address and name | The `From:` header |

A 502 reaches the reader as *"E-post er ikke satt opp på denne
installasjonen. Send koden selv."* — the invite is still good to pass on by
hand, which is the point of showing the code.

The mail's Bokmål lives in the hook rather than in `src/locales/`: it is
composed on the server, where the locale files do not reach, and letting the
client post the wording would turn the route into a relay for whatever it
liked.

## What the gate does not cover

**The free places are first come, first served, and unthrottled.** Nothing
here rate-limits the create or verifies an address before spending a place, so
a script can take every open slot in one pass. That is the trade of having
free places at all; with `openSlots` at zero and invites the only way in, it
does not arise. PocketBase's own rate limiter is the lever if it does.

**A refused reader leaves nothing behind.** The create is refused inside a
transaction, so there is no half-made account to clean up and no address held
against a second attempt — somebody turned down today can register with the
same address the moment a place opens or a code reaches them.

## Deploying a change here

`pb_hooks` is bind-mounted read-only and the watcher is off, so editing a hook
needs `docker compose restart pocketbase` — the same rule migrations already
carry. The symptom of forgetting is a gate that still behaves the old way with
no error anywhere.

**A handler cannot see the scope of the file it is written in.** PocketBase
serializes each one and runs it in a runtime of its own, so a constant or a
helper declared at the top of a `.pb.js` file is simply not there inside its
own handlers. That is why `closed_beta.pb.js` holds nothing but the three
registrations and every one of them starts with
`require(\`${__hooks}/closed_beta.js\`)`. The globals — `$app`, `$dbx`,
`$security`, `MailerMessage`, `DateTime`, the error classes — are injected
into every runtime and are the exception. The `.js` suffix on the module
matters too: `*.pb.js` is what PocketBase loads as hooks.

Nothing warns you. The file loads, the handler registers, and the first
request raises `ReferenceError: X is not defined` — which reaches the client
as a bare `400` with `"data": {}` and no field named, and reaches you only in
the admin UI's *Logs*, not on stdout. Any uncaught throw in a handler looks
like that, so a bare 400 with an empty `data` is the shape to recognize.

**A record event does not carry `e.request`.** A route event does, which is
what the examples use; `onRecordCreateRequest` hands you a
`RecordRequestEvent` where it is undefined, whatever the generated types say.
Headers come off `e.requestInfo().headers`, keyed by
`inflector.Snakecase` — `X-Invite-Code` is `x_invite_code`, the same
normalization as `@request.headers.*` in a collection rule.
