import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { transformExtent } from 'ol/proj';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalityBbox } from '../api/localities';
import { mapAtom } from '../map/atoms';
import { fitPadding, FUNN_MARGIN_PX } from '../shell/chromeInsets';
import { toast } from '../ui';
import { FunnCanvas } from './FunnCanvas';
import { captureFunnFrame, frameExtentIn } from './frame';
import { geometryBbox4326, geometryToScene } from './geometry';
import {
  bindFrameToMap,
  drawRequestedAtom,
  freezeMap,
  funnSceneAtom,
  funnSessionAtom,
  nextSessionId,
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
 * **A resumed sketch goes the other way round**: it arrives with a frame
 * already, so the map is flown back to that rectangle and the stored frame is
 * kept rather than a fresh one captured. Capturing one would re-register old
 * strokes to a new viewport, which is precisely how a drawing ends up two
 * metres off the ditch it traces. The difference between the rectangle asked
 * for and the one `constrainResolution` actually lands on is absorbed by
 * `bindFrameToMap`, not by the scene.
 *
 * Coming back up is the reverse and is all in the cleanup, so it runs
 * whichever way the session ends: the pen again, closing the lokalitet, or an
 * error boundary above.
 */
const bboxIn = (
  bbox: LocalityBbox | null,
  projection: string,
): [number, number, number, number] | null => {
  if (!bbox) return null;
  if (projection === 'EPSG:4326') return bbox;
  return transformExtent(bbox, 'EPSG:4326', projection) as [
    number,
    number,
    number,
    number,
  ];
};

export const FunnSurface = () => {
  const { t } = useTranslation();
  const map = useAtomValue(mapAtom);
  const [requested, setRequested] = useAtom(drawRequestedAtom);
  const [session, setSession] = useAtom(funnSessionAtom);
  const setScene = useSetAtom(funnSceneAtom);

  useEffect(() => {
    if (!requested) return;
    const view = map.getView();
    const projection = view.getProjection().getCode();

    /*
     * Where to stand before the view is stopped.
     *
     * Both ways in that open on something already drawn have to bring it on
     * screen first, or the freeze registers the surface to a viewport the
     * drawing is not in. Padded like every other fit in the app, so it lands in
     * the strip the chrome leaves rather than half under the ribbon; for a
     * resume, any difference between the rectangle asked for and the one
     * `constrainResolution` settles on is `bindFrameToMap`'s to absorb, so the
     * padding costs the scene nothing. No duration either way: the freeze below
     * cancels animations anyway, and a pen that has to wait for a flight is a
     * pen that can be pressed twice.
     */
    const resume = requested.resume;
    const seed = requested.seed;
    const openOn = resume
      ? frameExtentIn(resume.scene.frame, projection)
      : seed
        ? bboxIn(geometryBbox4326(seed), projection)
        : null;
    const size = map.getSize();
    if (openOn && size) {
      view.fit(openOn, { size, padding: fitPadding(map, FUNN_MARGIN_PX) });
    }

    freezeMap(map);
    const frame = resume ? resume.scene.frame : captureFunnFrame(map);
    if (!frame) {
      // No size, so no scene↔ground mapping. Better to stay out of draw mode
      // than to hand over a surface that is not registered to the ground.
      thawMap(map);
      toast.error({ title: t('localities.tools.drawFailed') });
      setRequested(null);
      return;
    }
    bindFrameToMap(map, frame, frameExtentIn(frame, projection));
    const elements = resume
      ? resume.scene.elements
      : seed
        ? geometryToScene(frame, seed)
        : [];
    setScene(elements);
    setSession({
      id: nextSessionId(),
      mode: requested.mode,
      frame,
      opening: elements,
      resume: resume ? { id: resume.id } : null,
    });
    return () => {
      thawMap(map);
      setSession(null);
      setScene([]);
    };
  }, [requested, map, setRequested, setSession, setScene, t]);

  /*
   * Keyed on the session, because one drawing session can follow another
   * without a render in between: every entrance puts the pen down and presses
   * it again in one callback, React batches the two, and an unkeyed surface is
   * therefore never unmounted. What survives is everything the canvas reads
   * once — the opening scene, the measured offset, and Excalidraw's own live
   * elements — so the new session would open on the old session's strokes and
   * save them as whatever it is making.
   */
  if (!session) return null;
  return <FunnCanvas key={session.id} />;
};
