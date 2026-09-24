// Filenames end up in a download dialog, so keep them to something a filesystem
// and a URL both accept.

export const sanitizeFilename = (s: string): string =>
  s.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 80) || 'bilde';
