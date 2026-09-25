// What a legend says, apart from how it is drawn. Two surfaces need it: a
// still is typeset onto a canvas at download time (`stamp.ts`), and a sun loop
// is typeset by the sidecar at render time, because `createImageBitmap` throws
// on a WebM. Which facts a kind answered to is one rule, so it lives here
// rather than in each of them.

import { t } from 'i18next';
import { transform } from 'ol/proj';

import type { EvidenceRecord } from '../api/evidence';
import type { SpotRecord } from '../api/spots';
import {
  CVAT_STYLE,
  lidarStyleLabel,
} from '../map/layers/config/backgroundLayers/lidarProjects';
import { formatPoint } from '../spots/geo';
import { shareUrlOf } from '../spots/shareLink';
import { evidenceFacts, evidenceTitle, specFacts } from './labels';
import { specOf, type EvidenceSpec } from './spec';

export type LegendContent = {
  title: string;
  facts: string[];
  rights: string[];
  link: string;
};

/** What the sidecar is sent: wording, with holes where the facts it reads off
 *  the record go. No `link` — it composes that itself. Mirrors `legend_of` in
 *  `rendersvc/server.py`. */
export type SunLoopLegend = Omit<LegendContent, 'link'> & {
  resolutionFormat: string;
  decimal: string;
};

// The hole the sidecar fills once it knows what it managed to fetch. Matches
// `RESOLUTION_TOKEN` in `rendersvc/legend.py`.
const RESOLUTION_TOKEN = '{res}';

// The hole the sidecar fills with the credit off the record it is rendering.
// The wording around it is ours, but who the author is is not: the band is
// burnt into pixels nobody can edit afterwards, so it may not name whoever
// happened to ask for the render. Matches `CREDIT_TOKEN` in
// `rendersvc/legend.py`.
const CREDIT_TOKEN = '{credit}';

/** A rights holder named on the legend. The holder is a proper name and is
 *  never translated; the terms key resolves to the licence, which is. */
const KARTVERKET = {
  holder: 'Kartverket',
  terms: 'evidence.figure.terms.ccby',
};

// Not open data; the notice follows the image out.
const NORGE_I_BILDER = {
  holder: 'Statens kartverk, Geovekst og kommunene',
  terms: 'evidence.figure.terms.nib',
};

const rightsLine = (role: string, holder: string, terms: string): string =>
  t('evidence.figure.rights.line', { role, holder, terms: t(terms) });

// Float elevation in, pixels out: the two kinds whose picture we made rather
// than fetched, so they name co-authors.
const ourVisualisation = (credit: string): string =>
  rightsLine(
    t('evidence.figure.role.visualisering'),
    credit
      ? t('evidence.figure.rights.authors', {
          author: credit,
          app: t('evidence.figure.app'),
        })
      : t('evidence.figure.app'),
    KARTVERKET.terms,
  );

const heightData = (): string =>
  rightsLine(
    t('evidence.figure.role.hoydedata'),
    KARTVERKET.holder,
    KARTVERKET.terms,
  );

/** Not a rights holder: RVT's authors ask that work using the tools cite them,
 *  and a figure travels away from the README that holds the full references.
 *  Short-form on purpose — rights lines are never shed, so every one of them
 *  makes the band taller. */
const rvtMethod = (): string => t('evidence.figure.rights.method');

/** One line per holder rather than one joined line: Norge i bilder's name
 *  alone is sixty characters. */
const rightsOf = (spec: EvidenceSpec, credit: string): string[] => {
  switch (spec.kind) {
    case 'lidar': {
      // The WMS serves the shading, not the heights, so what Kartverket
      // published here is the picture itself and none of it is ours. The one
      // exception is the cached VAT, which `vat-cache/` computed with RVT.
      const line = rightsLine(
        lidarStyleLabel(spec.style).toLowerCase(),
        KARTVERKET.holder,
        KARTVERKET.terms,
      );
      return spec.style === CVAT_STYLE ? [line, rvtMethod()] : [line];
    }
    // The sidecar shades the same heights the browser does, only more of them.
    case 'terrain':
    case 'sunloop':
      return [heightData(), ourVisualisation(credit), rvtMethod()];
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

/** The rectangle's centre as a place, for the surface that has room to say
 *  where the ground is. */
export const centreOf = (
  bbox25833: [number, number, number, number],
): string => {
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

/**
 * Null for a row whose column no longer describes a render: it has nothing to
 * say about itself, and a caption invented for it would be the opposite of
 * provenance.
 */
export const legendContentFor = (
  rec: EvidenceRecord,
  spot: SpotRecord,
  language: string,
  centre = '',
): LegendContent | null => {
  const spec = specOf(rec);
  if (!spec) return null;
  return {
    title: evidenceTitle(spec),
    facts: evidenceFacts(rec, language, centre),
    rights: rightsOf(spec, spot.credit),
    // A private spot's code resolves to nothing for anyone but its owner, so
    // printing it would be an invitation to a dead link.
    link:
      spot.visibility === 'public'
        ? shareUrlOf(spot.code).replace(/^https?:\/\//, '')
        : '',
  };
};

// The band is otherwise in the reader's language, and `0.50` beside `1,5×`
// reads as a typo. Off Intl rather than a table, and defaulted rather than
// thrown on: a legend is never worth failing a render for.
const decimalSeparator = (language: string): string => {
  try {
    return new Intl.NumberFormat(language).format(1.1).charAt(1) || '.';
  } catch {
    return '.';
  }
};

/**
 * The same band, composed for a server that typesets it. What the client still
 * chooses is the wording; what it may not choose is what the wording asserts,
 * so the credit travels as a hole and the link is left to the sidecar
 * altogether.
 *
 * No centre, and neither the resolution nor the render date: the first is not
 * known before the ground is fetched, and the other two are stale on a row that
 * has been rendered once already — the sidecar substitutes the resolution it
 * achieves.
 */
export const sunLoopLegend = (
  rec: EvidenceRecord,
  spot: SpotRecord,
  language: string,
): SunLoopLegend | null => {
  const spec = specOf(rec);
  if (!spec) return null;
  return {
    title: evidenceTitle(spec),
    facts: specFacts(spec, language),
    // Whether there is an author to name is wording; which author it is is not.
    rights: rightsOf(spec, spot.credit ? CREDIT_TOKEN : ''),
    resolutionFormat: t('evidence.resolution', { m: RESOLUTION_TOKEN }),
    decimal: decimalSeparator(language),
  };
};
