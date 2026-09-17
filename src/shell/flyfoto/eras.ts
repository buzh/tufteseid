import type { FlyfotoProject } from '../../localities/flyfotoProjects';

// Breaks in the Norwegian aerial archive, not round numbers: digital omløp at
// 0.1–0.25 m from 2010, colour at 0.25–0.5 m from 1990, the systematic national
// coverage from 1960, and the early flights before that. The labels are year
// ranges, so they are not translated.
export const FLYFOTO_ERAS = [
  { id: 'e2010', from: 2010, to: null },
  { id: 'e1990', from: 1990, to: 2009 },
  { id: 'e1960', from: 1960, to: 1989 },
  { id: 'e0', from: null, to: 1959 },
] as const;

export type FlyfotoEra = (typeof FLYFOTO_ERAS)[number]['id'] | 'all';

export const eraLabel = (era: (typeof FLYFOTO_ERAS)[number]): string =>
  era.from == null
    ? `–${era.to}`
    : era.to == null
      ? `${era.from}–`
      : `${era.from}–${era.to}`;

// The project year the archive orders by, falling back to the photo date for
// the rows that carry only that.
const projectYear = (p: FlyfotoProject): number | null => {
  if (p.year != null) return p.year;
  const fromDate = p.photoDate ? Number(p.photoDate.slice(0, 4)) : NaN;
  return Number.isFinite(fromDate) ? fromDate : null;
};

const inEra = (p: FlyfotoProject, era: FlyfotoEra): boolean => {
  if (era === 'all') return true;
  const def = FLYFOTO_ERAS.find((e) => e.id === era);
  if (!def) return true;
  const year = projectYear(p);
  // Undated rows appear only under "Alle".
  if (year == null) return false;
  return (
    (def.from == null || year >= def.from) && (def.to == null || year <= def.to)
  );
};

export const filterByEra = (
  projects: FlyfotoProject[],
  era: FlyfotoEra,
): FlyfotoProject[] =>
  era === 'all' ? projects : projects.filter((p) => inEra(p, era));

/** How many of these the viewport has to offer per period, for the chips. */
export const countByEra = (
  projects: FlyfotoProject[],
): Record<FlyfotoEra, number> => {
  const counts = { all: projects.length } as Record<FlyfotoEra, number>;
  for (const era of FLYFOTO_ERAS) {
    counts[era.id] = projects.filter((p) => inEra(p, era.id)).length;
  }
  return counts;
};
