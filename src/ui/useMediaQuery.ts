import { useSyncExternalStore } from 'react';

const subscribe = (query: string) => (onChange: () => void) => {
  const mql = window.matchMedia(query);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
};

// Cached per query: useSyncExternalStore resubscribes if subscribe changes.
const subscriptions = new Map<string, (onChange: () => void) => () => void>();

const subscriberFor = (query: string) => {
  let existing = subscriptions.get(query);
  if (!existing) {
    existing = subscribe(query);
    subscriptions.set(query, existing);
  }
  return existing;
};

export const useMediaQuery = (query: string): boolean =>
  useSyncExternalStore(
    subscriberFor(query),
    () => window.matchMedia(query).matches,
    () => false, // SSR / first paint: assume desktop.
  );
