// Reading a spot: its kept renders laid back on the ground they were made
// over, one at a time. Every row covers the same rectangle, so flipping
// through them holds the ground still and changes only how it was seen —
// which is the whole argument a spot makes.

import { ActionIcon, Slider, Tooltip } from '@mantine/core';
import { useAtomValue, useSetAtom } from 'jotai';
import { transformExtent } from 'ol/proj';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { evidenceFileUrl } from '../api/evidence';
import type { SpotRecord } from '../api/spots';
import { mapAtom } from '../map/atoms';
import { sketchOf } from '../sketch/scene';
import { SketchFade } from '../sketch/SketchFade';
import { editSpotDraftAtom, spotReadingAtom } from '../spots/atoms';
import { formatPoint } from '../spots/geo';
import { useMayEditSpot } from '../spots/mayEdit';
import { cx } from '../ui/cx';
import { ControlButton } from '../ui/ControlButton';
import { Icon } from '../ui/Icon';
import { Panel } from '../ui/Panel';
import styles from './EvidenceReader.module.css';
import { useEvidenceOverlay } from './evidenceOverlay';
import { evidenceFacts, evidenceTitle, KIND_ICON } from './labels';
import { useReaderWindow, type ReaderLayout } from './readerWindow';
import { evidenceBbox, specOf } from './spec';
import { useSpotEvidence } from './useSpotEvidence';

// Room for the band above and for wherever the box starts out, so the
// footprint lands in the open ground rather than under either.
const FIT_PADDING: Record<ReaderLayout, number[]> = {
  wide: [80, 40, 200, 40],
  tall: [80, 360, 40, 40],
};

const FIT_MS = 400;

const LAYOUT_ICON = { wide: 'dock_to_bottom', tall: 'dock_to_right' } as const;

