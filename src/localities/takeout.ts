/*
 * The Rapportpakke — everything a lokalitet knows, in one zip
 * (docs/lokalitet-view.md §9).
 *
 * The bundle is nearly free, and that is the whole argument for it: every
 * image is already a figure with its provenance baked into the pixels, every
 * funn is already a GeoJSON FeatureCollection in EPSG:4326, and every register
 * fact is already a field. So this module is mostly a manifest and a zip.
 *
 * ## `index.html` is the point, not the PNGs
 *
 * A folder of images is not a report. A front page with the register facts,
 * the images inline in the order the author arranged them, the funn as a
 * table, and the rights holder for every source is a thing a
 * kulturminneforvaltning can open and read without installing anything —
 * which is the only form in which an amateur's reading of the ground has a
 * chance of being looked at. `README.txt` says the same in plain text, for
 * the archive that does not keep HTML.
 *
 * ## It pins what is missing, and it never lies about what is in it
 *
 * A View is a row of parameters until the queue renders it (§4.1.2), and a
 * Rapportpakke of parameter rows is not a report. This is the last honest
 * moment, so it forces a pin on every unpinned View first, with the count on
 * the row's banner while it runs.
 *
 * What it will not do is hand over a bundle that quietly has fewer images
 * than the lokalitet does. Anything that could not be rendered — a reader has
 * no right to pin, a source has retired the acquisition, the file would not
 * come down — is listed by name on the front page under its own heading, and
 * the caller is told the count. The failure this prevents is somebody
 * forwarding the zip believing it is the site.
 *
 * ## Two audiences, two spellings
 *
 * The page and the README are in the UI language, like every other string in
 * the app. The *data* files are not: `funn.geojson`'s property names and
 * `funn.csv`'s column heads are fixed Norwegian, because a column name that
 * changes with the reader's language is not a schema — the same export opened
 * by two people should be the same table.
 */

import i18n, { t } from 'i18next';
import {
  type AttachmentKind,
  type AttachmentRecord,
  getAttachmentUrl,
} from '../api/attachments';
import type { LocalityRecord } from '../api/localities';
import type { LocalityFindRecord } from '../api/localityFinds';
import { type Credit, CREDITS } from '../figure/figure';
import { fetchWithin } from '../shared/utils/deadline';
import { type ZipEntry, zipStore } from '../shared/utils/zip';
import {
  formatBboxArea,
  formatBboxCentre,
  formatBboxSpan,
  formatDate,
} from './format';
import { funnIdOf } from './funnGroups';
import { isBboxAssumed } from './uploadPlacement';
import { isPinned, viewSpecOf } from './viewSpec';

/*
 * One file, not the whole bundle: forty figures over a slow link is a long
 * time and legitimately so, but a single PB file that has gone quiet for two
 * minutes is not coming, and the bundle should say so rather than park.
 */
const FILE_DEADLINE_MS = 120_000;

/** Rank 3 of the banner slot (§5.7) while the bundle is being built. */
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

// ---------------------------------------------------------------------------
// Small formatters
// ---------------------------------------------------------------------------

const slug = (s: string, fallback: string): string => {
  const out = s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .slice(0, 60)
    .replace(/^-+|-+$/g, '');
  return out || fallback;
};

// The server filename's own extension, so a JPEG flyfoto does not leave here
// called `.png`. Defaults rather than throws: every producer writes one.
const extensionOf = (rec: AttachmentRecord): string => {
  const m = /\.([a-z0-9]+)$/i.exec(rec.file);
  return m ? m[1].toLowerCase() : 'png';
};

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

const captionOf = (rec: AttachmentRecord): string =>
  rec.caption.trim() || t(`localities.bilder.kind.${rec.kind}`);

const deg = (v: number) => v.toFixed(5);

