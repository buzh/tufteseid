import { evidenceFileUrl, type EvidenceRecord } from '../api/evidence';
import { isVideoEvidence } from './spec';

/**
 * The stored file, small. Both the list and the reading strip show one, so the
 * two quirks live here: PocketBase makes no thumbnail for a video, so a loop is
 * its own handle at full size, and `#t=0.1` is what makes the element paint a
 * frame rather than a black box — `preload="metadata"` alone decodes nothing
 * until play.
 *
 * The caller checks `rec.file` first: a row still waiting on its render has no
 * URL to give.
 */
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
      aria-hidden="true"
    />
  ) : (
    <img
      className={className}
      src={evidenceFileUrl(record, '200x200')}
      alt={alt}
    />
  );
