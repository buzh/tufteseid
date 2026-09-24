// The module-level `t` is deliberate: these are strings rather than components.
import { t } from 'i18next';

import type { EvidenceKind, EvidenceRecord } from '../api/evidence';
import { lidarStyleLabel } from '../map/layers/config/backgroundLayers/lidarProjects';
import { usesHorizon } from '../terrain/render';
import type { MaterialSymbol } from '../ui/Icon';
import { evidenceBbox, NIB_MOSAIC, specOf, type EvidenceSpec } from './spec';

export const KIND_ICON: Record<EvidenceKind, MaterialSymbol> = {
  lidar: 'landscape',
  terrain: 'elevation',
  flyfoto: 'photo_camera',
};

export const evidenceTitle = (spec: EvidenceSpec): string => {
  switch (spec.kind) {
    case 'lidar':
      return `${spec.sourceLabel} · ${lidarStyleLabel(spec.style)}`;
    case 'terrain':
      return t(`terrainControls.vis.${spec.vis}`);
    case 'flyfoto':
      return spec.projectId === NIB_MOSAIC
        ? t('flyfotoControls.mosaic')
        : (spec.projectName ?? spec.projectId);
  }
};

export const evidenceLabel = (rec: EvidenceRecord): string => {
  const spec = specOf(rec);
  return spec ? evidenceTitle(spec) : t('evidence.unreadable');
};

/** Pixels and the ground to lay them over: a row missing either cannot be
 *  shown on the map, whatever else it says. */
export const isReadable = (rec: EvidenceRecord): boolean =>
  rec.file !== '' && evidenceBbox(rec) !== null;

export const downloadLabel = (state: {
  downloading: boolean;
  failed: boolean;
}): string =>
  t(
    state.failed
      ? 'evidence.downloadFailed'
      : state.downloading
        ? 'evidence.downloading'
        : 'evidence.download',
  );

export const evidenceResolution = (rec: EvidenceRecord): number | null => {
  const value = rec.meta?.metresPerPx;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const dayOf = (iso: string, language: string): string =>
  new Date(iso).toLocaleDateString(language, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

// Which knobs the visualization actually answered to, mirroring the rows
// `TerrainPanel` offers: a sun angle under a Skyview would be a fact about
// nothing.
const terrainFacts = (
  spec: Extract<EvidenceSpec, { kind: 'terrain' }>,
): string[] => {
  const facts = [spec.model.toUpperCase()];
  if (spec.vis === 'hillshade') {
    facts.push(
      t('evidence.facts.sun', {
        azimuth: spec.azimuth,
        altitude: spec.altitude,
      }),
    );
  } else if (spec.vis === 'multiHillshade') {
    facts.push(t('evidence.facts.altitude', { altitude: spec.altitude }));
  }
  if (
    spec.vis === 'hillshade' ||
    spec.vis === 'multiHillshade' ||
    spec.vis === 'slope'
  ) {
    facts.push(t('evidence.facts.zFactor', { z: spec.zFactor }));
  }
  if (usesHorizon(spec.vis) || spec.vis === 'lrm') {
    facts.push(t('evidence.facts.radius', { m: spec.radius }));
  }
  return facts;
};

/** What the catalogue knew about the source, what the render achieved and when
 *  it was made, in the order it would be cited. */
export const evidenceFacts = (
  rec: EvidenceRecord,
  language: string,
  /** The rectangle's centre, for the surface that has room to say where the
   *  ground is. Goes before the render date rather than after it because the
   *  legend sheds from the end, and where beats when. */
  centre?: string,
): string[] => {
  const spec = specOf(rec);
  const facts: string[] = [];

  if (spec) {
    switch (spec.kind) {
      case 'lidar':
        facts.push(spec.model.toUpperCase());
        if (spec.year != null) {
          facts.push(t('evidence.facts.year', { year: spec.year }));
        }
        if (spec.pointDensity) facts.push(spec.pointDensity);
        break;
      case 'terrain':
        facts.push(...terrainFacts(spec));
        break;
      case 'flyfoto':
        if (spec.photoDate) facts.push(dayOf(spec.photoDate, language));
        else if (spec.year != null) facts.push(String(spec.year));
        break;
    }
  }

  const metresPerPx = evidenceResolution(rec);
  if (metresPerPx != null) {
    facts.push(t('evidence.resolution', { m: metresPerPx.toFixed(2) }));
  }

  if (centre) facts.push(centre);

  const renderedAt = rec.meta?.renderedAt;
  if (typeof renderedAt === 'string' && renderedAt) {
    facts.push(
      t('evidence.facts.rendered', { date: dayOf(renderedAt, language) }),
    );
  }

  return facts;
};
