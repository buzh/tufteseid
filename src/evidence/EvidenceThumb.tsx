import { evidenceFileUrl, type EvidenceRecord } from '../api/evidence';
import { isVideoEvidence } from './spec';

// Video quirks: PocketBase makes no thumbnail for a video, so a loop is its own
// handle at full size; `#t=0.1` paints a frame rather than a black box
// (`preload="metadata"` alone decodes nothing until play); `disablePictureInPicture`
// plus the thumbnail's `pointer-events: none` keep the press on the button behind
// it, since Firefox lays a PiP toggle over a video on hover that at this size is
// the whole thumbnail. The caller checks `rec.file` first.
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
