import { useCallback, useEffect, useState } from 'react';
import type { AttachmentRecord } from '../api/attachments';
import { useGroundView } from '../localities/groundView';

/*
 * The two halves that `[Visning ▾]` and `[Bilde ▾]` need identically: one
 * mounted component per member that is on the map, and a way for it to say
 * that nothing arrived (docs/lokalitet-view.md §13.10 steps 5–6).
 *
 * Shared rather than written twice because the *rules* are the thing being
 * shared, not the code: a member on the map is a component that is mounted,
 * and a switch that is on over a layer that never came has to say so. Two
 * copies would be two chances for the groups to answer the same question
 * differently, which is the failure the row exists to stop.
 */

/**
 * One member's pixels on the ground, for as long as its switch is on.
 *
 * Rendered as a sibling of the `LayerGroup` rather than inside the pulldown
 * body: `useGroundView` is a hook, so a member on the map is a component that
 * is mounted — and one that went away when the pulldown closed would make
 * every switch a press-and-hold.
 */
export const GroundMember = ({
  layerKey,
  rec,
  onFailed,
}: {
  layerKey: string;
  rec: AttachmentRecord;
  onFailed: (id: string, failed: boolean) => void;
}) => {
  const { failed } = useGroundView(layerKey, rec);
  const id = rec.id;

  // Cleared on the way out as well as reported on the way in: switching a
  // failed member off and on again is the retry, and a stale complaint on a
  // row that is not even asking for pixels any more is worse than none.
  useEffect(() => {
    onFailed(id, failed);
    return () => onFailed(id, false);
  }, [id, failed, onFailed]);

  return null;
};

/**
 * Which members are switched on and showing nothing, by attachment id.
 *
 * State here rather than in the member, because the row that has to print it
 * is the pulldown and the member is a headless sibling of it. Identity-stable
 * when nothing changed, so a re-render of the control does not walk every
 * member's effect.
 */
export const useLayerFailures = () => {
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const report = useCallback((id: string, failed: boolean) => {
    setFailedIds((cur) => {
      if (cur.has(id) === failed) return cur;
      const next = new Set(cur);
      if (failed) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  return { failedIds, report };
};
