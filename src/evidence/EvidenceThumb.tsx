import { evidenceFileUrl, type EvidenceRecord } from '../api/evidence';
import { isVideoEvidence } from './spec';

export const EvidenceThumb = ({
  record,
  className,
  alt = '',
}: {
  record: EvidenceRecord;
  className?: string;
  alt?: string;
}) =>
  isVideoEvidence(record) ? (
    <video
      className={className}
      src={`${evidenceFileUrl(record)}#t=0.1`}
      preload="metadata"
      muted
      playsInline
      disablePictureInPicture
      aria-hidden="true"
    />
  ) : (
    <img
      className={className}
      src={evidenceFileUrl(record, '200x200')}
      alt={alt}
    />
  );
