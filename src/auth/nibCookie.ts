import { pb } from '../api/pocketbase';
import { NIB_PREFIXES } from '../upstream/origins';

const COOKIE = 'nib_auth';

const write = (prefix: string, token: string): void => {
  const path = prefix.replace(/\/$/, '');
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  const expiry = token ? '' : '; Max-Age=0';
  document.cookie = `${COOKIE}=${token}; Path=${path}; SameSite=Lax${secure}${expiry}`;
};

export const syncNibCookie = (): void => {
  const token = pb.authStore.isValid ? pb.authStore.token : '';
  for (const prefix of NIB_PREFIXES) write(prefix, token);
};
