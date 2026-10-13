import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const PORT = Number(process.env.PORT || 8080);
const STORE = process.env.CVAT_STORE || '/store';

const MAX_AGE = 7 * 24 * 3600;

const SLUG = /^[0-9a-zæøå-]+$/;

const TILE = /^\/([^/]+)\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.webp$/;

const SUFFIX = '.mbtiles';

const SCAN_MS = 10_000;

const open = new Map();

function acquire(slug) {
  const held = open.get(slug);
  if (held) return held;
  let db;
  try {
    db = new DatabaseSync(path.join(STORE, `${slug}${SUFFIX}`), {
      readOnly: true,
    });
    db.exec('PRAGMA busy_timeout = 5000');
  } catch {
    return null;
  }
  const entry = {
    db,
    select: db.prepare(
      'SELECT tile_data FROM tiles ' +
        'WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?',
    ),
  };
  open.set(slug, entry);
  return entry;
}

function release(slug, entry) {
  open.delete(slug);
  try {
    entry.db.close();
  } catch {
  }
}

const tmsRow = (z, y) => 2 ** (z - 1) - 1 - y;

function tile(res, slug, z, x, y) {
  const entry = acquire(slug);
  if (!entry) return miss(res);
  let row;
  try {
    row = entry.select.get(z, x, tmsRow(z, y));
  } catch (err) {
    release(slug, entry);
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end(`cvat store error: ${err?.message ?? err}`);
    return;
  }
  if (!row?.tile_data) return miss(res);
  res.writeHead(200, {
    'Content-Type': 'image/webp',
    'Content-Length': String(row.tile_data.length),
    'Cache-Control': `public, max-age=${MAX_AGE}`,
  });
  res.end(row.tile_data);
}

function miss(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('no tile');
}

function inspect(slug) {
  let db;
  try {
    db = new DatabaseSync(path.join(STORE, `${slug}${SUFFIX}`), {
      readOnly: true,
    });
    db.exec('PRAGMA busy_timeout = 5000');
    const rows = new Map(
      db.prepare('SELECT name, value FROM metadata').all().map((r) => [r.name, r.value]),
    );
    const name = rows.get('name');
    if (!name) {
      console.warn(`[cvat] ${slug}${SUFFIX} names no acquisition; skipping`);
      return null;
    }
    const levels = levelsOf(db, rows);
    return { name, levels, bounds: boundsOf(db, levels) };
  } catch (err) {
    console.warn(`[cvat] ${slug}${SUFFIX} does not read: ${err?.message ?? err}`);
    return null;
  } finally {
    try {
      db?.close();
    } catch {
    }
  }
}

function levelsOf(db, rows) {
  const stamped = rows.get('levels');
  if (stamped) {
    try {
      const zs = JSON.parse(stamped).filter(Number.isInteger);
      if (zs.length > 0) return zs;
    } catch {
    }
  }
  const lo = Number(rows.get('minzoom'));
  const hi = Number(rows.get('maxzoom'));
  if (Number.isInteger(lo) && Number.isInteger(hi) && lo <= hi) {
    return Array.from({ length: hi - lo + 1 }, (_, i) => hi - i);
  }
  return db
    .prepare('SELECT DISTINCT zoom_level AS z FROM tiles ORDER BY z DESC')
    .all()
    .map((r) => r.z);
}

const ENVELOPE_FLOOR_Z = 12;

function boundsOf(db, levels) {
  const measurable = levels.filter((z) => z >= ENVELOPE_FLOOR_Z);
  const z =
    measurable.length > 0 ? Math.min(...measurable) : Math.max(...levels);
  if (!Number.isInteger(z)) return null;
  const at = db
    .prepare(
      'SELECT min(tile_column) AS x0, max(tile_column) AS x1, ' +
        'min(tile_row) AS r0, max(tile_row) AS r1 ' +
        'FROM tiles WHERE zoom_level = ?',
    )
    .get(z);
  if (at?.x0 == null) return null;
  return { z, x0: at.x0, y0: tmsRow(z, at.r1), x1: at.x1, y1: tmsRow(z, at.r0) };
}

async function survey() {
  let entries;
  try {
    entries = await fs.readdir(STORE);
  } catch {
    return [];
  }
  const found = [];
  for (const file of entries.sort()) {
    if (!file.endsWith(SUFFIX)) continue;
    const slug = file.slice(0, -SUFFIX.length);
    if (!SLUG.test(slug)) {
      console.warn(`[cvat] ${file} is outside the slug alphabet; skipping`);
      continue;
    }
    try {
      const { size, mtimeMs } = await fs.stat(path.join(STORE, file));
      found.push({ slug, mark: `${size}:${mtimeMs}` });
    } catch {
    }
  }
  return found;
}

let seen = new Map();
let body = null;
let scanned = 0;
let scanning = null;

async function rebuild() {
  const found = await survey();
  const marks = new Map(found.map((f) => [f.slug, f.mark]));
  let moved = body === null;

  for (const [slug, mark] of marks) {
    if (seen.get(slug) === mark) continue;
    moved = true;
    const held = open.get(slug);
    if (held) release(slug, held);
  }
  for (const slug of seen.keys()) {
    if (marks.has(slug)) continue;
    moved = true;
    const held = open.get(slug);
    if (held) release(slug, held);
  }
  seen = marks;
  if (!moved) return;

  const acquisitions = {};
  for (const { slug } of found) {
    const said = inspect(slug);
    if (said) {
      acquisitions[said.name] = {
        levels: said.levels,
        path: slug,
        bounds: said.bounds,
      };
    }
  }
  body = Buffer.from(JSON.stringify({ acquisitions }));
  console.log(
    `[cvat] ${Object.keys(acquisitions).length} acquisitions in ${STORE}: ` +
      (Object.keys(acquisitions).join(', ') || '(none)'),
  );
}

function refresh() {
  if (scanning) return scanning;
  if (body !== null && Date.now() - scanned < SCAN_MS) return Promise.resolve();
  scanning = rebuild().finally(() => {
    scanned = Date.now();
    scanning = null;
  });
  return scanning;
}

async function manifest(res) {
  await refresh();
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': String(body.length),
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  if (url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (url === '/manifest.json') {
    await manifest(res);
    return;
  }
  const match = TILE.exec(url);
  if (!match) return miss(res);
  let slug;
  try {
    slug = decodeURIComponent(match[1]);
  } catch {
    return miss(res);
  }
  if (!SLUG.test(slug)) return miss(res);
  tile(res, slug, Number(match[2]), Number(match[3]), Number(match[4]));
});

server.listen(PORT, () => {
  console.log(`cvat-tiles listening on :${PORT} → ${STORE}`);
  void refresh();
});
