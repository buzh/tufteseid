// What a legend says, apart from how it is drawn. Two typesetters: a still at
// download time (`download.ts`), a sun loop by the sidecar at render time.

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
  centre: string;
  link: string;
};

/** Wording with holes where the sidecar fills facts; no `link` (it composes its
 *  own) and no `centre` (its stacked band has nowhere to put one). Mirrors
 *  `legend_of` in `rendersvc/server.py`. */
export type SunLoopLegend = Omit<LegendContent, 'link' | 'centre'> & {
  resolutionFormat: string;
  decimal: string;
};

// Filled once the sidecar knows what it fetched. Matches `RESOLUTION_TOKEN` in
// `rendersvc/legend.py`.
const RESOLUTION_TOKEN = '{res}';

// Filled with the credit off the rendered record, not whoever asked. Matches
// `CREDIT_TOKEN` in `rendersvc/legend.py`.
const CREDIT_TOKEN = '{credit}';

// The holder is a proper name, never translated; `terms` resolves to the
// licence, which is.
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

// The kinds whose picture we made rather than fetched, so they name co-authors.
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

// Not a rights holder: RVT asks that work using it cite the method, and a
// figure travels away from the README that holds the full references.
const rvtMethod = (): string => t('evidence.figure.rights.method');

// One line per holder: Norge i bilder's name alone is sixty characters.
const rightsOf = (spec: EvidenceSpec, credit: string): string[] => {
  switch (spec.kind) {
    case 'lidar': {
      // The WMS serves the shading, which is what Kartverket published. The
      // cached VAT is the exception — `vat-cache/` computed that one with RVT.
      const line = rightsLine(
        lidarStyleLabel(spec.style).toLowerCase(),
        KARTVERKET.holder,
        KARTVERKET.terms,
      );
      return spec.style === CVAT_STYLE ? [line, rvtMethod()] : [line];
    }
    case 'terrain':
    case 'sunloop':
    case 'rvt':
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

// Null for a row that no longer describes a render: an invented caption would
// be the opposite of provenance.
export const legendContentFor = (
  rec: EvidenceRecord,
  spot: SpotRecord,
  centre = '',
): LegendContent | null => {
  const spec = specOf(rec);
  if (!spec) return null;
  return {
    title: evidenceTitle(spec),
    facts: evidenceFacts(rec),
    rights: rightsOf(spec, spot.credit),
    centre,
    // A private spot's code is a dead link to anyone but its owner.
    link:
      spot.visibility === 'public'
        ? shareUrlOf(spot.code).replace(/^https?:\/\//, '')
        : '',
  };
};

// The band is in the reader's language, and `0.50` beside `1,5×` reads as a
// typo. Defaulted, never thrown: a legend is not worth failing a render for.
const decimalSeparator = (language: string): string => {
  try {
    return new Intl.NumberFormat(language).format(1.1).charAt(1) || '.';
  } catch {
    return '.';
  }
};

// The same band composed for the sidecar to typeset: the client chooses the
// wording, not what it asserts, so the credit travels as a hole. No centre
// (unknown before fetch), resolution (the sidecar substitutes its own) or date.
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
