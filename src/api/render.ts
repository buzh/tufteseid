

import { getEnv } from '../env';
import type { SunLoopLegend } from '../evidence/legendContent';
import { pb } from './pocketbase';

const errorOf = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error) return body.error;
  } catch {

  }
  return String(response.status);
};

export class RenderRefused extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'RenderRefused';
  }
}

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
  if (!response.ok) throw new RenderRefused(await errorOf(response));
};

export const requestSunLoop = (
  evidenceId: string,
  legend: SunLoopLegend,
): Promise<void> => handOver('/sunloop', { evidence: evidenceId, legend });

export const requestRvtBlend = (evidenceId: string): Promise<void> =>
  handOver('/rvt', { evidence: evidenceId });
