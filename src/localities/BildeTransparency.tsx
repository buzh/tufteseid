import { useAtomValue } from 'jotai';
import { Overlay } from 'ol';
import { transformExtent } from 'ol/proj';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { mapAtom } from '../map/atoms';
import styles from './BildeTransparency.module.css';
import type { LocalityWorkspaceApi } from './useLocalityWorkspace';

/**
 * Transparens for the pinned bilde, pinned to the rectangle's **top-right**
 * corner — opposite the name chip `localityLayer.ts` draws on the top-left.
 *
 * It used to hang off the selected card in the filmstrip and the carousel,
 * which put it in the wrong place twice over. It was only there while the card
 * you had selected happened to be the card that was on the ground, so walking
 * the rail to read another caption took the slider away from an image that was
 * still up; and it asked you to look at the bottom edge of the screen while
 * dragging something whose whole effect is in the middle of it. Fading a 1937
 * ortofoto off today's hillshade is a *comparison*, and a comparison is watched
 * at the thing being compared.
 *
 * So it is an `ol/Overlay` like `FunnCallout`, for the same reason: it stays on
 * the rectangle while you pan, and it is legible as belonging to that rectangle
 * rather than to the app. The two corners divide the honest labour of the
 * frame — the left one says which lokalitet this is, the right one says how
 * much of it you are seeing through.
 *
 * **0 % is opaque.** The word is transparency, so the number has to count what
 * the word names; `usePinnedBilde` still holds opacity, and the flip happens
 * here, at the one surface that says it out loud.
 *
 * Absent while "Juster området" is live: the corner it sits on is a resize
 * handle then, and a slider over a handle is a slider you grab by accident.
 */
export const BildeTransparency = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t } = useTranslation();
  const map = useAtomValue(mapAtom);
  const { pinned, locality, adjusting } = ws;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<Overlay | null>(null);

  if (!containerRef.current) {
    containerRef.current = document.createElement('div');
  }

  const shown = pinned.pinnedId != null && !adjusting;

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const overlay = new Overlay({
      element,
      // The name chip's mirror: it is drawn at the top-left corner with its
      // baseline just above the edge, so this one hangs its bottom-right there.
      positioning: 'bottom-right',
      offset: [-2, -4],
      // The track has to be draggable; without this OpenLayers reads the press
      // as the start of a pan and the thumb never moves.
      stopEvent: true,
    });
    overlayRef.current = overlay;
    map.addOverlay(overlay);
    return () => {
      map.removeOverlay(overlay);
      overlayRef.current = null;
    };
  }, [map]);

  const bboxKey = locality.bbox.join(',');
  useEffect(() => {
    if (!shown) {
      overlayRef.current?.setPosition(undefined);
      return;
    }
    const projection = map.getView().getProjection().getCode();
    const [, , maxX, maxY] = transformExtent(
      locality.bbox,
      'EPSG:4326',
      projection,
    );
    overlayRef.current?.setPosition([maxX, maxY]);
    // `bboxKey` rather than the array: a patched record is a new array every
    // time, and re-seating the overlay on every realtime event would fight the
    // drag that caused the patch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, bboxKey, shown]);

  if (!shown || !containerRef.current) return null;

  const transparency = 100 - pinned.opacity;

  return createPortal(
    <div className={styles.chip}>
      <label className={styles.label} htmlFor="bilde-transparency">
        {t('localities.bilder.transparency')}
      </label>
      <input
        id="bilde-transparency"
        className={styles.range}
        type="range"
        min={0}
        max={100}
        step={5}
        value={transparency}
        // Streamed, not committed on release: what is being watched is the
        // ground coming through, and a fade that only arrives when you let go
        // cannot be aimed.
        onChange={(e) => pinned.setOpacity(100 - Number(e.target.value))}
      />
      <span className={styles.value}>{transparency} %</span>
    </div>,
    containerRef.current,
  );
};
