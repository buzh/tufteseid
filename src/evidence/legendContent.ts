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

export type SunLoopLegend = Omit<LegendContent, 'link' | 'centre'> & {
  resolutionFormat: string;
  decimal: string;
};

const RESOLUTION_TOKEN = '{res}';

const CREDIT_TOKEN = '{credit}';

const KARTVERKET = {
  holder: 'Kartverket',
  terms: 'evidence.figure.terms.ccby',
};

const NORGE_I_BILDER = {
  holder: 'Statens kartverk, Geovekst og kommunene',
  terms: 'evidence.figure.terms.nib',
};

const rightsLine = (role: string, holder: string, terms: string): string =>
  t('evidence.figure.rights.line', { role, holder, terms: t(terms) });

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

const rvtMethod = (): string => t('evidence.figure.rights.method');

const rightsOf = (spec: EvidenceSpec, credit: string): string[] => {
  switch (spec.kind) {
    case 'lidar': {
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
    link:
      spot.visibility === 'public'
        ? shareUrlOf(spot.code).replace(/^https?:\/\//, '')
        : '',
  };
};

const decimalSeparator = (language: string): string => {
  try {
    return new Intl.NumberFormat(language).format(1.1).charAt(1) || '.';
  } catch {
    return '.';
  }
};

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
    rights: rightsOf(spec, spot.credit ? CREDIT_TOKEN : ''),
    resolutionFormat: t('evidence.resolution', { m: RESOLUTION_TOKEN }),
    decimal: decimalSeparator(language),
  };
};
