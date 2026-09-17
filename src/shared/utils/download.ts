// Handing bytes to the browser's downloader.

/**
 * An anchor rather than `window.open`: a blob URL opened seconds after the
 * click that asked for it is a popup and gets blocked.
 */
export const saveBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  // Firefox ignores a click on an anchor that is not in the document.
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // On a timer: revoking in the same tick cancels the transfer in some
  // browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};
