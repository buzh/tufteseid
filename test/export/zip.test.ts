import { describe, expect, it } from 'vitest';
import { crc32, zip } from '../../src/export/zip';

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const EOCD_BYTES = 22;

const bytesOf = async (blob: Blob): Promise<DataView> =>
  new DataView(await blob.arrayBuffer());

const textEntry = (path: string, body: string) => ({
  path,
  body: new Blob([body]),
});

describe('crc32', () => {
  it('matches the published check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('is zero over nothing', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('zip', () => {
  it('writes a local header, a central header and an EOCD', async () => {
    const archive = await zip([textEntry('a/b.txt', 'hello')]);
    const view = await bytesOf(archive);

    expect(view.getUint32(0, true)).toBe(LOCAL_SIG);

    const nameBytes = 'a/b.txt'.length;
    const bodyBytes = 'hello'.length;
    const centralAt = LOCAL_HEADER_BYTES + nameBytes + bodyBytes;
    expect(view.getUint32(centralAt, true)).toBe(CENTRAL_SIG);

    const eocdAt = centralAt + CENTRAL_HEADER_BYTES + nameBytes;
    expect(view.getUint32(eocdAt, true)).toBe(EOCD_SIG);
    expect(view.byteLength).toBe(eocdAt + EOCD_BYTES);
  });

  it('stores rather than deflates, with both sizes equal', async () => {
    const view = await bytesOf(await zip([textEntry('x.txt', 'abcabcabc')]));
    expect(view.getUint16(8, true)).toBe(0);
    expect(view.getUint32(18, true)).toBe(9);
    expect(view.getUint32(22, true)).toBe(9);
  });

  it('flags entry names as UTF-8', async () => {
    const view = await bytesOf(await zip([textEntry('rør.txt', 'x')]));
    expect(view.getUint16(6, true) & 0x0800).toBe(0x0800);
  });

  it('records the name length in bytes, not characters', async () => {
    const view = await bytesOf(await zip([textEntry('rør.txt', 'x')]));
    expect(view.getUint16(26, true)).toBe(8);
  });

  it('points each central header at its own local header', async () => {
    const entries = [textEntry('one.txt', 'aaa'), textEntry('two.txt', 'bbbb')];
    const view = await bytesOf(await zip(entries));

    const secondLocalAt = LOCAL_HEADER_BYTES + 7 + 3;
    const directoryAt = secondLocalAt + LOCAL_HEADER_BYTES + 7 + 4;
    expect(view.getUint32(secondLocalAt, true)).toBe(LOCAL_SIG);
    expect(view.getUint32(directoryAt, true)).toBe(CENTRAL_SIG);

    const OFFSET_FIELD = 42;
    expect(view.getUint32(directoryAt + OFFSET_FIELD, true)).toBe(0);
    const nextCentralAt = directoryAt + CENTRAL_HEADER_BYTES + 7;
    expect(view.getUint32(nextCentralAt + OFFSET_FIELD, true)).toBe(
      secondLocalAt,
    );
  });

  it('counts the entries and sizes the directory in the EOCD', async () => {
    const entries = [textEntry('one.txt', 'aaa'), textEntry('two.txt', 'bbbb')];
    const archive = await zip(entries);
    const view = await bytesOf(archive);
    const eocdAt = view.byteLength - EOCD_BYTES;

    expect(view.getUint32(eocdAt, true)).toBe(EOCD_SIG);
    expect(view.getUint16(eocdAt + 8, true)).toBe(2);
    expect(view.getUint16(eocdAt + 10, true)).toBe(2);

    const directoryBytes = (CENTRAL_HEADER_BYTES + 7) * 2;
    expect(view.getUint32(eocdAt + 12, true)).toBe(directoryBytes);
    expect(view.getUint32(eocdAt + 16, true)).toBe(
      view.byteLength - EOCD_BYTES - directoryBytes,
    );
  });

  it('writes an empty archive as a bare EOCD', async () => {
    const view = await bytesOf(await zip([]));
    expect(view.byteLength).toBe(EOCD_BYTES);
    expect(view.getUint32(0, true)).toBe(EOCD_SIG);
    expect(view.getUint16(8, true)).toBe(0);
  });
});