const dateStamp = (d: Date): string =>
  [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');

// ---------------------------------------------------------------------------
// What the bundle says about itself
// ---------------------------------------------------------------------------

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

/*
 * Who to credit, by the kind of record — the same coarse map the pin queue
 * uses for a scene's layers (`SCENE_CREDIT_BY_KIND`), and coarse for the same
 * reason: a terrain render and a LiDAR extract both come from hoydedata.no,
 * and the exact acquisition is already printed on each figure's own caption.
 * This list is the summary, and the page says so.
 *
 * Exhaustive over `AttachmentKind` on purpose, so a kind added later is a
 * build error here rather than an image nobody is credited for.
 */
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
    // A scene owes what its members owe. Resolved against the exhibit rather
    // than the server: a member kept out of the bundle is a member whose
    // pixels are not in the bundle either.
    if (rec.kind === 'scene') {
      for (const id of rec.over ?? []) {
        const member = byId.get(id);
        if (member) add(CREDIT_BY_KIND[member.kind]);
      }
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// The funn, as data
// ---------------------------------------------------------------------------

/*
 * A funn's centre, for the CSV's two columns.
 *
 * Walked rather than taken from a library: the geometry is a
 * FeatureCollection of whatever the drawing tools made, and the only thing
 * needed is the midpoint of everything in it. A GeometryCollection has no
 * `coordinates` and simply contributes nothing — nothing in `src/funn/` has
 * ever written one.
 */
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

/*
 * Every funn's features in one FeatureCollection, each carrying the record's
 * own fields.
 *
 * Flattened rather than nested because a FeatureCollection of
 * FeatureCollections is not GeoJSON: a funn that is an outline plus a text
 * label is two features that both say which funn they belong to.
 */
const geojsonOf = (finds: readonly LocalityFindRecord[]): string => {
  const features = finds.flatMap((find) =>
    (find.geometry?.features ?? []).map((feature) => ({
      ...feature,
      properties: {
        ...(feature.properties ?? {}),
        funn: find.id,
        tittel: find.title,
        notat: find.note,
        status: find.status,
      },
    })),
  );
  const collection = { type: 'FeatureCollection', features };
  return `${JSON.stringify(collection, null, 2)}\n`;
};

/*
 * The same table for people who do not do GIS.
 *
 * A BOM and CRLF, which is what makes a UTF-8 CSV with æøå in it open
 * correctly in Excel by double-click rather than through the import wizard.
 * Comma-separated with a dot decimal, i.e. RFC 4180 rather than the Norwegian
 * list separator: a locale-dependent separator is a guess about which
 * spreadsheet the recipient uses, and the wrong guess is unreadable where
 * this one is merely a dialog box.
 */
const csvOf = (finds: readonly LocalityFindRecord[]): string => {
  const rows = [['tittel', 'status', 'notat', 'lat', 'lon']];
  for (const find of finds) {
    const centre = centreOf(find);
    rows.push([
      find.title,
      find.status,
      find.note,
      centre ? centre[1].toFixed(6) : '',
      centre ? centre[0].toFixed(6) : '',
    ]);
  }
  const body = rows.map((r) => r.map(csvField).join(',')).join('\r\n');
  return `\ufeff${body}\r\n`;
};

// ---------------------------------------------------------------------------
// The front page
// ---------------------------------------------------------------------------

type PageImage = {
  rec: AttachmentRecord;
  path: string;
  index: number;
  /** The funn it belongs to, where it belongs to one (§13.6). */
  funn: string | null;
};

type PageMissing = { label: string; reason: string };

type Page = {
  locality: LocalityRecord;
  facts: Fact[];
  images: PageImage[];
  missing: PageMissing[];
  finds: readonly LocalityFindRecord[];
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
    out.push(`<p>${esc(locality.description.trim())}</p>`);
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
    for (const find of page.finds) {
      const centre = centreOf(find);
      out.push(
        '<tr>',
        `<td>${esc(find.title || t('localities.funn.untitled'))}</td>`,
        `<td>${esc(t(`localities.funn.status.${find.status}`))}</td>`,
        `<td>${esc(find.note)}</td>`,
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
  out.push(`<li>${esc(t('localities.takeout.sourcesSelf'))}</li>`, '</ul>');
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
  for (const find of page.finds) {
    const centre = centreOf(find);
    const where = centre ? ` (${deg(centre[1])}, ${deg(centre[0])})` : '';
    const status = t(`localities.funn.status.${find.status}`);
    out.push(
      `  ${find.title || t('localities.funn.untitled')} — ${status}${where}`,
    );
    if (find.note.trim()) out.push(`    ${find.note.trim()}`);
  }
  out.push('', t('localities.takeout.sourcesHeading'), '');
  for (const credit of page.credits) {
    out.push(`  ${credit.holder} — ${t(credit.termsKey)}`);
  }
  out.push(`  ${t('localities.takeout.sourcesSelf')}`);
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

// ---------------------------------------------------------------------------
// The build
// ---------------------------------------------------------------------------

export const buildTakeout = async ({
  locality,
  finds,
  bilder,
  forcePin,
  onProgress,
}: {
  locality: LocalityRecord;
  finds: readonly LocalityFindRecord[];
  /** The exhibit: the lokalitet's own, non-hidden, in curated order. */
  bilder: readonly AttachmentRecord[];
  /**
   * Render an unpinned View, now and awaited — `useLocalityWorkspace`'s
   * `forcePin`. Null where the caller has no right to write, which is a
   * reader over somebody else's lokalitet: the bundle then carries what is
   * already pinned and names the rest as missing.
   */
  forcePin: ForcePin | null;
  onProgress: (progress: TakeoutProgress) => void;
}): Promise<TakeoutResult> => {
  const packedAt = new Date();
  const locale = i18n.language;
  const knownFunn = new Set(finds.map((f) => f.id));
  const titleOfFunn = new Map(
    finds.map(
      (f) => [f.id, f.title || t('localities.funn.untitled')] as const,
    ),
  );

  /*
   * Pass one: the pixels that do not exist yet.
   *
   * Sequential because `forcePin` is the queue's own producer path and two
   * tile bursts at once against Kartverket's edge finish no sooner (§4.1.2).
   * A pin that fails is not fatal here — the record simply has no file and
   * falls through to the missing list below.
   */
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
          : t('localities.takeout.missingReader'),
      });
    } else {
      index += 1;
      const name = `${String(index).padStart(2, '0')}-${slug(
        label,
        rec.kind,
      )}.${extensionOf(rec)}`;
      const path = `bilder/${name}`;
      try {
        const url = await getAttachmentUrl(rec);
        const blob = await fetchWithin(
          url,
          { ms: FILE_DEADLINE_MS, what: 'takeout file' },
          (res) => res.blob(),
        );
        files.push({ path, body: blob });
        images.push({
          rec,
          path,
          index,
          funn: titleOfFunn.get(funnIdOf(rec, knownFunn) ?? '') ?? null,
        });
      } catch (e) {
        console.warn('[takeout] file unavailable', rec.id, e);
        // Give the number back, so the ones that did land are 1..n with no
        // holes — a gap in a figure list reads as a page that lost something.
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
    finds,
    credits: creditsOf(bilder),
    packedAt,
    locale,
  };

  // The two funn files are written even when there are no funn: a header-only
  // CSV and an empty FeatureCollection are answers, where a missing path is a
  // broken script at the other end.
  const blob = await zipStore(
    [
      { path: 'index.html', body: indexHtml(page) },
      { path: 'README.txt', body: readmeText(page) },
      ...files,
      { path: 'funn/funn.geojson', body: geojsonOf(finds) },
      { path: 'funn/funn.csv', body: csvOf(finds) },
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
