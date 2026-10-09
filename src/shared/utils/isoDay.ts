/** The calendar day of a timestamp, ISO 8601. A slice rather than a reformat:
 *  PocketBase and the sidecar both store UTC, and a burnt-in provenance band
 *  must not read as two dates depending on the downloader's timezone. Takes
 *  PocketBase's space-separated form and a bare `YYYY-MM-DD` too. */
export const isoDay = (iso: string): string => iso.slice(0, 10);
