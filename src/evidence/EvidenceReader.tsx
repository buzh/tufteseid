import { ActionIcon, Slider, Tooltip } from '@mantine/core';
import { useAtomValue, useSetAtom } from 'jotai';
import { transformExtent } from 'ol/proj';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { evidenceFileUrl } from '../api/evidence';
import type { SpotRecord } from '../api/spots';
import { useSpotExport } from '../export/useSpotExport';
import { mapAtom } from '../map/atoms';
import { sketchOf } from '../sketch/scene';
import { SketchFade } from '../sketch/SketchFade';
import { activeSpotAtom, spotReadingAtom } from '../spots/atoms';
import { formatPoint } from '../spots/geo';
import { useMayEditSpot } from '../spots/mayEdit';
import { StarControl } from '../spots/StarControl';
import { VoteControl } from '../spots/VoteControl';
import { cx } from '../ui/cx';
import { ControlButton } from '../ui/ControlButton';
import { Hint } from '../ui/Hint';
import { Icon } from '../ui/Icon';
import { Panel } from '../ui/Panel';
import { useFloatingPanel, type PanelLayout } from '../ui/useFloatingPanel';
import { useEvidenceDownload } from './download';
import styles from './EvidenceReader.module.css';
import {
  useEvidenceLoopOverlay,
  useEvidenceOverlay,
  type OverlayTile,
} from './evidenceOverlay';
import { EvidenceThumb } from './EvidenceThumb';
import { EvidenceTransport } from './EvidenceTransport';
import { groupEvidence } from './groups';
import {
  downloadLabel,
  evidenceFacts,
  evidenceLabel,
  exportLabel,
  KIND_ICON,
} from './labels';
import {
  evidenceBandTop,
  evidenceBbox,
  isReadable,
  isVideoEvidence,
  loopStepDeg,
} from './spec';
import { useSpotEvidence } from './useSpotEvidence';

// Room for the band above and for wherever the box starts out, so the
// footprint lands in the open ground rather than under either.
const FIT_PADDING: Record<PanelLayout, number[]> = {
  wide: [80, 40, 200, 40],
  tall: [80, 360, 40, 40],
};

const FIT_MS = 400;

const LAYOUT_ICON = { wide: 'dock_to_bottom', tall: 'dock_to_right' } as const;

const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

