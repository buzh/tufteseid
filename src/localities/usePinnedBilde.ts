// "Vis i ruta": put a kept bilde back on the map, in register, at the
// rectangle it is of.
//
// This is what replaced the lightbox. A lightbox answers "what does this file
// look like", which for a screenshot of a map is a question nobody has —
// every image in a lokalitet is *of* that lokalitet, so the useful comparison
// is against the ground it covers, not against a grey backdrop. Pinned, the
// 1937 ortofoto fades over today's hillshade with the funn drawn on top; in a
// lightbox it is a picture of a place you are no longer looking at.
//
// Mounted from useLocalityWorkspace rather than from the filmstrip, because
// the strip is collapsible and unmounts when it is folded away — and folding
// it away to see the map is the most likely thing to do right after pinning
// something.
//
// What is left here is the *selection* — which record is up, and how far it is
// faded. Getting that record onto the ground is `groundView.ts` (§13.10 step
// 2), which paints a pinned figure and renders a View live when there is no
// figure to paint. This hook was its first caller; [Visning] is the second,
// and step 5 took the Views with it, so what this still pins is a File over a
// rectangle. Step 6 gives those a group of their own and then this hook goes.
//
// Until it does, its member is one the layer row has not named, which the
// stack paints above everything the row has ordered — the right place for it,
// since [Bilde] is the group above [Visning].
//
// The group it paints into is shared with Terrenganalyse, and since §13 it is
// a **stack** rather than a slot: this is its upper member, so a pinned
// ortofoto fading over a live terrain render is the ordinary case and neither
// side has to stand the other down. What used to be here — entering Terreng
// taking the slot away, heard through `subscribeGroundOverlay` and answered by
// dropping the selection — went with the arbiter.

import { useAtom } from 'jotai';
import { useCallback, useEffect, useState } from 'react';
import type { AttachmentRecord } from '../api/attachments';
import { setGroundOverlayOpacity } from '../map/groundOverlay';
import { pinnedAttachmentIdAtom } from './atoms';
import { groundExtentOf, useGroundView } from './groundView';

/**
 * Whether this record has enough recorded about it to be placed on the map.
 *
 * **Files only, since step 5.** `kind` is the whole eligibility rule of the
 * layer row (§13.1) and the row now owns the other two kinds: an extract or a
 * flyfoto is a View and is switched on in [Visning], where the rows say what
 * each one *is* and switching one on is a deliberate act. Leaving `Vis i ruta`
 * on those cards as well would be two controls for one layer, disagreeing —
 * the rail's toggle knows nothing about the stack the pulldown is ordering.
 *
 * A sketch was already refused, and for a reason that is about the group
 * rather than the record: this one holds a *ground*, and a sketch is a
 * transparent layer over one. It has its own way onto the map —
 * `sketchOverlay.ts`, a set rather than a slot (§9.3) — and laying its figure
 * down here would put a white sheet with a caption panel on it over the very
 * image it was drawn to annotate.
 *
 * So what is left is the two kinds that are bytes and nothing else, and the
 * `file` requirement is theirs by definition rather than the ground's: a File
 * has nothing behind it that could make the pixels again. An upload carries no
 * extent and is refused by the last clause, as it always was.
 */
export const canPinBilde = (rec: AttachmentRecord): boolean =>
  (rec.kind === 'screenshot' || rec.kind === 'upload') &&
  rec.file !== '' &&
  rec.meta != null &&
  groundExtentOf(rec.meta) != null;

export const usePinnedBilde = (attachments: AttachmentRecord[] | null) => {
  const [pinnedId, setPinnedId] = useAtom(pinnedAttachmentIdAtom);
  // Percent, like Terrenganalyse's, and for the same reason: this slider is
  // dragged, and routing every frame through jotai would re-render the shell
  // at 60 Hz to change a number OpenLayers reads imperatively anyway.
  const [opacity, setOpacity] = useState(100);

  const pinned = attachments?.find((a) => a.id === pinnedId) ?? null;

  const { failed } = useGroundView('bilde', pinned);

  // The stack keeps each member's alpha at module level and reads it at draw
  // time, so it outlives this hook — and the slider's own state does not.
  // Pushing it down on mount is what stops the next lokalitet from opening at
  // the last one's fade.
  useEffect(() => {
    setGroundOverlayOpacity('bilde', opacity / 100);
  }, [opacity]);

  // The record went away under us — deleted here or by another session. Only
  // once the list has actually arrived: `null` is "still loading", and
  // treating it as "not there" would unpin on every remount.
  useEffect(() => {
    if (pinnedId && attachments != null && !pinned) setPinnedId(null);
  }, [pinnedId, pinned, attachments, setPinnedId]);

  // A pin belongs to the lokalitet it was made in. The atom outlives this
  // hook (the workspace is remounted per record), so closing or swapping has
  // to put it down or the next lokalitet opens with a stale id in it.
  useEffect(() => () => setPinnedId(null), [setPinnedId]);

  // A plain setter, not a toggle. The strip's own selection is what toggles
  // (`selectBilde` in useLocalityWorkspace), and the two ids are not the same
  // value — an upload carries no extent, so it can be the active card without
  // being on the ground — so folding the toggle in here made the caller's
  // "select this record" mean "unpin" whenever the two had drifted apart.
  const pin = useCallback(
    (id: string | null) => setPinnedId(id),
    [setPinnedId],
  );

  return { pinnedId, pin, pinnedFailed: failed, opacity, setOpacity };
};
