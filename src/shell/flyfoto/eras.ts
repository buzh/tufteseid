import type { FlyfotoProject } from '../../localities/flyfotoProjects';

/*
 * Periods of Norwegian aerial photography, as a filter over the acquisition
 * list.
 *
 * The list the viewport query returns is complete, which is the problem: an
 * Oslo-sized bbox intersects on the order of a hundred acquisitions, and the
 * handful that answer "what did this field look like before the road" are
 * buried under twenty years of near-identical modern omløp. Ranking cannot
 * fix that the way it does for LiDAR — the index returns no geometry, so
 * there is no coverage ratio to rank by, and every row here is equally
 * relevant to the screen. What differs is *when*.
 *
 * Four periods rather than ten decades, and they are breaks in the archive
 * rather than round numbers: 2010 onwards is the digital omløp at 0.1–0.25 m,
 * 1990–2009 is colour at 0.25–0.5 m, 1960–1989 is the systematic national
 * coverage, and everything before that is the early flights — mostly black
 * and white, mostly the only picture of the ground before the post-war
 * rebuild, and the ones an armchair reading is usually after.
 *
 * The labels are the year ranges themselves, so they are not translated; only
 * "Alle" is a word.
 */
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

/**
 * When the flight was flown. `aar` is the project year and is what the
 * archive orders by, but a few rows carry only a photo date, so fall back to
 * that rather than dropping them out of every period.
 */
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
  // Undated rows appear only under "Alle". A period is a claim about when,
  // and a row that cannot support the claim should not answer it.
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
