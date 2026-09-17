// Stored, not deflated: nearly every byte in the bundle is already-compressed
// PNG or JPEG. Hand-rolled because a dependency would mean regenerating
// `package-lock.json`, which the workstation cannot do.
// Not Zip64, so 4 GB and 65535 entries are hard caps and `zipStore` throws at
// either rather than write a silently wrong file.

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

// MS-DOS packed date and time: local time, two-second resolution, per spec.
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
// Bit 11: the filename is UTF-8. Without it æøå is read as CP437.
const FLAG_UTF8 = 0x0800;
const MAX_32 = 0xffffffff;

// The Blob, not the ArrayBuffer, goes into the output, so a large bundle stays
// off the JS heap.
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
  // `BlobPart[]`: since TS 5.7 `Uint8Array[]` widens to `ArrayBufferLike`,
  // which is not one. Hence `centralSize` too — a `BlobPart` has no `.length`.
  const parts: BlobPart[] = [];
  const central: BlobPart[] = [];
  let centralSize = 0;
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
    centralSize += cd.length;
    offset += local.length + size;
    if (offset > MAX_32) {
      throw new Error('zip: archive exceeds 4 GB, which needs Zip64');
    }
  }

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
