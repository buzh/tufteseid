import { useAtomValue } from 'jotai';
import { lazy, Suspense, useEffect, useMemo } from 'react';

import { draftGroundAtom, type DraftGround } from '../evidence/draftGround';
import { EvidenceReader } from '../evidence/EvidenceReader';
import {
  useEvidenceLoopOverlay,
  useEvidenceOverlay,
} from '../evidence/evidenceOverlay';
import { maxBoundaryMetres, snapBoundaryMetric } from '../map/grid';
import { useRectangleAdjust } from '../map/rectAdjust';
import { uiContextAtom } from '../shared/uiContext';
import { useAllSketchesLayer } from '../sketch/allSketches';
import { useSketchOverlay } from '../sketch/overlay';
import { sketchOf } from '../sketch/scene';
import { sketchSessionAtom } from '../sketch/session';
import { useSketchSession } from '../sketch/useSketchSession';
import {
  activeSpotAtom,
  spotDraftAtom,
  spotFootprintAdjustingAtom,
  spotFootprintAtom,
  spotPlacingAtom,
  spotReadingAtom,
  spotSketchAtom,
} from '../spots/atoms';
import { useSpotPinAdjust } from '../spots/pinAdjust';
import { useSpotPlacement } from '../spots/pinPlace';
import { useSpotShareLink } from '../spots/shareLink';
import { useSpotLayer } from '../spots/spotLayer';
import { useSpotRecords } from '../spots/spotRecords';
import { useSpotScores } from '../spots/spotScores';
import { useSpotStars } from '../spots/spotStars';
import styles from './SpotBox.module.css';
import { SpotCard } from './SpotCard';
import { SpotLinkFailed } from './SpotLinkFailed';
import { SpotPlacePrompt } from './SpotPlacePrompt';
import { SpotProperties } from './SpotProperties';
import { useSpotDraft } from './useSpotDraft';

const SketchCanvas = lazy(() =>
  import('../sketch/SketchCanvas').then((mod) => ({
    default: mod.SketchCanvas,
  })),
);

const SpotPropertiesBox = () => {
  const draft = useAtomValue(spotDraftAtom);
  const active = useAtomValue(activeSpotAtom);
  const spot = useSpotDraft(
    draft!,
    active?.id === draft?.recordId ? active : null,
  );
  return <SpotProperties spot={spot} />;
};

const DraftGroundLoop = ({
  loop,
}: {
  loop: NonNullable<DraftGround['loop']>;
}) => {
  useEvidenceLoopOverlay(loop.url, loop.extent, 1, loop.bandTop);
  return null;
};

export const SpotSurface = () => {
  const draft = useAtomValue(spotDraftAtom);
  const placing = useAtomValue(spotPlacingAtom);
  const active = useAtomValue(activeSpotAtom);
  const reading = useAtomValue(spotReadingAtom);
  const session = useAtomValue(sketchSessionAtom);
  const drawn = useAtomValue(spotSketchAtom);
  const ground = useAtomValue(draftGroundAtom);
  const context = useAtomValue(uiContextAtom);

  const editing = draft !== null;
  const shown = useMemo(
    () => (session ? null : sketchOf(editing ? drawn : active?.sketch)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, editing, drawn, active?.id, active?.updated],
  );

  useEffect(() => {
    if (!editing && !placing) return;
    void import('../sketch/SketchCanvas');
  }, [editing, placing]);

  useSpotRecords();
  useSpotScores();
  useSpotStars();
  useSpotLayer();
  useSpotShareLink();
  useSpotPlacement();
  useSpotPinAdjust();
  useRectangleAdjust({
    rectAtom: spotFootprintAtom,
    activeAtom: spotFootprintAdjustingAtom,
    layerId: 'spotFootprintAdjustLayer',
    maxSideM: maxBoundaryMetres(),
    snap: snapBoundaryMetric,
  });
  useSketchSession(draft?.stage === 'sketch');
  useSketchOverlay(shown);
  useAllSketchesLayer();
  useEvidenceOverlay(ground && !ground.loop ? ground.tiles : [], 1);

  return (
    <>
      {ground?.loop && <DraftGroundLoop loop={ground.loop} />}
      {session && (
        <Suspense fallback={null}>
          <SketchCanvas key={session.id} session={session} />
        </Suspense>
      )}
      {placing ? <SpotPlacePrompt /> : <SpotLinkFailed />}
      <div className={context === 'draw' ? styles.away : undefined}>
        {draft?.box === 'editor' ? (
          <SpotPropertiesBox key={draft.id} />
        ) : (
          active &&
          (reading ? (
            <EvidenceReader key={active.id} spot={active} />
          ) : (
            <SpotCard key={active.id} spot={active} />
          ))
        )}
      </div>
    </>
  );
};