export const EvidenceReader = ({ spot }: { spot: SpotRecord }) => {
  const { t } = useTranslation();
  const map = useAtomValue(mapAtom);
  const setReading = useSetAtom(spotReadingAtom);
  const setActive = useSetAtom(activeSpotAtom);
  const mayEdit = useMayEditSpot(spot);
  const { items } = useSpotEvidence(spot);
  const box = useFloatingPanel();
  const file = useEvidenceDownload(spot);
  const bundle = useSpotExport(spot, items);

  const readable = useMemo(() => (items ?? []).filter(isReadable), [items]);

  // One entry per picture, its tiles gathered: a mosaic reads as one thing to
  // flip to and lays all its tiles at once.
  const groups = useMemo(() => groupEvidence(readable), [readable]);

  // Held by key, not by index: a render landing or a row being deleted
  // reshuffles the list under the reader.
  const [shownKey, setShownKey] = useState<string | null>(null);
  // Nothing flipped to yet, or the group that was is gone: fall back to the
  // first, which holds the cover. The strip marks the group being read, not
  // the key asked for, or a dead key would leave nothing pressed.
  const index = Math.max(
    0,
    groups.findIndex((group) => group.key === shownKey),
  );
  const group = groups[index] ?? null;
  const shown = group?.key;
  const current = group?.cover ?? null;

  const [transparency, setTransparency] = useState(0);

  // Two overlays, one at a time: an `ImageStatic` cannot carry a WebM, and a
  // loop is always a single tile (the sidecar does not fan out yet).
  const loop = current && isVideoEvidence(current) ? current : null;
  const stillTiles = useMemo<OverlayTile[]>(() => {
    if (!group || isVideoEvidence(group.cover)) return [];
    const out: OverlayTile[] = [];
    for (const rec of group.rows) {
      const extent = evidenceBbox(rec);
      if (extent) out.push({ url: evidenceFileUrl(rec), extent });
    }
    return out;
  }, [group]);

  useEvidenceOverlay(stillTiles, 1 - transparency / 100);
  const transport = useEvidenceLoopOverlay(
    loop ? evidenceFileUrl(loop) : '',
    loop ? evidenceBbox(loop) : null,
    1 - transparency / 100,
    loop ? evidenceBandTop(loop) : 1,
  );

  const step = useCallback(
    (delta: number) => {
      if (groups.length === 0) return;
      const next = (index + delta + groups.length) % groups.length;
      setShownKey(groups[next].key);
    },
    [index, groups],
  );

  // Arrow keys flip, not pan: OL's `keyboardEventTarget` is the document, so
  // capture phase on the document gets in front of its pan. Up/down are
  // swallowed too, or half the cluster would slide the ground out from under
  // the pictures.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!ARROWS.includes(event.key)) return;
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
      if (event.key === 'ArrowLeft') step(-1);
      else if (event.key === 'ArrowRight') step(1);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [step]);

  // Back to the card when there is nothing to read — but only for an editor,
  // who has one. For anybody else this box is the spot's whole UI.
  useEffect(() => {
    if (mayEdit && items !== null && readable.length === 0) setReading(false);
  }, [mayEdit, items, readable.length, setReading]);

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
    // Once, on entering the reading: a later realtime update or a moved box
    // must not yank back a reader who has zoomed in to look at something.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  const title = current ? evidenceLabel(current) : '';
  const facts = current ? evidenceFacts(current) : [];

  const hasSketch = sketchOf(spot.sketch) !== null;

  const other: PanelLayout = box.layout === 'wide' ? 'tall' : 'wide';
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
            <VoteControl spot={spot} />
            <StarControl spot={spot} />
            {group && (
              <Tooltip
                label={downloadLabel({
                  downloading: file.busyId === group.cover.id,
                  failed: file.failedId === group.cover.id,
                })}
              >
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  aria-label={t('evidence.download')}
                  disabled={file.busyId === group.cover.id}
                  onClick={() => file.download(group)}
                >
                  <Icon
                    icon={
                      file.busyId === group.cover.id
                        ? 'hourglass_top'
                        : 'download'
                    }
                    size={18}
                  />
                </ActionIcon>
              </Tooltip>
            )}
            <Tooltip
              label={exportLabel({
                running: bundle.busy,
                failed: bundle.failed,
              })}
            >
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                aria-label={t('export.label')}
                disabled={bundle.busy || items === null}
                onClick={bundle.run}
              >
                <Icon
                  icon={bundle.busy ? 'hourglass_top' : 'folder_zip'}
                  size={18}
                />
              </ActionIcon>
            </Tooltip>
            {mayEdit && (
              <Tooltip label={t('spots.edit')}>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  aria-label={t('spots.edit')}
                  onClick={() => setReading(false)}
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
        collapsible={false}
        onClose={() => setActive(null)}
        footer={
          (readable.length > 0 || hasSketch) && (
            <div className={styles.controls}>
              {readable.length > 0 && (
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
                      total: groups.length,
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
              )}

              {current && (
                <div className={styles.caption}>
                  <span className={styles.captionTitle}>{title}</span>
                  {facts.length > 0 && (
                    <span className={styles.facts}>{facts.join(' · ')}</span>
                  )}
                </div>
              )}

              {loop && (
                <EvidenceTransport
                  className={styles.transport}
                  loop={transport}
                  stepDeg={loopStepDeg(loop)}
                />
              )}

              {hasSketch && <SketchFade className={styles.sketch} />}

              {current && (
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
              )}
            </div>
          )
        }
      >
        {spot.description && <p className={styles.prose}>{spot.description}</p>}

        {items === null ? (
          <div className={styles.note}>{t('evidence.loading')}</div>
        ) : readable.length === 0 ? (
          <div className={styles.note}>{t('evidence.none')}</div>
        ) : (
          <Hint
            id="pictureKeys"
            tips={groups.length > 1 ? [t('hints.pictures')] : []}
            keys={['ArrowLeft', 'ArrowRight']}
            position={box.layout === 'wide' ? 'top-start' : 'left-start'}
          >
            <div className={styles.strip}>
              {groups.map((g) => {
                const base = evidenceLabel(g.cover);
                const label =
                  g.rows.length > 1
                    ? `${base} · ${t('evidence.tileCount', { count: g.rows.length })}`
                    : base;
                return (
                  <Tooltip key={g.key} label={label}>
                    <button
                      type="button"
                      className={cx(
                        styles.frame,
                        g.key === shown && styles.frameOn,
                      )}
                      aria-label={label}
                      aria-pressed={g.key === shown}
                      onClick={() => setShownKey(g.key)}
                    >
                      <EvidenceThumb
                        record={g.cover}
                        className={styles.thumb}
                        alt={label}
                      />
                      <Icon
                        icon={KIND_ICON[g.cover.kind]}
                        size={12}
                        className={styles.frameKind}
                      />
                    </button>
                  </Tooltip>
                );
              })}
            </div>
          </Hint>
        )}
      </Panel>

      {/* Pointer-only. The box opens at a size its layout already thought
          about, so there is nothing to miss without one. */}
      <div aria-hidden="true" className={styles.grip} {...box.resizeHandle} />
    </div>
  );
};
