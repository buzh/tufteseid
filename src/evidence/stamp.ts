// The stored file is bare: the reader lays it back on the ground it was made
// over and the sketch draws on top of it, so a band burned into the pixels
// would ride the map and be drawn over. The provenance goes on at the door
// instead, which is why it comes out in the reader's current language.

import { t } from 'i18next';
import { transform } from 'ol/proj';

import type { EvidenceRecord } from '../api/evidence';
import type { SpotRecord } from '../api/spots';
import { lidarStyleLabel } from '../map/layers/config/backgroundLayers/lidarProjects';
import { formatPoint } from '../spots/geo';
import { shareUrlOf } from '../spots/shareLink';
import { evidenceFacts, evidenceResolution, evidenceTitle } from './labels';
import { canvasBlob } from './fit';
import { drawLegend } from './legend';
import { evidenceBbox, specOf, type EvidenceSpec } from './spec';

/** A rights holder named on the legend. The holder is a proper name and is never
 *  translated; the terms key resolves to the licence, which is. */
const KARTVERKET = { holder: 'Kartverket', terms: 'evidence.figure.terms.ccby' };

// Not open data; the notice follows the image out.
const NORGE_I_BILDER = {
  holder: 'Norge i bilder — Kartverket, Geovekst, NIBIO og kommunene',
  terms: 'evidence.figure.terms.nib',
};

const rightsLine = (role: string, holder: string, terms: string): string =>
  t('evidence.figure.rights.line', { role, holder, terms: t(terms) });

/** One line per holder rather than one joined line: Norge i bilder's name
 *  alone is sixty characters. */
const rightsOf = (spec: EvidenceSpec, credit: string): string[] => {
  switch (spec.kind) {
    case 'lidar':
      // The WMS serves the shading, not the heights, so what Kartverket
      // published here is the picture itself and none of it is ours.
      return [
        rightsLine(
          lidarStyleLabel(spec.style).toLowerCase(),
          KARTVERKET.holder,
          KARTVERKET.terms,
        ),
      ];
    case 'terrain':
      return [
        rightsLine(
          t('evidence.figure.role.hoydedata'),
          KARTVERKET.holder,
          KARTVERKET.terms,
        ),
        // Float elevation in, pixels out, in the browser: the one kind whose
        // picture the app made rather than fetched, so it names co-authors.
        rightsLine(
          t('evidence.figure.role.visualisering'),
          credit
            ? t('evidence.figure.rights.authors', {
                author: credit,
                app: t('evidence.figure.app'),
              })
            : t('evidence.figure.app'),
          KARTVERKET.terms,
        ),
      ];
    case 'flyfoto':
      return [
        rightsLine(
          t('evidence.figure.role.ortofoto'),
          NORGE_I_BILDER.holder,
          NORGE_I_BILDER.terms,
        ),
      ];
  }
};

const centreOf = (bbox25833: [number, number, number, number]): string => {
  const [minX, minY, maxX, maxY] = bbox25833;
  try {
    const [lon, lat] = transform(
      [(minX + maxX) / 2, (minY + maxY) / 2],
      'EPSG:25833',
      'EPSG:4326',
    );
    return formatPoint([lon, lat]);
  } catch {
    return '';
  }
};

const decodeToCanvas = async (
  blob: Blob,
): Promise<HTMLCanvasElement | null> => {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    return canvas;
  } finally {
    bitmap.close();
  }
};

/**
 * The stored raster with its provenance on it. Failure is never fatal: an
 * unstamped file is worse than a stamped one and far better than none, so every
 * path that cannot produce a legend returns the bytes it was given.
 *
 * Re-encodes in the type it was handed, so a JPEG ortofoto does not come back a
 * PNG four times the size.
 */
export const stampEvidence = async (
  blob: Blob,
  rec: EvidenceRecord,
  spot: SpotRecord,
  language: string,
): Promise<Blob> => {
  // A row whose column no longer describes a render has nothing to say about
  // itself, and a caption invented for it would be the opposite of provenance.
  const spec = specOf(rec);
  if (!spec) return blob;

  try {
    const canvas = await decodeToCanvas(blob);
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return blob;

    const bbox = evidenceBbox(rec);
    const facts = evidenceFacts(rec, language, bbox ? centreOf(bbox) : '');

    const drawn = await drawLegend(ctx, {
      width: canvas.width,
      height: canvas.height,
      title: evidenceTitle(spec),
      facts,
      rights: rightsOf(spec, spot.credit),
      // A private spot's code resolves to nothing for anyone but its owner, so
      // printing it would be an invitation to a dead link.
      link:
        spot.visibility === 'public'
          ? shareUrlOf(spot.code).replace(/^https?:\/\//, '')
          : '',
      // Off the decoded width rather than `meta.metresPerPx`, so the bar
      // measures the pixels in hand even where the stored figure disagrees
      // with them.
      metresPerPx: bbox
        ? (bbox[2] - bbox[0]) / canvas.width
        : (evidenceResolution(rec) ?? 0),
    });
    // Nothing was painted, so re-encoding would only cost a JPEG generation.
    if (!drawn) return blob;

    const jpeg = blob.type === 'image/jpeg';
    const out = await canvasBlob(
      canvas,
      jpeg ? 'image/jpeg' : 'image/png',
      jpeg ? 0.9 : undefined,
    );
    return out ?? blob;
  } catch (e) {
    console.warn('[evidence] stamp failed', e);
    return blob;
  }
};
