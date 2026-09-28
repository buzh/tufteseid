// The render sidecar. It names no rectangle and no parameters: the row already
// holds both, and the sidecar reads it back with this reader's own token, so
// PocketBase decides what a job may touch. See `docs/render-sidecar.md`.

import { getEnv } from '../env';
import type { SunLoopLegend } from '../evidence/legendContent';
import { pb } from './pocketbase';

const errorOf = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error) return body.error;
  } catch {
    // Not JSON: Caddy answering for a sidecar that is down.
  }
  return String(response.status);
};

/**
 * Hands the row over. Resolves once the sidecar has accepted and marked it
 * queued — the pixels land later, over the realtime feed, and survive a reload
 * or a closed tab.
 */
const handOver = async (
  path: string,
  body: Record<string, unknown>,
): Promise<void> => {
  const token = pb.authStore.token;
  if (!token) throw new Error('not signed in');

  const response = await fetch(`${getEnv().renderUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await errorOf(response));
};

/** The band is burnt into the frames, so the wording goes with the ask. */
export const requestSunLoop = (
  evidenceId: string,
  legend: SunLoopLegend,
): Promise<void> => handOver('/sunloop', { evidence: evidenceId, legend });

/** Which blend is `meta.vis` on the row, so there is nothing to send but the
 *  id. */
export const requestRvtBlend = (evidenceId: string): Promise<void> =>
  handOver('/rvt', { evidence: evidenceId });
