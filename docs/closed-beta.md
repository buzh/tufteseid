# The closed beta

While the beta is shut, a `users` row is only created for somebody who takes
one of a fixed number of free places or presents an invite code. Everything
else is unchanged: the map, the public spots and their threads are open to a
guest as they always were, and existing accounts are never re-checked.

```
registration   one row: openSlots, closed
invites        one row per code: issuer, redeemedBy, redeemedAt, email, sentAt
users          + inviteQuota, invitesSent
```

## Where it is enforced

`pocketbase/pb_hooks/closed_beta.pb.js`, on `onRecordCreateRequest` over
`users`, with the logic in `closed_beta.js` beside it for the reason under
*Deploying a change here*. Not on the OAuth2 hook, and not in an API rule:

- PocketBase creates the account through its **own record-create API** during
  the OAuth2 round trip, cloning the browser's headers onto that internal
  request. Hanging the gate there covers every way an account can come into
  being — the identity provider's leg, and a direct `POST` to the collection —
  rather than only the one.
- That internal request is already **inside the OAuth2 transaction**, so a
  refusal rolls the row back instead of leaving an account that was never
  admitted. The hook reuses the live transaction rather than opening a second:
  PocketBase's write pool is a single connection and a second would block on
  it forever.
- A rule cannot **count** rows or decrement a counter, which is what both
  halves of this need.

An administrator adding somebody by hand is not a registration, so a request
carrying superuser auth skips the gate.

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

The code travels from the sign-in box as the `X-Invite-Code` header on the
code exchange, having ridden through the identity provider in the trip's
`sessionStorage` stash (`src/auth/trip.ts`). An invitation link is
`?invite=<code>` on the app's own origin — no Caddy route, unlike `/l/<code>`.
Following one puts the sign-in box up with the code filled in and says why,
and the parameter stays on the URL until the box is dismissed or the trip
starts: the box is the only place the code can be spent, and a reload before
the reader gets that far must not be what loses it. A reader who already has
an account is just following a link to the map, so the parameter is dropped
on arrival instead. The trip stashes
`window.location.href` as the address to come back to, which is why leaving
drops the parameter first — finding it again afterwards would reopen the box
over a session the reader had just got.

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

## Two things the gate does not cover

**Casdoor sign-up stays open.** The gate is on the app's account, not on the
identity. A stranger can still create a Casdoor identity; they simply get no
`users` row and no ability to save anything. Closing Casdoor's own sign-up
would close it for invited readers too, since the identity is made before the
app ever sees them.

**Comment threads federate straight to Casdoor.** Remark42 holds its own user
store keyed to the Casdoor subject and knows nothing of PocketBase, so
somebody with an identity but no account can still post on a public spot.
Nothing in this design reaches that; `ADMIN_SHARED_ID` and Remark42's own
moderation are what answer it (`docs/discussion-and-votes.md`). If the beta is
meant to hold spam off the threads as well as off the register, that is a
second decision and a different mechanism.

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
