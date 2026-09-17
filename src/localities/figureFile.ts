// A figure on its way out of the app. The store holds bare pixels, so this is
// where one acquires the provenance plate — the same stamp the Rapportpakke
// applies, from the same record, so a file taken one at a time and the same
// file inside a bundle are the same file.
//
// `Åpne originalen` deliberately does not come through here: that verb is the
// unretouched raster, and the distinction is worth keeping.

import i18n, { t } from 'i18next';
import { type AttachmentRecord, getAttachmentUrl } from '../api/attachments';
import type { LocalityRecord } from '../api/localities';
import { stampBlob } from '../figure/figure';
import { figureSpecOf, stampContextOf } from '../figure/fromRecord';
import { saveBlob } from '../shared/utils/download';

/** Filesystem- and URL-safe, and short enough to read in a file manager. */
export const slug = (s: string, fallback: string): string => {
  const out = s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .slice(0, 60)
    .replace(/^-+|-+$/g, '');
  return out || fallback;
};

// The server filename's own extension, so a JPEG flyfoto does not leave here
// called `.png`. Defaults rather than throws: every producer writes one.
export const extensionOf = (rec: AttachmentRecord): string => {
  const m = /\.([a-z0-9]+)$/i.exec(rec.file);
  return m ? m[1].toLowerCase() : 'png';
};

const figureFilename = (rec: AttachmentRecord): string =>
  `${slug(
    rec.caption.trim() || t(`localities.bilder.kind.${rec.kind}`),
    rec.kind,
  )}.${extensionOf(rec)}`;

/**
 * Fetch, stamp, save. Throws on a failed fetch so the caller can say so; a
 * failed *stamp* does not throw, because unstamped bytes beat none.
 */
export const downloadFigure = async (
  rec: AttachmentRecord,
  locality: LocalityRecord,
): Promise<void> => {
  const res = await fetch(getAttachmentUrl(rec));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const stamped = await stampBlob(
    await res.blob(),
    figureSpecOf(rec, stampContextOf(locality, i18n.language)),
  );
  saveBlob(stamped, figureFilename(rec));
};
