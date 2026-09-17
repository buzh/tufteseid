# Open questions

Decisions deliberately not taken. Each is a real fork in the road, not a
backlog item: the current behaviour is defensible and the alternative is too.
Close one by deciding, then delete its entry.

## Lokalitet and its images

- **Should an aborted edit undo a picker run?** It does today, which is
  consistent with the transaction — and it throws away images somebody spent a
  minute choosing. The bytes are warm in wmscache; the choosing is what is lost.
- **What `Avbryt` does when a compensating delete fails.** Reachable only for
  screenshots and uploads. The record is then neither the state you started in
  nor the one you were building. Reporting it honestly is the floor.
- **How long a pin should be trusted.** A pinned View records `renderedAt`; the
  upstream can be re-flown or re-processed years later. Re-rendering to compare
  is cheap per lokalitet and a maintenance commitment forever. There is now no
  surface where a live render and its archived figure are seen together, so
  drift never announces itself.
- **What a scene does when a member changes under it.** `over` is uncascaded, so
  a deleted member leaves a dangling id and the scene renders with one fewer
  layer than it was composed with. Naming it in the scene's caption is the
  floor; refusing the delete is wrong; versioning the scene is version control.
- **Should a funn be able to cite a bilde?** The obvious next schema field.
  Left out because curated order plus a caption gets most of the way there, and
  a relation invites a UI for managing it.
- **What happens to the starter three when "Juster området" moves the
  rectangle.** Each View renders over its own stored rectangle, which makes the
  mismatch visible but does not flag it. The carousel should at least say which
  cards are stale.
- **Should the starter three be settable?** A user who reads slope maps first
  re-derives the same three images on every new lokalitet, and the fetch is not
  free upstream. A per-user preference is a settings screen this app lacks.

## Stances, sharing and controls

- **Should `Rediger` be sticky per lokalitet?** Against: stance is per session
  so that opening a site is always the same act, and a remembered stance makes a
  link and a list entry lead to different places.
- **Groups.** `limited` visibility is still a placeholder behaving as `private`.
  A fork with attribution may be the better model for two amateurs reading the
  same hillside than a shared mutable record.
- **A copy does not track its original.** No merge, no notification. The
  alternative is version control.
- **Should a copy show the original's funn as a dimmed underlay?** The
  comparison a fork exists for, and probably too clever for a first build.
- **Should the funn list be a left-slot card rather than a popover?** A card is
  dismissible in a way a column was not. Against: it is a dock by another name,
  on the side the map is usually read from.
- **Is `Behold` on the Flyfoto ground a trap?** Keeping the ground you are
  looking at is the general rule, but Flyfoto's ring is a list of the very
  things the picker exists to batch, so it may read as "keep all of these".
- **Should a picker run in the background?** A ten-image flyfoto stack holds the
  bottom slot for a minute. Against: images landing without you looking at them
  is what the keep/discard gesture exists to prevent.
