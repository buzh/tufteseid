/**
 * The calendar day of a timestamp, ISO 8601.
 *
 * A slice rather than a reformat: PocketBase and the sidecar both store UTC,
 * and a burnt-in provenance band must not read as two different dates
 * depending on which timezone the file was downloaded in. Takes PocketBase's
 * space-separated form and a bare `YYYY-MM-DD` as readily as an ISO instant.
 */
export const isoDay = (iso: string): string => iso.slice(0, 10);