export const EvidenceReader = ({ spot }: { spot: SpotRecord }) => {
  const { t, i18n } = useTranslation();
  const map = useAtomValue(mapAtom);
  const setReading = useSetAtom(spotReadingAtom);
  const edit = useSetAtom(editSpotDraftAtom);
  const mayEdit = useMayEditSpot(spot);
  const { items } = useSpotEvidence(spot);
  const box = useReaderWindow();

  // A row with no pixels or no rectangle cannot be laid on the ground, so it
  // is not part of the reading — the gallery on the card is where it is
  // waited on.
  const readable = useMemo(
    () => (items ?? []).filter((rec) => rec.file && evidenceBbox(rec)),
    [items],
  );

  // Held by id, not by index: a render landing or a row being deleted
  // reshuffles the list under the reader.
  const [shownId, setShownId] = useState<string | null>(null);
  const index = Math.max(
    0,
    readable.findIndex((rec) => rec.id === shownId),
  );
  const current = readable[index] ?? null;

  const [transparency, setTransparency] = useState(0);

  useEvidenceOverlay(
    current ? evidenceFileUrl(current) : '',
    current ? evidenceBbox(current) : null,
    1 - transparency / 100,
  );

  const step = useCallback(
    (delta: number) => {
      if (readable.length === 0) return;
      const next = (index + delta + readable.length) % readable.length;
      setShownId(readable[next].id);
    },
    [index, readable],
  );

  // Arrow keys flip rather than pan: `keyboardEventTarget` is the document, so
  // OpenLayers' own pan would otherwise answer the same press. Capture phase
  // on the document is what gets in front of it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          'input, textarea, [role="slider"], [role="menu"], [role="dialog"]',
        )
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      step(event.key === 'ArrowLeft' ? -1 : 1);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [step]);

  // A reading with nothing to read is not a reading: a share link to a spot
  // whose renders were deleted falls back to the card.
  useEffect(() => {
    if (items !== null && readable.length === 0) setReading(false);
  }, [items, readable.length, setReading]);

  useEffect(() => {
    const footprint = spot.footprint;
    if (!footprint) return;
    const view = map.getView();
    // The share link's own centring may still be running, and two animations
    // on one view fight rather than replace.
    view.cancelAnimations();
    view.fit(
      transformExtent(footprint, 'EPSG:4326', view.getProjection().getCode()),
      { padding: FIT_PADDING[box.layout], duration: FIT_MS },
    );
    // Once, on entering the reading, against the layout the box opens in. The
    // reader mounts with it, and neither a realtime update of an unrelated
    // field nor a box moved out of the way afterwards may yank back a reader
    // who has zoomed in to look at something.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  const spec = current ? specOf(current) : null;
  const title = spec
    ? evidenceTitle(spec)
    : current
      ? t('evidence.unreadable')
      : '';
  const facts = current ? evidenceFacts(current, i18n.language) : [];

  const hasSketch = sketchOf(spot.sketch) !== null;

  // The switch offers the other shape, and says so.
  const other: ReaderLayout = box.layout === 'wide' ? 'tall' : 'wide';
  const otherLabel = t(`evidence.layout.${other}`);

  return (
    <div
      ref={box.boxRef}
      className={cx(
        styles.reader,
        styles[box.layout],
        box.placed && styles.placed,
      )}
      style={box.placementStyle}
    >
      <Panel
        className={styles.panel}
        icon="menu_book"
        title={spot.name}
        status={
          spot.credit
            ? `${t('spots.credit', { name: spot.credit })} · ${formatPoint(spot.point)}`
            : formatPoint(spot.point)
        }
        handle={box.dragHandle}
        actions={
          <>
            {/* The reading stands in for the card, so without this the card's
                own edit button is behind a close that reads as leaving the
                spot altogether. The draft returns here when it is put down. */}
            {mayEdit && (
              <Tooltip label={t('spots.edit')}>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  aria-label={t('spots.edit')}
                  onClick={() => edit(spot)}
                >
                  <Icon icon="edit" size={18} />
                </ActionIcon>
              </Tooltip>
            )}
            <Tooltip label={otherLabel}>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                aria-label={otherLabel}
                onClick={() => box.setLayout(other)}
              >
                <Icon icon={LAYOUT_ICON[other]} size={18} />
              </ActionIcon>
            </Tooltip>
          </>
        }
        // The box moves, resizes and closes; folding it away as well would be
        // a fourth way to make it stop covering something.
        collapsible={false}
        onClose={() => setReading(false)}
        footer={
          <div className={styles.controls}>
            <div className={styles.nav}>
              <Tooltip label={t('evidence.previous')}>
                <ControlButton
                  icon="chevron_left"
                  aria-label={t('evidence.previous')}
                  onClick={() => step(-1)}
                />
              </Tooltip>
              <span className={styles.count}>
                {t('evidence.position', {
                  index: index + 1,
                  total: readable.length,
                })}
              </span>
              <Tooltip label={t('evidence.next')}>
                <ControlButton
                  icon="chevron_right"
                  aria-label={t('evidence.next')}
                  onClick={() => step(1)}
                />
              </Tooltip>
            </div>

            {/* In the slack between the buttons and the slider rather than on
                a line of its own: in the bar layout there is nothing else to
                put there. */}
            {current && (
              <div className={styles.caption}>
                <span className={styles.captionTitle}>{title}</span>
                {facts.length > 0 && (
                  <span className={styles.facts}>{facts.join(' · ')}</span>
                )}
              </div>
            )}

            {/* The drawing is over the pictures, and is an argument about
                them rather than part of them. */}
            {hasSketch && <SketchFade className={styles.sketch} />}

            <div className={styles.fade}>
              <Tooltip label={t('terrainControls.transparency')}>
                <span className={styles.fadeIcon}>
                  <Icon icon="opacity" size={16} />
                </span>
              </Tooltip>
              <Slider
                className={styles.slider}
                size="xs"
                min={0}
                max={100}
                step={5}
                label={(value) => `${value} %`}
                aria-label={t('terrainControls.transparency')}
                value={transparency}
                onChange={setTransparency}
              />
            </div>
          </div>
        }
      >
        {spot.description && <p className={styles.prose}>{spot.description}</p>}

        {items === null ? (
          <div className={styles.note}>{t('evidence.loading')}</div>
        ) : (
          <div className={styles.strip}>
            {readable.map((rec) => {
              const recSpec = specOf(rec);
              const label = recSpec
                ? evidenceTitle(recSpec)
                : t('evidence.unreadable');
              return (
                <Tooltip key={rec.id} label={label}>
                  <button
                    type="button"
                    className={cx(
                      styles.frame,
                      rec.id === current?.id && styles.frameOn,
                    )}
                    aria-label={label}
                    aria-pressed={rec.id === current?.id}
                    onClick={() => setShownId(rec.id)}
                  >
                    <img
                      className={styles.thumb}
                      src={evidenceFileUrl(rec, '200x200')}
                      alt={label}
                    />
                    <Icon
                      icon={KIND_ICON[rec.kind]}
                      size={12}
                      className={styles.frameKind}
                    />
                  </button>
                </Tooltip>
              );
            })}
          </div>
        )}
      </Panel>

      {/* Pointer-only, and nothing a reader without one is missing: the box
          opens at a size its layout already thought about. */}
      <div aria-hidden="true" className={styles.grip} {...box.resizeHandle} />
    </div>
  );
};
