// The evidence kept on a spot, and the buttons that keep more. Thin on
// purpose: a row is a thumbnail, what it is a picture of, and where its render
// stands.

import { Alert, Button, Group, Tooltip } from '@mantine/core';
import { t } from 'i18next';
import { useTranslation } from 'react-i18next';

import {
  evidenceFileUrl,
  type EvidenceKind,
  type EvidenceRecord,
} from '../api/evidence';
import type { SpotRecord } from '../api/spots';
import { lidarStyleLabel } from '../map/layers/config/backgroundLayers/lidarProjects';
import { ControlButton } from '../ui/ControlButton';
import { Icon, type MaterialSymbol } from '../ui/Icon';
import styles from './EvidenceGallery.module.css';
import type { RenderState } from './queue';
import { NIB_MOSAIC, specOf, type EvidenceSpec } from './spec';
import { useSpotEvidence } from './useSpotEvidence';

const KIND_ICON: Record<EvidenceKind, MaterialSymbol> = {
  lidar: 'landscape',
  terrain: 'elevation',
  flyfoto: 'photo_camera',
};

// The module-level `t`, as `lidarStyleLabel` uses: this is also a React key.
const titleOf = (spec: EvidenceSpec): string => {
  switch (spec.kind) {
    case 'lidar':
      return `${spec.sourceLabel} · ${lidarStyleLabel(spec.style)}`;
    case 'terrain':
      return t(`terrainControls.vis.${spec.vis}`);
    case 'flyfoto':
      return spec.projectId === NIB_MOSAIC
        ? t('flyfotoControls.mosaic')
        : (spec.projectName ?? spec.projectId);
  }
};

const metresPerPxOf = (record: EvidenceRecord): number | null => {
  const value = record.meta?.metresPerPx;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const EvidenceItem = ({
  record,
  state,
  mayEdit,
  onRetry,
  onRemove,
}: {
  record: EvidenceRecord;
  state: RenderState | undefined;
  mayEdit: boolean;
  onRetry: () => void;
  onRemove: () => void;
}) => {
  const { t: translate } = useTranslation();
  const spec = specOf(record);
  const title = spec ? titleOf(spec) : translate('evidence.unreadable');
  const thumb = evidenceFileUrl(record, '200x200');
  const metresPerPx = metresPerPxOf(record);
  const note =
    state === 'queued' || state === 'running'
      ? translate('evidence.rendering')
      : state === 'failed'
        ? translate('evidence.renderFailed')
        : state === 'empty'
          ? translate('evidence.renderEmpty')
          : metresPerPx != null
            ? translate('evidence.resolution', { m: metresPerPx.toFixed(2) })
            : '';

  return (
    <div className={styles.item}>
      {thumb ? (
        // To the file itself: the thumbnail is a handle, the render at the
        // source's own resolution is the artifact.
        <Tooltip label={translate('evidence.open')}>
          <a href={evidenceFileUrl(record)} target="_blank" rel="noreferrer">
            <img className={styles.thumb} src={thumb} alt={title} />
          </a>
        </Tooltip>
      ) : (
        <div className={`${styles.thumb} ${styles.pending}`}>
          <Icon
            icon={state === 'failed' ? 'error' : 'hourglass_top'}
            size={20}
          />
        </div>
      )}
      <div className={styles.text}>
        <div className={styles.title}>
          <Icon icon={KIND_ICON[record.kind]} size={12} /> {title}
        </div>
        {note && <div className={styles.note}>{note}</div>}
      </div>
      {mayEdit && state === 'failed' && (
        <Tooltip label={translate('evidence.retry')}>
          <ControlButton
            icon="refresh"
            aria-label={translate('evidence.retry')}
            onClick={onRetry}
          />
        </Tooltip>
      )}
      {mayEdit && (
        <Tooltip label={translate('evidence.remove')}>
          <ControlButton
            icon="delete"
            aria-label={translate('evidence.remove')}
            onClick={onRemove}
          />
        </Tooltip>
      )}
    </div>
  );
};

export const EvidenceGallery = ({ spot }: { spot: SpotRecord }) => {
  const { t: translate } = useTranslation();
  const evidence = useSpotEvidence(spot);
  const { items, offers, mayEdit, mayKeep } = evidence;

  // Nothing kept, nothing to keep and no say in it: a heading over an empty box
  // tells a visitor only that the feature exists.
  if (!mayEdit && (items === null || items.length === 0)) return null;

  return (
    <div className={styles.gallery}>
      <div className={styles.head}>
        <Icon icon="photo_library" size={14} />
        <span>{translate('evidence.label')}</span>
      </div>

      {mayEdit && !mayKeep && (
        <div className={styles.note}>{translate('evidence.needsFootprint')}</div>
      )}

      {mayKeep && offers.length > 0 && (
        <Group gap="xs" mt="xs">
          {offers.map((offer) => (
            <Button
              key={titleOf(offer.spec)}
              size="compact-xs"
              variant="default"
              disabled={offer.kept}
              leftSection={
                <Icon icon={KIND_ICON[offer.spec.kind]} size={14} />
              }
              onClick={() => evidence.keep(offer.spec)}
            >
              {offer.kept
                ? translate('evidence.kept', { what: titleOf(offer.spec) })
                : translate('evidence.keep', { what: titleOf(offer.spec) })}
            </Button>
          ))}
        </Group>
      )}

      {items && items.length > 0 && (
        <div className={styles.list}>
          {items.map((record) => (
            <EvidenceItem
              key={record.id}
              record={record}
              state={evidence.stateOf(record.id)}
              mayEdit={mayEdit}
              onRetry={() => evidence.retry(record)}
              onRemove={() => evidence.remove(record.id)}
            />
          ))}
        </div>
      )}

      {evidence.failed && (
        <Alert color="red" mt="xs" p="xs">
          {translate('evidence.failed')}
        </Alert>
      )}
    </div>
  );
};
