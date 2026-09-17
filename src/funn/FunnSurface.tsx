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

// Owns the lifecycle of a drawing session, so it is mounted unconditionally
// from AppShell and renders nothing until there is one. Freeze first, then
// frame: `freezeMap` cancels any easing view animation too, so the extent read
// afterwards is one the map will still be showing. A resumed sketch keeps its
// stored frame instead — capturing a fresh one would re-register old strokes to
// a new viewport, and `bindFrameToMap` absorbs the difference between the
// rectangle asked for and the one `constrainResolution` lands on. Thawing is
// all in the cleanup, so it runs whichever way the session ends.

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

    // Both ways in that open on something already drawn have to bring it on
    // screen first, or the freeze registers the surface to a viewport the
    // drawing is not in. No duration: the freeze below cancels animations, and
    // a pen that waits for a flight is a pen that can be pressed twice.
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
      // No size, so no scene↔ground mapping: better to stay out of draw mode
      // than to hand over a surface not registered to the ground.
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

  // Keyed on the session: one can follow another without a render in between,
  // and an unkeyed surface is never unmounted, so everything the canvas reads
  // once survives and the new session opens on the old session's strokes.
  if (!session) return null;
  return <FunnCanvas key={session.id} />;
};
