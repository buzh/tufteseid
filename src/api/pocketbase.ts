import PocketBase from 'pocketbase';

import { getEnv } from '../env';

export const pb = new PocketBase(getEnv().pocketbaseUrl);

export type Role = 'guest' | 'user' | 'admin' | 'queued';

export type SiteUser = {
  id: string;
  collectionId: string;
  email: string;
  name: string;
  avatar?: string;
  description?: string;
  role?: Role;
  features?: string[];
  inviteQuota?: number;
  created: string;
  updated: string;
};
