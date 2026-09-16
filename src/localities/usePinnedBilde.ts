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
// The group it paints into is shared with Terrenganalyse, and since §13 it is
// a **stack** rather than a slot: this is its upper member, so a pinned
// ortofoto fading over a live terrain render is the ordinary case and neither
// side has to stand the other down. What used to be here — entering Terreng
// taking the slot away, heard through `subscribeGroundOverlay` and answered by
// dropping the selection — went with the arbiter.

import { useAtom } from 'jotai';
import { useCallback, useEffect, useState } from 'react';
import { getAttachmentUrl, type AttachmentRecord } from '../api/attachments';
import {
  setGroundOverlay,
  setGroundOverlayOpacity,
} from '../map/groundOverlay';
import { pinnedAttachmentIdAtom } from './atoms';

/** `[minX, minY, maxX, maxY]` in EPSG:25833, as every producer writes it. */
const extentOf = (meta: Record<string, unknown>) => {
  const b = meta.bbox25833;
  return Array.isArray(b) &&
    b.length === 4 &&
    b.every((n) => typeof n === 'number' && Number.isFinite(n))
    ? (b as [number, number, number, number])
    : null;
};

/**
 * Where the ground sits inside the figure PNG, in that file's own pixels.
 *
 * Not optional in practice but treated as such: the caption panel is drawn
 * *below* the image (src/figure/), so a figure is taller than the rectangle it
 * shows and painting the whole file at the extent would squash the ground and
 * hang a caption off the bottom of it. Anything without an imageRect predates
 * the figure work and is pixel-registered already.
 */
const cropOf = (meta: Record<string, unknown>, img: HTMLImageElement) => {
  const r = meta.imageRect as Record<string, unknown> | undefined;
  const n = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const x = n(r?.x);
  const y = n(r?.y);
  const width = n(r?.width);
  const height = n(r?.height);
  return x != null && y != null && width != null && height != null
    ? { x, y, width, height }
    : { x: 0, y: 0, width: img.naturalWidth, height: img.naturalHeight };
};

/**
 * Whether this record has enough recorded about it to be placed on the map.
 *
 * A sketch is refused although a pinned one has both a file and an extent, and
 * that is about the slot rather than the record: this one holds a *ground*,
 * one at a time, and a sketch is a transparent layer over one. It has its own
 * way onto the map — `sketchOverlay.ts`, a set rather than a slot (§9.3) — and
 * laying its figure down here would put a white sheet with a caption panel on
 * it over the very image it was drawn to annotate.
 */
export const canPinBilde = (rec: AttachmentRecord): boolean =>
  rec.kind !== 'sketch' &&
  rec.file !== '' &&
  rec.meta != null &&
  extentOf(rec.meta) != null;

export const usePinnedBilde = (attachments: AttachmentRecord[] | null) => {
  const [pinnedId, setPinnedId] = useAtom(pinnedAttachmentIdAtom);
  // Percent, like Terrenganalyse's, and for the same reason: this slider is
  // dragged, and routing every frame through jotai would re-render the shell
  // at 60 Hz to change a number OpenLayers reads imperatively anyway.
  const [opacity, setOpacityState] = useState(100);
  const [failed, setFailed] = useState(false);

  const pinned = attachments?.find((a) => a.id === pinnedId) ?? null;

  // Deliberately keyed on the record's identity and its meta, not on the whole
  // list: the list is rebuilt on every realtime event, and re-decoding a
  // several-megabyte PNG because somebody's caption changed would flash the
  // map.
  const metaKey = pinned?.meta ? JSON.stringify(pinned.meta) : null;
  useEffect(() => {
    if (!pinned || !pinned.meta) return;
    const extent25833 = extentOf(pinned.meta);
    if (!extent25833) return;
    const meta = pinned.meta;

    let cancelled = false;
    setFailed(false);
    // The original, never a thumbnail. `meta.imageRect` is in the original
    // file's pixels and nothing records the figure's own width, so a thumb
    // cannot be scaled back to the ground without guessing — and a guess that
    // is a pixel out is half a metre out on the map, which defeats the point
    // of registering it at all.
    getAttachmentUrl(pinned)
      .then((url) => {
        const img = new Image();
        img.src = url;
        return img.decode().then(() => img);
      })
      .then((img) => {
        if (cancelled) return;
        setGroundOverlay('bilde', {
          source: img,
          crop: cropOf(meta, img),
          extent25833,
        });
        setGroundOverlayOpacity('bilde', opacity / 100);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        setGroundOverlay('bilde', null);
      });

    // Note what this cleanup does *not* do: it does not take the member down.
    // Swapping from one bilde to another runs it, and withdrawing here would
    // blank the map for as long as the next image takes to decode. Taking it
    // down is the job of the effect after this one, which does it when there
    // is no pinned record at all, and of the unmount cleanup.
    return () => {
      cancelled = true;
    };
    // `opacity` is read once to seed the layer and must not retrigger a
    // decode; the slider path below sets it directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinned?.id, metaKey]);

  // Nothing pinned: take the member down.
  useEffect(() => {
    if (!pinned) setGroundOverlay('bilde', null);
  }, [pinned]);

  useEffect(() => () => setGroundOverlay('bilde', null), []);

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

  const setOpacity = useCallback((value: number) => {
    setOpacityState(value);
    setGroundOverlayOpacity('bilde', value / 100);
  }, []);

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
