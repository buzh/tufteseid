// Tile server for the cached combined-VAT ground.
//
// The store is one MBTiles database per LiDAR acquisition, written out of band
// by vat-cache/makevat.py and bind-mounted here read-only. This turns
//
//   GET /<slug>/<z>/<x>/<y>.webp
//
// into one indexed SELECT against <slug>.mbtiles — the same URL the store
// answered as loose files, so nothing in the app changed when it stopped being
// a directory tree. Caddy proxies /cvat/* here; see the Caddyfile.
//
// Why a service at all, when Caddy served the files itself: an acquisition is
// ~83 000 WebP tiles and the store holds nine of them, which is a backup that
// spends its night on stat() and an inode table that dwarfs the bytes. One file
// per acquisition costs a SELECT per tile — microseconds against the 3–12 s the
// pixels took to compute — and gives the operator something they can copy.
//
// Copying one in is the whole deploy. /cvat/manifest.json is not a file: it is
// built here out of the databases present, each of which carries its own
// acquisition name and levels in its `metadata` table. So a `scp` into the
// store directory adds ground to the app — no manifest to edit, no import step,
// nothing to restart — and that is what lets the tiles be computed on a machine
// that knows nothing about this one.
//
// The 404 is load-bearing. A tile nobody wrote is a tile outside the flight's
// footprint: OpenLayers marks it errored and leaves it transparent, and that
// transparency is how the acquisition's own outline appears on the map. So a
// miss must stay a miss, not become a blank tile.
//
// Zero dependencies: node:sqlite is compiled into Node 24. It is a release
// candidate, and the surface used here is DatabaseSync + prepare + get/all.

import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const PORT = Number(process.env.PORT || 8080);
const STORE = process.env.CVAT_STORE || '/store';

// A week. The store changes only when a batch run lands, and an acquisition
// that has just been built is one nobody has looked at yet.
const MAX_AGE = 7 * 24 * 3600;

// The slug rule from vat-cache/acquisitions.py, which is also the whole of the
// path validation: a name outside this alphabet cannot be one of ours, and
// cannot reach out of the store either.
const SLUG = /^[0-9a-zæøå-]+$/;

const TILE = /^\/([^/]+)\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.webp$/;

const SUFFIX = '.mbtiles';

// How long the synthesized manifest may go without the store being looked at
// again. The app fetches it once per page load, so this bounds how often a
// burst of loads pays for a readdir and a stat per file — and, since the scan
// is also what notices a replaced database, how long a stale handle can live.
const SCAN_MS = 10_000;

// Open databases, by slug. Each is a file handle and one prepared statement;
// the store is a handful of acquisitions, so there is nothing to evict on size.
// Populated lazily, so an acquisition that lands between two page loads is
// served without a restart, and dropped by the store survey below when its file
// changes underneath — a handle outlives the inode it was opened on, so being
// cached by slug is only safe while something is watching the slug.
const open = new Map();

function acquire(slug) {
  const held = open.get(slug);
  if (held) return held;
  let db;
  try {
    db = new DatabaseSync(path.join(STORE, `${slug}.mbtiles`), {
      readOnly: true,
    });
    // A batch run may be appending to this file while we read it. The writer
    // holds its lock for one work unit's insert, so waiting is always better
    // than answering a busy database as if the tile were missing.
    db.exec('PRAGMA busy_timeout = 5000');
  } catch {
    return null; // no such acquisition in this store
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
    // Already gone, which is the case this exists for.
  }
}

/**
 * The store's row for the app's y. MBTiles counts rows from the south and the
 * app's grid from the north, and the grid is square: 2**(z-1) tiles a side at
 * level z. Its own inverse, and the same line as `tms_row` in build_tiles.py.
 */
const tmsRow = (z, y) => 2 ** (z - 1) - 1 - y;

function tile(res, slug, z, x, y) {
  const entry = acquire(slug);
  if (!entry) return miss(res);
  let row;
  try {
    row = entry.select.get(z, x, tmsRow(z, y));
  } catch (err) {
    // A database that has been replaced under an open handle, or one that is
    // corrupt. Drop it and let the next request open it again.
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

// No Cache-Control: a hole in the store is either coverage, which the browser
// need not remember, or a level still being built, which it must not.
function miss(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('no tile');
}

// ---------------------------------------------------------------------------
// The manifest, built out of the store rather than read from it
// ---------------------------------------------------------------------------

/**
 * What one database says it is: the acquisition name the app joins the LiDAR
 * catalogue on, and the levels it holds.
 *
 * Opened and closed for the question rather than through `acquire`, because
 * this runs over every file in the store including ones nobody will ask a tile
 * of, and a handle per acquisition is only worth holding for the ones in use.
 */
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
      // Nothing to join on, so the app could not place it even if it were
      // offered. A database from before the stamp existed, or not one of ours.
      console.warn(`[cvat] ${slug}${SUFFIX} names no acquisition; skipping`);
      return null;
    }
    return { name, levels: levelsOf(db, rows) };
  } catch (err) {
    console.warn(`[cvat] ${slug}${SUFFIX} does not read: ${err?.message ?? err}`);
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // Never opened, which is the case this exists for.
    }
  }
}

/**
 * Which levels the file holds, by the three things that can tell us, cheapest
 * first. `levels` is what build_tiles.py stamps. minzoom/maxzoom are the
 * MBTiles spec's own and cover a database written before that stamp existed —
 * they flatten a gap in the middle of a ladder, which the app does not read
 * anyway since it takes only the span. The scan of the tiles table is for a
 * database carrying neither, and walks the index.
 */
function levelsOf(db, rows) {
  const stamped = rows.get('levels');
  if (stamped) {
    try {
      const zs = JSON.parse(stamped).filter(Number.isInteger);
      if (zs.length > 0) return zs;
    } catch {
      // Not JSON. Fall through to the spec's rows.
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

/** Every database in the store, with a mark that moves when the file does. */
async function survey() {
  let entries;
  try {
    entries = await fs.readdir(STORE);
  } catch {
    return []; // an install with no store of its own
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
      // Went away between the readdir and the stat.
    }
  }
  return found;
}

// What the last survey saw, slug to mark, and the manifest built from it.
let seen = new Map();
let body = null;
let scanned = 0;
let scanning = null;

async function rebuild() {
  const found = await survey();
  const marks = new Map(found.map((f) => [f.slug, f.mark]));
  let moved = body === null;

  // A file whose size or mtime has changed has been appended to or replaced,
  // and the handle `acquire` cached for it may be of an inode that is no longer
  // the file. Dropping it here is why the store is surveyed at all rather than
  // read once at startup: without it, an operator who copies a fuller
  // acquisition over an older one goes on being served the older one until the
  // container restarts.
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
    if (said) acquisitions[said.name] = { levels: said.levels, path: slug };
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
    // The store grows by a file landing in a directory, which no cache between
    // here and the tab can see. The document is a few hundred bytes.
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  // Path only. Nothing here reads a parameter, and a cache-buster on the end
  // of a tile URL should not read as a different tile.
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
  // Percent-decoded, because the slugs carry æøå and a browser sends those
  // encoded.
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
  // Once at startup, so the log says what this install is serving rather than
  // waiting for somebody to load the app to find out.
  void refresh();
});
