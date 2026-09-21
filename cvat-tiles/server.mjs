// Tile server for the cached combined-VAT ground.
//
// The store is one MBTiles database per LiDAR acquisition, written out of band
// by vat-cache/vatcache.py and bind-mounted here read-only. This turns
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
// The 404 is load-bearing. A tile nobody wrote is a tile outside the flight's
// footprint: OpenLayers marks it errored and leaves it transparent, and that
// transparency is how the acquisition's own outline appears on the map. So a
// miss must stay a miss, not become a blank tile.
//
// Zero dependencies: node:sqlite is compiled into Node 24. It is a release
// candidate, and the surface used here is DatabaseSync + prepare + get.

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

// Open databases, by slug. Each is a file handle and one prepared statement;
// the store is a handful of acquisitions, so there is nothing to evict.
// Populated lazily so an acquisition that lands between two page loads is
// served without a restart.
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

async function manifest(res) {
  try {
    const body = await fs.readFile(path.join(STORE, 'manifest.json'));
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': String(body.length),
    });
    res.end(body);
  } catch {
    // An install with no store of its own. The app reads an absent manifest as
    // an empty one and offers no cached ground, which is the honest answer.
    miss(res);
  }
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
});
