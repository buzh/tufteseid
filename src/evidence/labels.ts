// The module-level `t` is deliberate: these are strings rather than components.
import { t } from 'i18next';

import type { EvidenceKind, EvidenceRecord } from '../api/evidence';
import { lidarStyleLabel } from '../map/layers/config/backgroundLayers/lidarProjects';
import { isoDay } from '../shared/utils/isoDay';
import { usesHorizon } from '../terrain/render';
import type { MaterialSymbol } from '../ui/Icon';
import type { RenderState } from './queue';
import {
  evidenceResolution,
  NIB_MOSAIC,
  specOf,
  type EvidenceSpec,
} from './spec';

export const KIND_ICON: Record<EvidenceKind, MaterialSymbol> = {
  lidar: 'landscape',
  terrain: 'elevation',
  flyfoto: 'photo_camera',
  sunloop: 'motion_photos_on',
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
    case 'sunloop':
      return t('evidence.sunLoop');
  }
};

export const evidenceLabel = (rec: EvidenceRecord): string => {
  const spec = specOf(rec);
  return spec ? evidenceTitle(spec) : t('evidence.unreadable');
};

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

/** Where the row stands, or what it came out at once it stands nowhere. */
export const renderNote = (
  rec: EvidenceRecord,
  state: RenderState | undefined,
): string => {
  if (state === 'queued' || state === 'running') return t('evidence.rendering');
  if (state === 'failed') return t('evidence.renderFailed');
  if (state === 'empty') return t('evidence.renderEmpty');
  const metresPerPx = evidenceResolution(rec);
  return metresPerPx != null
    ? t('evidence.resolution', { m: metresPerPx.toFixed(2) })
    : '';
};

// Which knobs the visualization actually answered to: a sun angle under a
// Skyview would be a fact about nothing.
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

/** What the catalogue knew about the source: everything true of a row before
 *  any pixel of it exists. Separate from `evidenceFacts` because a row about to
 *  be rendered still holds the previous render's figures. */
export const specFacts = (spec: EvidenceSpec): string[] => {
  switch (spec.kind) {
    case 'lidar': {
      const facts = [spec.model.toUpperCase()];
      if (spec.year != null) {
        facts.push(t('evidence.facts.year', { year: spec.year }));
      }
      if (spec.pointDensity) facts.push(spec.pointDensity);
      return facts;
    }
    case 'terrain':
      return terrainFacts(spec);
    case 'flyfoto':
      // Already `YYYY-MM-DD` off the catalogue.
      if (spec.photoDate) return [spec.photoDate];
      return spec.year != null ? [String(spec.year)] : [];
    case 'sunloop':
      // No azimuth: it is every azimuth, which is what the frame count says.
      return [
        spec.model.toUpperCase(),
        t('evidence.facts.altitude', { altitude: spec.altitude }),
        t('evidence.facts.zFactor', { z: spec.zFactor }),
        t('evidence.facts.frames', { n: Math.round(360 / spec.stepDeg) }),
      ];
  }
};

/** What the catalogue knew about the source, what the render achieved and when
 *  it was made, in the order it would be cited. */
export const evidenceFacts = (
  rec: EvidenceRecord,
  /** The rectangle's centre. Ordered before the render date because the legend
   *  sheds from the end. */
  centre?: string,
): string[] => {
  const spec = specOf(rec);
  const facts: string[] = spec ? specFacts(spec) : [];

  const metresPerPx = evidenceResolution(rec);
  if (metresPerPx != null) {
    facts.push(t('evidence.resolution', { m: metresPerPx.toFixed(2) }));
  }

  if (centre) facts.push(centre);

  const renderedAt = rec.meta?.renderedAt;
  if (typeof renderedAt === 'string' && renderedAt) {
    facts.push(t('evidence.facts.rendered', { date: isoDay(renderedAt) }));
  }

  return facts;
};
