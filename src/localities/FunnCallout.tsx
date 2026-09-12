import { useAtomValue, useSetAtom } from 'jotai';
import { Overlay } from 'ol';
import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { LocalityFindRecord } from '../api/localityFinds';
import { mapAtom } from '../map/atoms';
import { Badge, type BadgePalette, IconButton } from '../ui';
import { funnHiddenAtom, selectedFunnIdAtom } from './atoms';
import styles from './FunnCallout.module.css';
import { getFunnExtentOnLayer } from './funnLayer';

const STATUS_PALETTE: Record<LocalityFindRecord['status'], BadgePalette> = {
  mulig: 'yellow',
  sannsynlig: 'green',
  avkreftet: 'red',
  rapportert: 'blue',
};

/**
 * The selected funn's own words, beside it — docs/lokalitet-view.md §6.
 *
 * The funn list is an index now, in a popover on the row; this is the
 * content. A note about a mound belongs next to the mound, not in a column
 * 400 px to the right of it, and the popover the index lives in closes the
 * moment you touch the map — so the thing you actually wanted to read would
 * have gone with it.
 *
 * Deliberately read-only. Editing a note is a rare, deliberate act performed
 * from the list row that already knows how to do it; a textarea floating over
 * the terrain would be one more surface between you and the ground.
 *
 * It is an `ol/Overlay` rather than a card in a slot, which is what makes it
 * stay on the mound while you pan. `stopEvent` is on: the close button and
 * the link have to be clickable, and OpenLayers would otherwise read the
 * press as the start of a drag.
 *
 * `funnHidden` takes it down with the drawing it annotates — H is a way of
 * looking at the bare ground, and a label sitting exactly where the outline
 * was would defeat the whole gesture.
 */
export const FunnCallout = ({
  items,
}: {
  items: LocalityFindRecord[] | null;
}) => {
  const { t } = useTranslation();
  const map = useAtomValue(mapAtom);
  const selectedId = useAtomValue(selectedFunnIdAtom);
  const funnHidden = useAtomValue(funnHiddenAtom);
  const setSelected = useSetAtom(selectedFunnIdAtom);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<Overlay | null>(null);

  if (!containerRef.current) {
    const el = document.createElement('div');
    containerRef.current = el;
  }

  const funn = useMemo(
    () => items?.find((f) => f.id === selectedId) ?? null,
    [items, selectedId],
  );

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const overlay = new Overlay({
      element,
      positioning: 'bottom-center',
      offset: [0, -12],
      stopEvent: true,
      autoPan: { animation: { duration: 200 } },
    });
    overlayRef.current = overlay;
    map.addOverlay(overlay);
    return () => {
      map.removeOverlay(overlay);
      overlayRef.current = null;
    };
  }, [map]);

  // Re-read the extent off the layer rather than off the record: the layer is
  // where the geometry has been reprojected into the view's coordinates, and
  // it is also what an in-flight geometry edit updates first.
  useEffect(() => {
    const visible = funn && !funnHidden;
    const extent = visible ? getFunnExtentOnLayer(funn.id) : null;
    overlayRef.current?.setPosition(
      extent ? [(extent[0] + extent[2]) / 2, extent[3]] : undefined,
    );
  }, [funn, funnHidden, items]);

  if (!funn || funnHidden || !containerRef.current) return null;

  return createPortal(
    <div className={styles.callout}>
      <div className={styles.head}>
        <span className={styles.title}>{funn.title}</span>
        <Badge palette={STATUS_PALETTE[funn.status]}>
          {t(`localities.funn.status.${funn.status}`)}
        </Badge>
        <IconButton
          icon="close"
          size="xs"
          palette="gray"
          aria-label={t('shared.close')}
          onClick={() => setSelected(null)}
        />
      </div>
      {funn.note && <p className={styles.note}>{funn.note}</p>}
    </div>,
    containerRef.current,
  );
};
