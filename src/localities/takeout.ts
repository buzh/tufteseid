// The Rapportpakke: a lokalitet as one zip — `index.html` and `README.txt`
// carrying the register facts, the images inline in curated order and the funn
// as a table, then `bilder/`, `funn/funn.geojson` and `funn/funn.csv`.
//
// It forces a pin on every unpinned View first, and anything it still could
// not render is named on the front page rather than silently absent.
//
// The page and the README are in the UI language; the data files are not.
// `funn.geojson`'s property names and `funn.csv`'s column heads are fixed
// Norwegian, because a column name that changes with the reader is not a
// schema.

import i18n, { t } from 'i18next';
import {
  type AttachmentKind,
  type AttachmentRecord,
  getAttachmentUrl,
} from '../api/attachments';
import type { LocalityRecord } from '../api/localities';
import type { LocalityFindRecord } from '../api/localityFinds';
import { type Credit, CREDITS, stampBlob } from '../figure/figure';
import {
  authorOf,
  figureSpecOf,
  stampContextOf,
} from '../figure/fromRecord';
import { fetchWithin } from '../shared/utils/deadline';
import { type ZipEntry, zipStore } from '../shared/utils/zip';
import { extensionOf, slug } from './figureFile';
import {
  formatBboxArea,
  formatBboxCentre,
  formatBboxSpan,
  formatDate,
} from './format';
import { funnIdOf } from './funnGroups';
import { isBboxAssumed } from './uploadPlacement';
import { type GroundSpec, isPinned, viewSpecOf } from './viewSpec';

// Per file, not per bundle. `fetchWithin` is a total budget rather than an
// idle one, so it must cover the transfer: `attachments.file` tops out at
// 50 MB, and a shorter clock aborts healthy figures on a slow link and then
// prints them as missing.
const FILE_DEADLINE_MS = 300_000;

export type TakeoutProgress = {
  stage: 'pinning' | 'files' | 'writing';
  done: number;
  total: number;
};

/** `pinNow` as the hook hands it out; null for a caller that may not write. */
type ForcePin = (rec: AttachmentRecord) => Promise<AttachmentRecord | null>;

export type TakeoutResult = {
  blob: Blob;
  filename: string;
  /** Bilder named on the front page but absent from `bilder/`. */
  missing: number;
};

// ---- Small formatters ----

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => {
    if (c === '&') return '&amp;';
    if (c === '<') return '&lt;';
    if (c === '>') return '&gt;';
    return '&quot;';
  });

// RFC 4180: quote anything with a comma, a quote or a newline in it.
const csvField = (s: string): string =>
  /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;

