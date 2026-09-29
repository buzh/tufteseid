# Discussion and votes

A public spot is otherwise a dead end: a reader can look and can say nothing,
and nothing separates one everybody found worth reading from one nobody opened.
Two mechanisms answer that, and they are unrelated to each other — the threads
live in a sidecar, the tallies live in PocketBase.

## Threads

Remark42 under `/remark42`, one thread per spot, keyed by the spot's canonical
short link.

### The key

`src/talk/SpotTalk.tsx` passes `shareUrlOf(spot.code)` — `https://<host>/l/<CODE>`
— as `url`. Not the address in the location bar: that carries the map's own
parameters, so `/?lok=ABCDEF&zoom=14` and `/?lok=ABCDEF&zoom=15` would be two
threads on one spot. The code never changes, so a rename keeps the thread.

### The widget

Fetched from our own origin at runtime rather than bundled: no npm dependency,
and `script-src 'self'` covers it as-is. `/remark42/web/embed.mjs` is appended
once per session as a module script; `window.remark_config` is set, then
`window.REMARK42.createInstance()` on mount and `destroy()` on unmount, so
opening a second spot swaps the thread rather than stacking one.

A failed load degrades to `talk.failed` and clears the cached promise, so
closing and reopening the box retries — a sidecar that was down at first press
is often up at the second.

**The widget's own chrome is English.** Remark42 ships en, de, sv and others,
and no Norwegian. This is a deliberate exception to *`t()` from day one, nb
only*: the strings around the widget are nb, the strings inside it are not.

### Only public spots

Remark42 has no access control worth the name — every thread it serves is
readable by anyone who knows its key. So a private spot's thread is not
protected, it simply does not exist: `spotTalkingAtom` refuses to open for a
non-public spot, `SpotTalk` re-checks rather than trusting the caller, and both
entry points render their button disabled with `talk.private` on it.

Making a private spot public therefore opens a thread that was never there.
Making a public one private leaves its comments in Remark42's store, reachable
by anyone who kept the URL. Say so before treating the visibility switch as a
retraction.

### Federation and moderation

`AUTH_CUSTOM_*` points Remark42 at Casdoor — see `docs/identity.md`. Remark42
takes **exactly one** custom provider, and once any of the six variables is
set a missing one is a startup failure, which is the usual cause of the
container restarting in a loop on first deploy.

**The custom provider arrived in v1.16.0**, so the pin cannot go below it.
On an older image the whole `AUTH_CUSTOM_*` block is read by nothing —
remark42 starts clean, serves threads and offers no way to sign in to one.
The symptom is `/remark42/api/v1/config` reporting `"auth_providers":[]`,
which `live-check.sh` asserts against for exactly this reason.

Moderation is `ADMIN_SHARED_ID`: the Casdoor subject of whoever may delete and
block, given to Remark42 as an opaque id. It is unrelated to PocketBase's
`role = "admin"` — the same person needs both, set in two places.

### One sign-in

Remark42 holds a session of its own, so signing in to the app leaves the
reader a stranger to the thread. Both federate to the same Casdoor, so no
second credential is ever asked for — but the OAuth2 round trip still has to
run, and the widget's way of running it is a button the reader has to find.

`src/api/remark42.ts` runs it for them, in a hidden iframe, before the widget
is created. Three things have to hold or it does not stay silent:

| | |
| --- | --- |
| `silentSignin=1` on `AUTH_CUSTOM_AUTH_URL` | Casdoor otherwise draws a *Continue with …* panel for a reader it already knows, and a hidden frame is the one place nobody can press it. The parameter survives because go-pkgz/auth composes the redirect with x/oauth2's `AuthCodeURL`, which appends with `&` when the base URL already carries a query. |
| `frame-src` naming `$CASDOOR_HOST` | The app's CSP is `default-src 'self'`, which would block the frame at Casdoor's hop. |
| Casdoor on the app's registrable domain | `id.<app host>` is same-site, so the frame's cookies are first-party. A Casdoor on a domain of its own is not, and a browser that blocks third-party cookies then hands Casdoor a frame with no session in it. |

The widget's own provider button is the fallback under all three, and under
an expired Casdoor session as well, so a failure costs a click rather than a
thread. Nothing in a log says which happened, which is why `live-check.sh`
asserts the first two.

The order matters. The widget reads remark42's session once, when it is
created: `SpotTalk` waits on the round trip before `createInstance` and
re-creates the widget when the app's own sign-in state changes, and signing
out of the app ends remark42's session before clearing PocketBase's. The
Casdoor session behind both is left alone — it is what makes the next sign-in
a single click, and it is ended on Casdoor's own hostname.

### If the public origin moves

