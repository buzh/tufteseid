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
takes **exactly one** custom provider, and refuses to start if any of the six
variables is missing, which is the usual cause of the container restarting in
a loop on first deploy.

Because both the app and Remark42 federate to the same provider, the second
sign-in is a click: the reader presses the one provider button in the widget
and comes back without entering a credential. That is the whole point of the
arrangement, and the first thing to check after a deploy.

Moderation is `ADMIN_SHARED_ID`: the Casdoor subject of whoever may delete and
block, given to Remark42 as an opaque id. It is unrelated to PocketBase's
`role = "admin"` — the same person needs both, set in two places.

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
  rule is the reader's own rows, that means the tally moves live on the
  reader's *own* vote and picks up everybody else's at the next full fetch.
  Live enough for a number that has to be right rather than instant.
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