// Author-typed columns only. A spreadsheet reads a cell beginning with `=`,
// `+`, `-` or `@` as a formula, and the person opening this is not the person
// who wrote it, so those get the conventional leading apostrophe. The
// generated columns (`status`, `lat`, `lon`) do not need it.
const csvText = (s: string): string =>
  csvField(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

const captionOf = (rec: AttachmentRecord): string =>
  rec.caption.trim() || t(`localities.bilder.kind.${rec.kind}`);

const deg = (v: number) => v.toFixed(5);

const dateStamp = (d: Date): string =>
  [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');

// ---- What the bundle says about itself ----

type Fact = { label: string; value: string };

const factsOf = (
  loc: LocalityRecord,
  locale: string,
  packedAt: Date,
): Fact[] => {
  const [minLon, minLat, maxLon, maxLat] = loc.bbox;
  const rows: (Fact | null)[] = [
    { label: t('localities.takeout.factCode'), value: loc.code },
    loc.place
      ? { label: t('localities.workspace.place'), value: loc.place }
      : null,
    loc.municipality
      ? {
          label: t('localities.workspace.municipality'),
          value: loc.municipality,
        }
      : null,
    loc.matrikkel
      ? { label: t('localities.workspace.matrikkel'), value: loc.matrikkel }
      : null,
    {
      label: t('localities.takeout.factExtent'),
      value:
        `${deg(minLat)}, ${deg(minLon)} – ` +
        `${deg(maxLat)}, ${deg(maxLon)} (WGS 84)`,
    },
    {
      label: t('localities.workspace.coordinates'),
      value: formatBboxCentre(loc.bbox),
    },
    {
      label: t('localities.takeout.factSpan'),
      value: formatBboxSpan(loc.bbox, locale),
    },
    {
      label: t('localities.workspace.area'),
      value: formatBboxArea(loc.bbox, locale),
    },
    {
      label: t('localities.workspace.owner'),
      value: loc.expand?.owner?.name || t('localities.takeout.ownerUnknown'),
    },
    {
      label: t('localities.workspace.updated'),
      value: formatDate(loc.updated, locale),
    },
    {
      label: t('localities.takeout.factPacked'),
      value: formatDate(packedAt.toISOString(), locale),
    },
  ];
  return rows.filter((row): row is Fact => row != null);
};

// The page's summary credit list; each figure's own caption names the exact
// acquisition. Exhaustive over `AttachmentKind` on purpose, so a kind added
// later is a build error rather than an image nobody is credited for.
const CREDIT_BY_KIND: Record<AttachmentKind, Credit | null> = {
  extract: CREDITS.hoydedata,
  flyfoto: CREDITS.nib,
  // The topographic base, and whatever theme layers were over it — the
  // screenshot's own caption names those.
  screenshot: CREDITS.kartverket,
  // Provenance unknown to the app; the author's own hand; a flatten of
  // things credited in their own right.
  upload: null,
  sketch: null,
  scene: null,
};

// A scene's ground is a `{kind, meta}` pair in its own `meta`, not a member in
// `over`, so walking the membership never sees it. It must be credited
// separately: NiB is the one source here that is not open data.
const CREDIT_BY_GROUND: Record<GroundSpec['kind'], Credit> = {
  lidar: CREDITS.hoydedata,
  terrain: CREDITS.hoydedata,
  flyfoto: CREDITS.nib,
};

const creditsOf = (bilder: readonly AttachmentRecord[]): Credit[] => {
  const byId = new Map(bilder.map((rec) => [rec.id, rec] as const));
  const out: Credit[] = [];
  const add = (credit: Credit | null) => {
    if (credit && !out.some((c) => c.holder === credit.holder)) {
      out.push(credit);
    }
  };
  for (const rec of bilder) {
    add(CREDIT_BY_KIND[rec.kind]);
    // A scene owes what its members owe, resolved against the exhibit rather
    // than the server: a member out of the bundle has no pixels in it either.
    if (rec.kind === 'scene') {
      for (const id of rec.over ?? []) {
        const member = byId.get(id);
        if (member) add(CREDIT_BY_KIND[member.kind]);
      }
      const spec = viewSpecOf(rec);
      if (spec?.kind === 'scene' && spec.ground) {
        add(CREDIT_BY_GROUND[spec.ground.kind]);
      }
    }
  }
  return out;
};

// ---- The funn, as data ----

// The midpoint of everything in the FeatureCollection. A GeometryCollection
// has no `coordinates` and contributes nothing; `src/funn/` writes none.
const centreOf = (find: LocalityFindRecord): [number, number] | null => {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  const visit = (coords: unknown): void => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      const [lon, lat] = coords as number[];
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      return;
    }
    for (const c of coords) visit(c);
  };
  for (const feature of find.geometry?.features ?? []) {
    visit((feature.geometry as { coordinates?: unknown } | null)?.coordinates);
  }
  if (!Number.isFinite(minLon) || !Number.isFinite(minLat)) return null;
  return [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
};

/** A funn with its centre worked out once, for the CSV, the page and the README. */
type FindRow = { find: LocalityFindRecord; centre: [number, number] | null };

const findRowsOf = (finds: readonly LocalityFindRecord[]): FindRow[] =>
  finds.map((find) => ({ find, centre: centreOf(find) }));

/** A funn's name as every surface says it — see `funnSectionsOf`. */
const titleOf = (find: LocalityFindRecord): string =>
  find.title.trim() || t('localities.funn.untitled');

// Flattened, because a FeatureCollection of FeatureCollections is not GeoJSON:
// every feature carries its funn's fields instead.
const geojsonOf = (finds: readonly LocalityFindRecord[]): string => {
  const features = finds.flatMap((find) =>
    (find.geometry?.features ?? []).map((feature) => ({
      ...feature,
      properties: {
        ...(feature.properties ?? {}),
        funn: find.id,
        tittel: titleOf(find),
        notat: find.note,
        status: find.status,
      },
    })),
  );
  const collection = { type: 'FeatureCollection', features };
  return `${JSON.stringify(collection, null, 2)}\n`;
};

// BOM and CRLF, which is what makes a UTF-8 CSV with æøå open correctly in
// Excel by double-click. RFC 4180 comma and dot decimal rather than the
// Norwegian list separator, which would be a guess about the recipient's
// spreadsheet.
const csvOf = (rows: readonly FindRow[]): string => {
  const lines = [['tittel', 'status', 'notat', 'lat', 'lon'].join(',')];
  for (const { find, centre } of rows) {
    lines.push(
      [
        csvText(titleOf(find)),
        csvField(find.status),
        csvText(find.note),
        centre ? centre[1].toFixed(6) : '',
        centre ? centre[0].toFixed(6) : '',
      ].join(','),
    );
  }
  return `\ufeff${lines.join('\r\n')}\r\n`;
};

// ---- The front page ----

type PageImage = {
  rec: AttachmentRecord;
  path: string;
  index: number;
  /** The funn it belongs to, where it belongs to one. */
  funn: string | null;
};

type PageMissing = { label: string; reason: string };

type Page = {
  locality: LocalityRecord;
  facts: Fact[];
  images: PageImage[];
  missing: PageMissing[];
  finds: readonly FindRow[];
  credits: Credit[];
  packedAt: Date;
  locale: string;
};

const STYLE = [
  'body{font:16px/1.55 system-ui,sans-serif;margin:0 auto;max-width:52rem;',
  'padding:2rem 1.25rem;color:#1b1b1b}',
  'h1{margin:0 0 .2rem;font-size:1.9rem}',
  'h2{margin:2.5rem 0 1rem;font-size:1.2rem}',
  '.sub{margin:0 0 1.5rem;color:#5a5a5a}',
  // The description comes from a textarea, so its line breaks are content.
  '.desc{white-space:pre-line}',
  'dl{display:grid;grid-template-columns:max-content 1fr;gap:.35rem 1.25rem}',
  'dt{color:#5a5a5a}dd{margin:0}',
  'figure{margin:0 0 2rem}',
  'img{width:100%;height:auto;border:1px solid #ddd}',
  'figcaption{margin-top:.5rem;color:#5a5a5a;font-size:.95rem}',
  'table{border-collapse:collapse;width:100%}',
  'th,td{border-bottom:1px solid #e3e3e3;padding:.45rem .6rem;',
  'text-align:left;vertical-align:top}',
  'footer{margin-top:3rem;border-top:1px solid #e3e3e3;padding-top:1rem;',
  'color:#5a5a5a;font-size:.9rem}',
].join('');

const imageCaption = (img: PageImage): string =>
  [
    `${img.index}. ${captionOf(img.rec)}`,
    t(`localities.bilder.kind.${img.rec.kind}`),
    img.funn ? `${t('localities.funn.belongsTo')}: ${img.funn}` : null,
    isBboxAssumed(img.rec) ? t('localities.bilder.assumed') : null,
  ]
    .filter(Boolean)
    .join(' · ');

const indexHtml = (page: Page): string => {
  const { locality } = page;
  const title = `${locality.name || locality.code} — ${t(
    'localities.takeout.subtitle',
  )}`;
  const out: string[] = [
    '<!doctype html>',
    `<html lang="${esc(page.locale)}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(title)}</title>`,
    `<style>${STYLE}</style>`,
    '</head>',
    '<body>',
    `<h1>${esc(locality.name || locality.code)}</h1>`,
    `<p class="sub">${esc(t('localities.takeout.subtitle'))}</p>`,
  ];
  if (locality.description.trim()) {
    out.push(`<p class="desc">${esc(locality.description.trim())}</p>`);
  }
  out.push('<dl>');
  for (const fact of page.facts) {
    out.push(`<dt>${esc(fact.label)}</dt><dd>${esc(fact.value)}</dd>`);
  }
  out.push('</dl>');

  out.push(`<h2>${esc(t('localities.takeout.bilderHeading'))}</h2>`);
  if (page.images.length === 0) {
    out.push(`<p>${esc(t('localities.takeout.bilderEmpty'))}</p>`);
  }
  for (const img of page.images) {
    const caption = imageCaption(img);
    out.push(
      '<figure>',
      `<img src="${esc(img.path)}" alt="${esc(captionOf(img.rec))}">`,
      `<figcaption>${esc(caption)}</figcaption>`,
      '</figure>',
    );
  }

  if (page.missing.length > 0) {
    out.push(`<h2>${esc(t('localities.takeout.missingHeading'))}</h2>`, '<ul>');
    for (const m of page.missing) {
      out.push(`<li>${esc(m.label)} — ${esc(m.reason)}</li>`);
    }
    out.push('</ul>');
  }

  out.push(`<h2>${esc(t('localities.takeout.funnHeading'))}</h2>`);
  if (page.finds.length === 0) {
    out.push(`<p>${esc(t('localities.takeout.funnEmpty'))}</p>`);
  } else {
    out.push(
      '<table><thead><tr>',
      `<th>${esc(t('localities.takeout.colTitle'))}</th>`,
      `<th>${esc(t('localities.funn.status.heading'))}</th>`,
      `<th>${esc(t('localities.takeout.colNote'))}</th>`,
      `<th>${esc(t('localities.workspace.coordinates'))}</th>`,
      '</tr></thead><tbody>',
    );
    for (const { find, centre } of page.finds) {
      out.push(
        '<tr>',
        `<td>${esc(titleOf(find))}</td>`,
        `<td>${esc(t(`localities.funn.status.${find.status}`))}</td>`,
        `<td class="desc">${esc(find.note)}</td>`,
        `<td>${centre ? esc(`${deg(centre[1])}, ${deg(centre[0])}`) : ''}</td>`,
        '</tr>',
      );
    }
    out.push('</tbody></table>');
    out.push(`<p>${esc(t('localities.takeout.funnFiles'))}</p>`);
  }

  out.push(`<h2>${esc(t('localities.takeout.sourcesHeading'))}</h2>`, '<ul>');
  for (const credit of page.credits) {
    out.push(`<li>${esc(`${credit.holder} — ${t(credit.termsKey)}`)}</li>`);
  }
  out.push(
    `<li>${esc(
      t('localities.takeout.sourcesSelf', {
        author: authorOf(page.locality),
        app: t('figure.app'),
      }),
    )}</li>`,
    '</ul>',
  );
  out.push(`<p>${esc(t('localities.takeout.sourcesNote'))}</p>`);

  out.push(
    '<footer>',
    esc(
      t('localities.takeout.generated', {
        app: t('figure.app'),
        date: formatDate(page.packedAt.toISOString(), page.locale),
      }),
    ),
    '</footer>',
    '</body>',
    '</html>',
    '',
  );
  return out.join('\n');
};

const readmeText = (page: Page): string => {
  const { locality } = page;
  const heading = `${locality.name || locality.code} — ${t(
    'localities.takeout.subtitle',
  )}`;
  const out: string[] = [heading, '='.repeat(heading.length), ''];
  if (locality.description.trim()) {
    out.push(locality.description.trim(), '');
  }
  for (const fact of page.facts) out.push(`${fact.label}: ${fact.value}`);
  out.push('', t('localities.takeout.filesHeading'), '');
  out.push('  index.html');
  out.push('  README.txt');
  for (const img of page.images) {
    out.push(`  ${img.path} — ${imageCaption(img)}`);
  }
  out.push('  funn/funn.geojson');
  out.push('  funn/funn.csv');
  if (page.missing.length > 0) {
    out.push('', t('localities.takeout.missingHeading'), '');
    for (const m of page.missing) out.push(`  ${m.label} — ${m.reason}`);
  }
  out.push('', t('localities.takeout.funnHeading'), '');
  if (page.finds.length === 0) {
    out.push(`  ${t('localities.takeout.funnEmpty')}`);
  }
  for (const { find, centre } of page.finds) {
    const where = centre ? ` (${deg(centre[1])}, ${deg(centre[0])})` : '';
    const status = t(`localities.funn.status.${find.status}`);
    out.push(`  ${titleOf(find)} — ${status}${where}`);
    if (find.note.trim()) out.push(`    ${find.note.trim()}`);
  }
  out.push('', t('localities.takeout.sourcesHeading'), '');
  for (const credit of page.credits) {
    out.push(`  ${credit.holder} — ${t(credit.termsKey)}`);
  }
  out.push(
    `  ${t('localities.takeout.sourcesSelf', {
      author: authorOf(page.locality),
      app: t('figure.app'),
    })}`,
  );
  out.push('', t('localities.takeout.sourcesNote'));
  out.push(
    '',
    t('localities.takeout.generated', {
      app: t('figure.app'),
      date: formatDate(page.packedAt.toISOString(), page.locale),
    }),
    '',
  );
  return out.join('\r\n');
};

// ---- The build ----

export const buildTakeout = async ({
  locality,
  finds,
  bilder,
  forcePin,
  pinnableInEdit = false,
  onProgress,
}: {
  locality: LocalityRecord;
  finds: readonly LocalityFindRecord[];
  /** The exhibit: the lokalitet's own, non-hidden, in curated order. */
  bilder: readonly AttachmentRecord[];
  /**
   * Render an unpinned View, now and awaited. Null where the caller may not
   * write; the bundle then carries what is pinned and names the rest missing.
   */
  forcePin: ForcePin | null;
  /**
   * `forcePin` is null only because the stance is `show`, not because the
   * caller lacks the right. Changes what the missing list advises.
   */
  pinnableInEdit?: boolean;
  onProgress: (progress: TakeoutProgress) => void;
}): Promise<TakeoutResult> => {
  const packedAt = new Date();
  const locale = i18n.language;
  // One context for the whole bundle: every figure in it is credited to the
  // lokalitet's owner, whoever pressed the button.
  const stampCtx = stampContextOf(locality, locale);
  const knownFunn = new Set(finds.map((f) => f.id));
  const titleOfFunn = new Map(finds.map((f) => [f.id, titleOf(f)] as const));
  const findRows = findRowsOf(finds);

  // Pass one: the pixels that do not exist yet. Sequential, because `forcePin`
  // is the queue's own producer path and two tile bursts at once against
  // Kartverket's edge finish no sooner. A failed pin falls through to the
  // missing list below.
  const unpinned = bilder.filter((rec) => !isPinned(rec));
  const repinned = new Map<string, AttachmentRecord>();
  onProgress({ stage: 'pinning', done: 0, total: unpinned.length });
  let pinDone = 0;
  for (const rec of unpinned) {
    if (forcePin && viewSpecOf(rec)) {
      try {
        const pinned = await forcePin(rec);
        if (pinned && isPinned(pinned)) repinned.set(rec.id, pinned);
      } catch (e) {
        console.warn('[takeout] pin failed', rec.id, e);
      }
    }
    pinDone += 1;
    onProgress({ stage: 'pinning', done: pinDone, total: unpinned.length });
  }

  // Pass two: the bytes.
  const images: PageImage[] = [];
  const missing: PageMissing[] = [];
  const files: ZipEntry[] = [];
  // Wide enough for the whole exhibit, so `bilder/` sorts in curated order in
  // a file manager.
  const pad = Math.max(2, String(bilder.length).length);
  let index = 0;
  let fileDone = 0;
  onProgress({ stage: 'files', done: 0, total: bilder.length });
  for (const original of bilder) {
    const rec = repinned.get(original.id) ?? original;
    const label = captionOf(rec);
    if (!isPinned(rec)) {
      missing.push({
        label,
        reason: forcePin
          ? t('localities.takeout.missingRender')
          : pinnableInEdit
            ? t('localities.takeout.missingOwner')
            : t('localities.takeout.missingReader'),
      });
    } else {
      index += 1;
      const name = `${String(index).padStart(pad, '0')}-${slug(
        label,
        rec.kind,
      )}.${extensionOf(rec)}`;
      const path = `bilder/${name}`;
      try {
        const url = getAttachmentUrl(rec);
        const blob = await fetchWithin(
          url,
          { ms: FILE_DEADLINE_MS, what: 'takeout file' },
          (res) => res.blob(),
        );
        // The stored file is bare pixels; the legend goes on here, so a figure
        // that leaves the app carries its own provenance and the copy on the
        // map does not. Decode-draw-encode per image, which is the cost of a
        // bundle whose pictures can still be read a decade from now.
        files.push({
          path,
          body: await stampBlob(blob, figureSpecOf(rec, stampCtx)),
        });
        images.push({
          rec,
          path,
          index,
          funn: titleOfFunn.get(funnIdOf(rec, knownFunn) ?? '') ?? null,
        });
      } catch (e) {
        console.warn('[takeout] file unavailable', rec.id, e);
        // Give the number back, so the figures that landed are 1..n with no
        // holes.
        index -= 1;
        missing.push({
          label,
          reason: t('localities.takeout.missingFile'),
        });
      }
    }
    fileDone += 1;
    onProgress({ stage: 'files', done: fileDone, total: bilder.length });
  }

  onProgress({ stage: 'writing', done: 0, total: 0 });
  const page: Page = {
    locality,
    facts: factsOf(locality, locale, packedAt),
    images,
    missing,
    finds: findRows,
    credits: creditsOf(bilder),
    packedAt,
    locale,
  };

  // The two funn files are written even when there are no funn: a header-only
  // CSV and an empty FeatureCollection are answers; a missing path is not.
  const blob = await zipStore(
    [
      { path: 'index.html', body: indexHtml(page) },
      { path: 'README.txt', body: readmeText(page) },
      ...files,
      { path: 'funn/funn.geojson', body: geojsonOf(finds) },
      { path: 'funn/funn.csv', body: csvOf(findRows) },
    ],
    packedAt,
  );

  return {
    blob,
    filename: `${slug(
      locality.name || locality.code,
      locality.code.toLowerCase(),
    )}-${dateStamp(packedAt)}.zip`,
    missing: missing.length,
  };
};
