import { useCallback, useState } from 'react';

import { evidenceFileUrl, type EvidenceRecord } from '../api/evidence';
import type { SpotRecord } from '../api/spots';
import type { Metric } from '../map/bbox';
import { sanitizeFilename } from '../shared/utils/filename';
import { canvasBlob, MAX_STORED_PIXELS } from './fit';
import type { EvidenceGroup } from './groups';
import { evidenceTitle } from './labels';
import { withLegend } from './legend';
import { centreOf, legendContentFor } from './legendContent';
import {
  evidenceBbox,
  evidenceResolution,
  isReadable,
  isVideoEvidence,
  specOf,
} from './spec';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'video/webm': 'webm',
};

export const extensionOf = (type: string): string => EXTENSIONS[type] ?? 'png';

const decodeToCanvas = async (
  blob: Blob,
): Promise<HTMLCanvasElement | null> => {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    return canvas;
  } finally {
    bitmap.close();
  }
};

const stampCanvas = async (
  canvas: HTMLCanvasElement,
  rec: EvidenceRecord,
  spot: SpotRecord,
  bbox: Metric | null,
  type: string,
): Promise<Blob | null> => {
  const content = legendContentFor(rec, spot, bbox ? centreOf(bbox) : '');
  const stamped = content
    ? await withLegend(canvas, {
        ...content,
        metresPerPx: bbox
          ? (bbox[2] - bbox[0]) / canvas.width
          : (evidenceResolution(rec) ?? 0),
      })
    : canvas;
  const jpeg = type === 'image/jpeg';
  return canvasBlob(
    stamped,
    jpeg ? 'image/jpeg' : 'image/png',
    jpeg ? 0.9 : undefined,
  );
};

const stampEvidence = async (
  blob: Blob,
  rec: EvidenceRecord,
  spot: SpotRecord,
): Promise<Blob> => {
  if (blob.type.startsWith('video/')) return blob;

  try {
    const canvas = await decodeToCanvas(blob);
    if (!canvas) return blob;
    const out = await stampCanvas(
      canvas,
      rec,
      spot,
      evidenceBbox(rec),
      blob.type,
    );
    return out ?? blob;
  } catch (e) {
    console.warn('[evidence] stamp failed', e);
    return blob;
  }
};

const fetchBlob = async (url: string): Promise<Blob> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`file ${res.status}`);
  return res.blob();
};

const decodeTile = async (
  rec: EvidenceRecord,
): Promise<{ canvas: HTMLCanvasElement; bbox: Metric } | null> => {
  const url = evidenceFileUrl(rec);
  const bbox = evidenceBbox(rec);
  if (!url || !bbox) return null;
  const canvas = await decodeToCanvas(await fetchBlob(url));
  return canvas ? { canvas, bbox } : null;
};

const mosaicCanvas = (
  union: Metric,
  metresPerPx: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null => {
  const width = (union[2] - union[0]) / metresPerPx;
  const height = (union[3] - union[1]) / metresPerPx;
  if (!(width >= 1) || !(height >= 1)) return null;
  const scale = Math.min(1, Math.sqrt(MAX_STORED_PIXELS / (width * height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  return ctx ? { canvas, ctx } : null;
};

const stitchTiles = async (
  rows: readonly EvidenceRecord[],
): Promise<{ canvas: HTMLCanvasElement; bbox: Metric } | null> => {
  const first = await decodeTile(rows[0]);
  if (!first) return null;
  const boxes = rows
    .map(evidenceBbox)
    .filter((box): box is Metric => box !== null);
  const union: Metric = [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
  const out = mosaicCanvas(
    union,
    (first.bbox[2] - first.bbox[0]) / first.canvas.width,
  );
  if (!out) return null;

  const pxX = (union[2] - union[0]) / out.canvas.width;
  const pxY = (union[3] - union[1]) / out.canvas.height;
  const lay = (tile: { canvas: HTMLCanvasElement; bbox: Metric }) => {
    const x0 = Math.round((tile.bbox[0] - union[0]) / pxX);
    const x1 = Math.round((tile.bbox[2] - union[0]) / pxX);
    const y0 = Math.round((union[3] - tile.bbox[3]) / pxY);
    const y1 = Math.round((union[3] - tile.bbox[1]) / pxY);
    out.ctx.drawImage(
      tile.canvas,
      x0,
      y0,
      Math.max(1, x1 - x0),
      Math.max(1, y1 - y0),
    );
  };

  lay(first);
  for (const rec of rows.slice(1)) {
    const tile = await decodeTile(rec);
    if (tile) lay(tile);
  }
  return { canvas: out.canvas, bbox: union };
};

const pictureBlob = async (
  group: EvidenceGroup,
  spot: SpotRecord,
): Promise<Blob> => {
  const cover = group.cover;
  const tiles = group.rows.filter(isReadable);
  if (tiles.length < 2 || isVideoEvidence(cover)) {
    return stampEvidence(await fetchBlob(evidenceFileUrl(cover)), cover, spot);
  }
  const laid = await stitchTiles(tiles);
  const jpeg = cover.file.toLowerCase().endsWith('.jpg');
  const out =
    laid &&
    (await stampCanvas(
      laid.canvas,
      cover,
      spot,
      laid.bbox,
      jpeg ? 'image/jpeg' : 'image/png',
    ));
  if (!out) throw new Error('mosaic stitch failed');
  return out;
};

export const saveBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};

type EvidenceDownload = {
  download: (group: EvidenceGroup) => void;
  busyId: string | null;
  failedId: string | null;
};

export const useEvidenceDownload = (spot: SpotRecord): EvidenceDownload => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);

  const download = useCallback(
    (group: EvidenceGroup) => {
      const cover = group.cover;
      if (!evidenceFileUrl(cover) || busyId) return;
      setBusyId(cover.id);
      setFailedId(null);
      void (async () => {
        try {
          const blob = await pictureBlob(group, spot);
          const spec = specOf(cover);
          const name = sanitizeFilename(
            [spot.name, spec && evidenceTitle(spec)].filter(Boolean).join(' '),
          );
          saveBlob(blob, `${name}.${extensionOf(blob.type)}`);
        } catch (e) {
          console.warn('[evidence] download failed', e);
          setFailedId(cover.id);
        } finally {
          setBusyId(null);
        }
      })();
    },
    [spot, busyId],
  );

  return { download, busyId, failedId };
};
