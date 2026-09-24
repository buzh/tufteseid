/** Reduced to what a filesystem and a URL both accept. */
export const sanitizeFilename = (s: string): string =>
  s.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 80) || 'bilde';
