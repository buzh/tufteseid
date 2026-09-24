// The evidence kept on a spot, and the buttons that keep more. Thin on
// purpose: a row is a thumbnail, what it is a picture of, and where its render
// stands.

import { Alert, Button, Group, Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';

import { evidenceFileUrl, type EvidenceRecord } from '../api/evidence';
import type { SpotRecord } from '../api/spots';
import { ControlButton } from '../ui/ControlButton';
import { Icon } from '../ui/Icon';
import { useEvidenceDownload } from './download';
import styles from './EvidenceGallery.module.css';
import { evidenceResolution, evidenceTitle, KIND_ICON } from './labels';
import type { RenderState } from './queue';
import { specOf } from './spec';
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
  const { t: translate } = useTranslation();
  const spec = specOf(record);
  const title = spec ? evidenceTitle(spec) : translate('evidence.unreadable');
  const thumb = evidenceFileUrl(record, '200x200');
  const metresPerPx = evidenceResolution(record);
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
      {/* Not behind `mayEdit`: a visitor reading somebody else's public spot is
          exactly who wants a citable figure out of it. */}
      {thumb && (
        <Tooltip
          label={translate(
            downloadFailed
              ? 'evidence.downloadFailed'
              : downloading
                ? 'evidence.downloading'
                : 'evidence.download',
          )}
        >
          <ControlButton
            icon={downloading ? 'hourglass_top' : 'download'}
            aria-label={translate('evidence.download')}
            disabled={downloading}
            onClick={onDownload}
          />
        </Tooltip>
      )}
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

export const EvidenceGallery = ({
  spot,
  evidence,
}: {
  spot: SpotRecord;
  evidence: SpotEvidence;
}) => {
  const { t: translate } = useTranslation();
  const { items, offers, mayEdit, mayKeep } = evidence;
  const file = useEvidenceDownload(spot);

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
          {offers.map((offer) => {
            const what = evidenceTitle(offer.spec);
            return (
              <Button
                key={what}
                size="compact-xs"
                variant="default"
                disabled={offer.kept}
                leftSection={
                  <Icon icon={KIND_ICON[offer.spec.kind]} size={14} />
                }
                onClick={() => evidence.keep(offer.spec)}
              >
                {offer.kept
                  ? translate('evidence.kept', { what })
                  : translate('evidence.keep', { what })}
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
              state={evidence.stateOf(record.id)}
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
          {translate('evidence.failed')}
        </Alert>
      )}
    </div>
  );
};
