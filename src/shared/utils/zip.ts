/*
 * A zip file, written by hand, with nothing compressed.
 *
 * Hand-rolled for the same reason `src/terrain/dem.ts` reads float TIFFs
 * itself rather than pulling in geotiff.js: adding a dependency means
 * regenerating `package-lock.json`, which the workstation cannot do. The
 * format's stored-entry path is about eighty lines, and one caller — the
 * Rapportpakke (docs/lokalitet-view.md §9) — needs exactly that path.
 *
 * **Stored, not deflated, and that is not a shortcut.** Nearly every byte in
 * the bundle is a PNG or a JPEG, i.e. already compressed; deflating those
 * again costs seconds of main thread to save nothing. What would compress is
 * the two text files, and those are kilobytes. If that ever changes,
 * `CompressionStream('deflate-raw')` would make it possible without a
 * dependency — the entry would need method 8 and the deflated length in its
 * headers.
 *
 * Not Zip64: sizes and offsets are 32-bit, so an archive is capped at 4 GB and
 * 65535 entries. A lokalitet's exhibit is tens of figures of tens of megabytes,
 * so the ceiling is two orders of magnitude away, and `zipStore` throws rather
 * than writing a file that is silently wrong if it is ever reached.
 */

/** One file in the archive. Directories are implied by `/` in the path. */
export type ZipEntry = {
  path: string;
  body: Blob | string;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
};

// MS-DOS packed date and time, which is what the format stores. Local time
// and two-second resolution, both by the spec rather than by choice.
const dosTime = (d: Date) =>
  ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) &
  0xffff;

const dosDate = (d: Date) =>
  (((Math.max(1980, d.getFullYear()) - 1980) << 9) |
    ((d.getMonth() + 1) << 5) |
    d.getDate()) &
  0xffff;

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;
// Bit 11: the filename is UTF-8. Without it a name with æøå in it is read as
// CP437 by anything that still believes the 1989 default.
const FLAG_UTF8 = 0x0800;
const MAX_32 = 0xffffffff;

/**
 * The entries, in the order given, as one Blob.
 *
 * The bytes of each body are read once to checksum them and then dropped: the
 * *Blob* goes into the output, not the `ArrayBuffer`, so a bundle of forty
 * figures is held wherever the browser keeps blobs rather than on the JS heap.
 */
export const zipStore = async (
  entries: readonly ZipEntry[],
  modifiedAt: Date = new Date(),
): Promise<Blob> => {
  if (entries.length > 0xffff) {
    throw new Error(`zip: ${entries.length} entries exceeds the 65535 cap`);
  }
  const encoder = new TextEncoder();
  const time = dosTime(modifiedAt);
  const date = dosDate(modifiedAt);
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const body =
      typeof entry.body === 'string'
        ? new Blob([entry.body], { type: 'text/plain;charset=utf-8' })
        : entry.body;
    const bytes = new Uint8Array(await body.arrayBuffer());
    const crc = crc32(bytes);
    const size = bytes.length;

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL_HEADER, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, FLAG_UTF8, true);
    lv.setUint16(8, 0, true); // method: stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true); // compressed
    lv.setUint32(22, size, true); // uncompressed
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true); // no extra field
    local.set(name, 30);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, CENTRAL_HEADER, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, FLAG_UTF8, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true); // extra
    cv.setUint16(32, 0, true); // comment
    cv.setUint16(34, 0, true); // disk number
    cv.setUint16(36, 0, true); // internal attributes
    cv.setUint32(38, 0, true); // external attributes
    cv.setUint32(42, offset, true);
    cd.set(name, 46);

    parts.push(local, body);
    central.push(cd);
    offset += local.length + size;
    if (offset > MAX_32) {
      throw new Error('zip: archive exceeds 4 GB, which needs Zip64');
    }
  }

  const centralSize = central.reduce((sum, cd) => sum + cd.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, END_OF_CENTRAL, true);
  ev.setUint16(4, 0, true); // this disk
  ev.setUint16(6, 0, true); // disk with the central directory
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true); // no archive comment

  return new Blob([...parts, ...central, end], { type: 'application/zip' });
};
