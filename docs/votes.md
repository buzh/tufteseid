# Votes

A score per spot, in PocketBase. There is no comment engine and no discussion
thread: a spot carries a tally and nothing else a reader can write on somebody
else's record.

`pocketbase/pb_migrations/1700001700_spot_votes.js` creates two collections.

## `votes` (id `pbc_votes`)

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
| create | signed in, owns the record, the spot is public, and the spot is not the reader's own |
| update | owner or admin, the spot is still public, and neither `spot` nor `owner` is in the body |
| delete | owner or admin |

Update carries the public gate too, and pins both relations, because a vote is
otherwise created against a public spot and PATCHed onto a private one — the
only field that legitimately moves is `direction`
(`1700001800_votes_public_only.js`).

**Nobody ranks their own spot** (`1700001900_votes_not_own.js`). Only create
carries that clause: update pins both relations, so no vote already cast can
turn into a self-vote. `VoteControl` drops the thumbs entirely here, since
there is no way out of owning the thing; the tally stays, so the author still
reads where their spot stands. The other two refusals keep the thumbs and
say why on the tooltip, and only one of them disables: an admin cannot
publish somebody else's private spot, but a reader with no account can get
one, so pressing a live thumb signed out raises the sign-in box.

## `spotScores` (id `pbc_spot_scores`)

A view collection, list and view rule open — a guest sees the ranking without
an account. The join is what makes that safe: the rules are open, so the query
itself has to keep a private spot out, and a spot its owner turns private
drops out of the ranking with the votes it already has. `v.owner != s.owner`
is the same trade for a self-vote: the rule stops a new one, and the query
stops an old one counting without deleting the row.

```sql
SELECT v.spot AS id, v.spot AS spot,
       COUNT(*) AS votes,
       SUM(CASE WHEN v.direction = 'up' THEN 1 ELSE 0 END) AS up,
       SUM(CASE WHEN v.direction = 'down' THEN 1 ELSE 0 END) AS down,
       SUM(CASE WHEN v.direction = 'up' THEN 1 ELSE -1 END) AS score
FROM votes v JOIN spots s ON s.id = v.spot
WHERE s.visibility = 'public' AND v.owner != s.owner
GROUP BY v.spot
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
| `src/spots/VoteControl.tsx` | up, the tally, down — disabled with the reason on the tooltip, or the tally alone on the reader's own spot |

`VoteControl` stands in both `SpotCard` (the author's workbench) and
`EvidenceReader` (the only box anybody else ever sees). Leaving either out
would hide the feature from one of the two audiences.

`popularSpotsAtom` joins the records to the tallies for the *Populære* tab in
`SpotMenu`: every public spot, best first, `updated` breaking a tie. It does
not wait on the tallies — if they never land the list still reads, unranked,
rather than hanging on a spinner.