The thread key is `https://<host>/l/<CODE>`, so changing the host points every
spot at a thread that does not exist yet. Nothing is lost — the comments are
still in the store under their old keys — but nothing finds them either, and
no amount of restarting fixes it. `remap` is what moves them:

```sh
# REMARK42_ADMIN_PASSWD in .env, then `docker compose up -d remark42`.
docker compose exec remark42 backup -s tufteseid
printf 'https://old.example* https://new.example*\n' \
  | sudo tee /site/tufteseid/data/remark42/rules
docker compose exec remark42 remap -s tufteseid -f var/rules
docker compose restart remark42
```

The rules file is one `<from> <to>` pair per line and takes a trailing `*` on
each side for a whole-host move. Remapping runs asynchronously and the result
does not show until the restart, so a run that looks like it did nothing
usually has not finished. Blank `REMARK42_ADMIN_PASSWD` again when you are
done.

Two other things the move touches and this does not: already-rendered evidence
has the old host **burnt into its pixels** by `rendersvc` and no remap reaches
it, and Casdoor's two registered redirect URIs live in its database rather
than its environment. `docs/identity.md` has the second.

## Votes

A score per spot, ours, in PocketBase. No comment engine votes on a *page* —
Remark42, Comentario and the rest all vote on individual comments — so ranking
spots was never something the sidecar could do.

`pocketbase/pb_migrations/1700001700_spot_votes.js` creates two collections.

### `votes` (id `pbc_votes`)

| field | type |
| --- | --- |
| `owner` | relation → `users`, required, cascade |
| `spot` | relation → `spots`, required, cascade |
| `direction` | select, required, one of `up` / `down` |

A select rather than a signed number because PocketBase cannot express "not
zero" on a NumberField, and a zero vote is not an opinion. Retracting deletes
the row.

`idx_votes_owner_spot` is unique over `(owner, spot)` — one vote per account
per spot, enforced by the database rather than by the client. `castVote()`
creates and, on the `validation_not_unique` 400 that comes back, updates the
existing row instead: the same upsert shape `src/api/spots.ts` already uses for
a `code` collision.

Rules — *how a spot stands* is public, *who voted* is not:

| | |
| --- | --- |
| list / view | `owner = @request.auth.id \|\| @request.auth.role = "admin"` |
| create | signed in, owns the record, and the spot is public |
| update / delete | owner or admin |

### `spotScores` (id `pbc_spot_scores`)

A view collection, list and view rule open — a guest sees the ranking without
an account.

```sql
SELECT spot AS id, spot,
       COUNT(*) AS votes,
       SUM(CASE WHEN direction = 'up' THEN 1 ELSE 0 END) AS up,
       SUM(CASE WHEN direction = 'down' THEN 1 ELSE 0 END) AS down,
       SUM(CASE WHEN direction = 'up' THEN 1 ELSE -1 END) AS score
FROM votes GROUP BY spot
```

Two properties of a view collection the client is written against:

- **No realtime feed.** PocketBase does not publish events for a view, so
  `useSpotScores()` subscribes to `votes` — a base collection, where realtime
  works — and refetches the one affected row on an event. Since `votes`' list
  rule is ordinarily the reader's own rows, that means the tally moves live on
  the reader's *own* vote and picks up everybody else's at the next full fetch.
  Live enough for a number that has to be right rather than instant.

  The exception is an admin, whose list rule covers every account's votes:
  `listMyVotes()` filters on `owner` itself and the hook drops feed records
  somebody else cast. Left to the rule, another reader's row lands in
  `myVotesAtom` under that spot, `VoteControl` draws a thumb the admin never
  pressed, and pressing it deletes their vote.
- **A spot with no votes is absent**, not present at zero. Every reader of
  `spotScoresAtom` treats a missing entry as zero rather than as unknown.

## Client

| | |
| --- | --- |
| `src/api/votes.ts` | the collection calls, the upsert, the realtime subscription |
| `src/spots/spotScores.ts` | `spotScoresAtom`, `myVotesAtom`, `popularSpotsAtom`, and the `useSpotScores()` hook `SpotSurface` mounts once |
| `src/spots/VoteControl.tsx` | up, the tally, down — never hidden, only disabled, with the reason on the tooltip |
| `src/talk/SpotTalk.tsx` | the thread box, a fourth spot box behind `spotTalkingAtom` |

`VoteControl` and the thread button stand in both `SpotCard` (the author's
workbench) and `EvidenceReader` (the only box anybody else ever sees). Leaving
either out would hide the feature from one of the two audiences.

`popularSpotsAtom` joins the records to the tallies for the *Populære* tab in
`SpotMenu`: every public spot, best first, `updated` breaking a tie. It does
not wait on the tallies — if they never land the list still reads, unranked,
rather than hanging on a spinner.
