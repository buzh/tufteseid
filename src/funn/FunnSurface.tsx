import { useAtom, useAtomValue } from 'jotai';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { funnDraftActiveAtom } from '../localities/atoms';
import { mapAtom } from '../map/atoms';
import { toast } from '../ui';
import { FunnCanvas } from './FunnCanvas';
import { freezeMap, funnSessionAtom, thawMap } from './session';
import { captureFunnSnapshot } from './snapshot';

/*
 * The pen going down, and coming back up.
 *
 * Mounted unconditionally from AppShell and renders nothing until there is
 * something to render: it owns the whole lifecycle of a drawing session, and
 * a component that only exists once the session has started could not have
 * started it.
 *
 * The order matters. Freeze *first*, then photograph — the map can take
 * seconds to settle over a cold LiDAR tile (`map/composite.ts`), and a pan
 * during that wait would produce a snapshot of one view with the frame of
 * another, which is a funn in the wrong place with nothing on screen to say
 * so. Coming back up is the reverse and is all in the cleanup, so it runs
 * whichever way the session ends: the pen again, `Avbryt`, closing the
 * lokalitet, or an error boundary above.
 */
export const FunnSurface = () => {
  const { t } = useTranslation();
  const map = useAtomValue(mapAtom);
  const [active, setActive] = useAtom(funnDraftActiveAtom);
  const [snapshot, setSnapshot] = useAtom(funnSessionAtom);

  useEffect(() => {
    if (!active) return;
    let live = true;
    freezeMap(map);
    captureFunnSnapshot(map).then((captured) => {
      if (!live) return;
      if (!captured) {
        // Nothing to draw on. Better to stay out of draw mode than to hand
        // over a surface that is not registered to the ground under it.
        toast.error({ title: t('localities.funn.freezeFailed') });
        setActive(false);
        return;
      }
      setSnapshot(captured);
    });
    return () => {
      live = false;
      thawMap(map);
      setSnapshot(null);
    };
  }, [active, map, setActive, setSnapshot, t]);

  if (!snapshot) return null;
  return <FunnCanvas snapshot={snapshot} />;
};
