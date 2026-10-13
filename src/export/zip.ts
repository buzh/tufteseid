

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

const STORED = 0;
const VERSION = 20;

const UTF8_FLAG = 0x0800;

const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const EOCD_BYTES = 22;

export type ZipEntry = {

  path: string;
  body: Blob;
};

let crcTable: Uint32Array | null = null;

const table = (): Uint32Array => {
  if (crcTable) return crcTable;
  const built = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let bit = 0; bit < 8; bit++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    built[n] = c >>> 0;
  }
  crcTable = built;
  return built;
};

export const crc32 = (bytes: Uint8Array): number => {
  const lookup = table();
  let c = 0xffffffff;
  for (const byte of bytes) c = lookup[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

type Stamp = { time: number; date: number };

const dosStamp = (d: Date): Stamp => ({
  time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  date:
    ((Math.max(d.getFullYear(), 1980) - 1980) << 9) |
    ((d.getMonth() + 1) << 5) |
    d.getDate(),
});

type Bytes = Uint8Array<ArrayBuffer>;

const encode = (s: string): Bytes => new TextEncoder().encode(s);

type Described = {
  name: Bytes;
  crc: number;
  size: number;
  stamp: Stamp;
};

const localHeader = (entry: Described): Bytes => {
  const bytes = new Uint8Array(LOCAL_HEADER_BYTES + entry.name.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, LOCAL_SIG, true);
  view.setUint16(4, VERSION, true);
  view.setUint16(6, UTF8_FLAG, true);
  view.setUint16(8, STORED, true);
  view.setUint16(10, entry.stamp.time, true);
  view.setUint16(12, entry.stamp.date, true);
  view.setUint32(14, entry.crc, true);
  view.setUint32(18, entry.size, true);
  view.setUint32(22, entry.size, true);
  view.setUint16(26, entry.name.length, true);
  view.setUint16(28, 0, true);
  bytes.set(entry.name, LOCAL_HEADER_BYTES);
  return bytes;
};

const centralHeader = (entry: Described, offset: number): Bytes => {
  const bytes = new Uint8Array(CENTRAL_HEADER_BYTES + entry.name.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, CENTRAL_SIG, true);
  view.setUint16(4, VERSION, true);
  view.setUint16(6, VERSION, true);
  view.setUint16(8, UTF8_FLAG, true);
  view.setUint16(10, STORED, true);
  view.setUint16(12, entry.stamp.time, true);
  view.setUint16(14, entry.stamp.date, true);
  view.setUint32(16, entry.crc, true);
  view.setUint32(20, entry.size, true);
  view.setUint32(24, entry.size, true);
  view.setUint16(28, entry.name.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, offset, true);
  bytes.set(entry.name, CENTRAL_HEADER_BYTES);
  return bytes;
};

const eocd = (count: number, size: number, offset: number): Bytes => {
  const bytes = new Uint8Array(EOCD_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, EOCD_SIG, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  view.setUint32(12, size, true);
  view.setUint32(16, offset, true);
  view.setUint16(20, 0, true);
  return bytes;
};

export const zip = async (entries: readonly ZipEntry[]): Promise<Blob> => {
  const stamp = dosStamp(new Date());
  const parts: BlobPart[] = [];
  const directory: Bytes[] = [];
  let offset = 0;

  for (const entry of entries) {
    const bytes = new Uint8Array(await entry.body.arrayBuffer());
    const described: Described = {
      name: encode(entry.path),
      crc: crc32(bytes),
      size: bytes.length,
      stamp,
    };
    const header = localHeader(described);
    directory.push(centralHeader(described, offset));
    parts.push(header, entry.body);
    offset += header.length + described.size;
  }

  const size = directory.reduce((total, header) => total + header.length, 0);
  parts.push(...directory, eocd(entries.length, size, offset));
  return new Blob(parts, { type: 'application/zip' });
};
