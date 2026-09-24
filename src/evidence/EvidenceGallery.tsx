import { Alert, Button, Group, Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';

import { evidenceFileUrl, type EvidenceRecord } from '../api/evidence';
import type { SpotRecord } from '../api/spots';
import { ControlButton } from '../ui/ControlButton';
import { Icon } from '../ui/Icon';
import { useEvidenceDownload } from './download';
import styles from './EvidenceGallery.module.css';
import {
  downloadLabel,
  evidenceLabel,
  evidenceResolution,
  evidenceTitle,
  isVideoEvidence,
  KIND_ICON,
} from './labels';
import type { RenderState } from './queue';
import type { SpotEvidence } from './useSpotEvidence';

const EvidenceItem = ({
  record,
  state,
  mayEdit,
  downloading,
  downloadFailed,
  onDownload,
  onRetry,
  onRemove,
}: {
  record: EvidenceRecord;
  state: RenderState | undefined;
  mayEdit: boolean;
  downloading: boolean;
  downloadFailed: boolean;
  onDownload: () => void;
  onRetry: () => void;
  onRemove: () => void;
}) => {
  const { t } = useTranslation();
  const title = evidenceLabel(record);
  const video = isVideoEvidence(record);
  // PocketBase makes no thumbnail for a video, so a loop is its own handle.
  const thumb = video
    ? evidenceFileUrl(record)
    : evidenceFileUrl(record, '200x200');
  const metresPerPx = evidenceResolution(record);
  const note =
    state === 'queued' || state === 'running'
      ? t('evidence.rendering')
      : state === 'failed'
        ? t('evidence.renderFailed')
        : state === 'empty'
          ? t('evidence.renderEmpty')
          : metresPerPx != null
            ? t('evidence.resolution', { m: metresPerPx.toFixed(2) })
            : '';

  return (
    <div className={styles.item}>
      {thumb ? (
        // To the file itself: the thumbnail is a handle, the render at the
        // source's own resolution is the artifact.
        <Tooltip label={t('evidence.open')}>
          <a href={evidenceFileUrl(record)} target="_blank" rel="noreferrer">
            {video ? (
              // `#t=0.1` so a frame is painted rather than a black box: with
              // `preload="metadata"` alone, nothing is decoded until play.
              <video
                className={styles.thumb}
                src={`${thumb}#t=0.1`}
                preload="metadata"
                muted
                playsInline
                aria-label={title}
              />
            ) : (
              <img className={styles.thumb} src={thumb} alt={title} />
            )}
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
      {/* Not behind `mayEdit`: a visitor reading somebody else's public spot is
          exactly who wants a citable figure out of it. */}
      {thumb && (
        <Tooltip label={downloadLabel({ downloading, failed: downloadFailed })}>
          <ControlButton
            icon={downloading ? 'hourglass_top' : 'download'}
            aria-label={t('evidence.download')}
            disabled={downloading}
            onClick={onDownload}
          />
        </Tooltip>
      )}
      {mayEdit && state === 'failed' && (
        <Tooltip label={t('evidence.retry')}>
          <ControlButton
            icon="refresh"
            aria-label={t('evidence.retry')}
            onClick={onRetry}
          />
        </Tooltip>
      )}
      {mayEdit && (
        <Tooltip label={t('evidence.remove')}>
          <ControlButton
            icon="delete"
            aria-label={t('evidence.remove')}
            onClick={onRemove}
          />
        </Tooltip>
      )}
    </div>
  );
};

export const EvidenceGallery = ({
  spot,
  evidence,
}: {
  spot: SpotRecord;
  evidence: SpotEvidence;
}) => {
  const { t } = useTranslation();
  const { items, offers, mayEdit, mayKeep } = evidence;
  const file = useEvidenceDownload(spot);

  if (!mayEdit && (items === null || items.length === 0)) return null;

  return (
    <div className={styles.gallery}>
      <div className={styles.head}>
        <Icon icon="photo_library" size={14} />
        <span>{t('evidence.label')}</span>
      </div>

      {mayEdit && !mayKeep && (
        <div className={styles.note}>{t('evidence.needsFootprint')}</div>
      )}

      {mayKeep && offers.length > 0 && (
        <Group gap="xs" mt="xs">
          {offers.map((offer) => {
            const what = evidenceTitle(offer.spec);
            return (
              <Button
                key={offer.spec.kind}
                size="compact-xs"
                variant="default"
                disabled={offer.kept}
                leftSection={
                  <Icon icon={KIND_ICON[offer.spec.kind]} size={14} />
                }
                onClick={() => evidence.keep(offer.spec)}
              >
                {offer.kept
                  ? t('evidence.kept', { what })
                  : t('evidence.keep', { what })}
              </Button>
            );
          })}
        </Group>
      )}

      {items && items.length > 0 && (
        <div className={styles.list}>
          {items.map((record) => (
            <EvidenceItem
              key={record.id}
              record={record}
              state={evidence.stateOf(record)}
              mayEdit={mayEdit}
              downloading={file.busyId === record.id}
              downloadFailed={file.failedId === record.id}
              onDownload={() => file.download(record)}
              onRetry={() => evidence.retry(record)}
              onRemove={() => evidence.remove(record.id)}
            />
          ))}
        </div>
      )}

      {evidence.failed && (
        <Alert color="red" mt="xs" p="xs">
          {t('evidence.failed')}
        </Alert>
      )}
    </div>
  );
};
