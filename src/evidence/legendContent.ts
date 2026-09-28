// What a legend says, apart from how it is drawn. Two typesetters need it: a
// still is drawn onto a canvas at download time (`download.ts`), a sun loop by
// the sidecar at render time.

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

type LegendContent = {
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

// The hole the sidecar fills with the credit off the record it is rendering,
// rather than with whoever asked for the render. Matches `CREDIT_TOKEN` in
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

// Float elevation in, pixels out: the kinds whose picture we made rather than
// fetched, so they name co-authors.
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
 *  and a figure travels away from the README that holds the full references. */
const rvtMethod = (): string => t('evidence.figure.rights.method');

/** One line per holder rather than one joined line: Norge i bilder's name
 *  alone is sixty characters. */
const rightsOf = (spec: EvidenceSpec, credit: string): string[] => {
  switch (spec.kind) {
    case 'lidar': {
      // The WMS serves the shading, not the heights: the picture itself is what
      // Kartverket published. The cached VAT is the exception — `vat-cache/`
      // computed that one with RVT.
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

/** The rectangle's centre as a place. */
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

/** Null for a row whose column no longer describes a render: there is nothing
 *  to cite, and an invented caption would be the opposite of provenance. */
export const legendContentFor = (
  rec: EvidenceRecord,
  spot: SpotRecord,
  centre = '',
): LegendContent | null => {
  const spec = specOf(rec);
  if (!spec) return null;
  return {
    title: evidenceTitle(spec),
    facts: evidenceFacts(rec, centre),
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
// reads as a typo. Defaulted rather than thrown on: a legend is never worth
// failing a render for.
const decimalSeparator = (language: string): string => {
  try {
    return new Intl.NumberFormat(language).format(1.1).charAt(1) || '.';
  } catch {
    return '.';
  }
};

/**
 * The same band, composed for a server that typesets it: the client chooses the
 * wording and not what the wording asserts, so the credit travels as a hole and
 * the link is left to the sidecar altogether.
 *
 * No centre, resolution or render date. The first is unknown before the ground
 * is fetched; the sidecar substitutes the resolution it achieves, and the other
 * would describe the previous render.
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
    facts: specFacts(spec),
    // Whether there is an author to name is wording; which author it is is not.
    rights: rightsOf(spec, spot.credit ? CREDIT_TOKEN : ''),
    resolutionFormat: t('evidence.resolution', { m: RESOLUTION_TOKEN }),
    decimal: decimalSeparator(language),
  };
};
