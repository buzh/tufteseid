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
// Mounted from useLocalityWorkspace rather than from BilderSection, because
// the section is inside a collapsible and unmounts when it is folded away —
// and folding the list away to see the map is the most likely thing to do
// right after pinning something.
//
// The slot it paints into is shared with Terrenganalyse and there is exactly
// one; `map/groundOverlay.ts` owns that rule. Here it means two things:
// entering Terreng takes the slot away, which we hear about through
// `subscribeGroundOverlay` and answer by dropping the selection, and pinning
// stands a live terrain render down without asking it to.

import { useAtom } from 'jotai';
import { useCallback, useEffect, useState } from 'react';
import { getAttachmentUrl, type AttachmentRecord } from '../api/attachments';
import {
  groundOverlayOwner,
  hideGroundOverlay,
  setGroundOverlayOpacity,
  showGroundOverlay,
  subscribeGroundOverlay,
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

/** Whether this record has enough recorded about it to be placed on the map. */
export const canPinBilde = (rec: AttachmentRecord): boolean =>
  rec.file !== '' && rec.meta != null && extentOf(rec.meta) != null;

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
        showGroundOverlay({
          owner: 'bilde',
          source: img,
          crop: cropOf(meta, img),
          extent25833,
        });
        setGroundOverlayOpacity('bilde', opacity / 100);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        hideGroundOverlay('bilde');
      });

    // Note what this cleanup does *not* do: it does not put the slot down.
    // Swapping from one bilde to another runs it, and a hide there would
    // publish an owner change that the subscription below reads as "Terreng
    // took the slot" — unpinning the image that was just picked. Taking the
    // slot down is the job of the effect after this one, which does it when
    // there is no pinned record at all, and of the unmount cleanup. Leaving
    // the old image up while the new one decodes is also the better swap:
    // nothing flashes.
    return () => {
      cancelled = true;
    };
    // `opacity` is read once to seed the layer and must not retrigger a
    // decode; the slider path below sets it directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinned?.id, metaKey]);

  // Nothing pinned: put the slot down if we are still holding it.
  // `hideGroundOverlay` no-ops when somebody else has taken it.
  useEffect(() => {
    if (!pinned) hideGroundOverlay('bilde');
  }, [pinned]);

  useEffect(() => () => hideGroundOverlay('bilde'), []);

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

  // Terreng took the slot. Nothing is on the map any more, so the selection
  // bar must stop claiming there is; the arbiter publishes owner changes
  // precisely so the displaced side can say so itself.
  useEffect(() => {
    if (!pinnedId) return;
    return subscribeGroundOverlay(() => {
      if (groundOverlayOwner() !== 'bilde') setPinnedId(null);
    });
  }, [pinnedId, setPinnedId]);

  const setOpacity = useCallback((value: number) => {
    setOpacityState(value);
    setGroundOverlayOpacity('bilde', value / 100);
  }, []);

  const pin = useCallback(
    (id: string | null) => setPinnedId((cur) => (cur === id ? null : id)),
    [setPinnedId],
  );

  return { pinnedId, pin, pinnedFailed: failed, opacity, setOpacity };
};
