import { useCallback, useEffect, useState } from 'react';
import type { AttachmentRecord } from '../api/attachments';
import { useGroundView } from '../localities/groundView';

/**
 * One member's pixels on the ground, for as long as its switch is on. Must be
 * a sibling of the `LayerGroup`, never inside the pulldown body: `useGroundView`
 * is a hook, so unmounting it on close would make every switch a press-and-hold.
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

  // Cleared on the way out too: switching a failed member off and on is the
  // retry, and a stale complaint would outlive the request.
  useEffect(() => {
    onFailed(id, failed);
    return () => onFailed(id, false);
  }, [id, failed, onFailed]);

  return null;
};

/**
 * Which members are switched on and showing nothing, by attachment id. Kept
 * identity-stable when nothing changed, so a re-render of the control does not
 * walk every member's effect.
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
