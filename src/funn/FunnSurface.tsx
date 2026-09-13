import { useAtom, useAtomValue } from 'jotai';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { mapAtom } from '../map/atoms';
import { toast } from '../ui';
import { FunnCanvas } from './FunnCanvas';
import { captureFunnFrame } from './frame';
import {
  drawRequestedAtom,
  freezeMap,
  funnSessionAtom,
  thawMap,
} from './session';

/*
 * The pen going down, and coming back up.
 *
 * Mounted unconditionally from AppShell and renders nothing until there is
 * something to render: it owns the whole lifecycle of a drawing session, and
 * a component that only exists once the session has started could not have
 * started it.
 *
 * Freeze first, then frame. `freezeMap` cancels any easing view animation as
 * well as switching the interactions off, and the extent read afterwards is
 * therefore one the map will still be showing a second later — which matters
 * now that the drawing is over the live map rather than over a photograph of
 * it, since a view that slides after the frame is taken slides the ground out
 * from under every stroke.
 *
 * Coming back up is the reverse and is all in the cleanup, so it runs
 * whichever way the session ends: the pen again, closing the lokalitet, or an
 * error boundary above.
 */
export const FunnSurface = () => {
  const { t } = useTranslation();
  const map = useAtomValue(mapAtom);
  const [requested, setRequested] = useAtom(drawRequestedAtom);
  const [frame, setFrame] = useAtom(funnSessionAtom);

  useEffect(() => {
    if (!requested) return;
    freezeMap(map);
    const captured = captureFunnFrame(map);
    if (!captured) {
      // No size, so no scene↔ground mapping. Better to stay out of draw mode
      // than to hand over a surface that is not registered to the ground.
      thawMap(map);
      toast.error({ title: t('localities.tools.drawFailed') });
      setRequested(false);
      return;
    }
    setFrame(captured);
    return () => {
      thawMap(map);
      setFrame(null);
    };
  }, [requested, map, setRequested, setFrame, t]);

  if (!frame) return null;
  return <FunnCanvas />;
};
