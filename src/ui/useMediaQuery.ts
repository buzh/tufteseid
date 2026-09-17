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

// In rem. Only `md` is load-bearing today.
export const BREAKPOINTS = {
  sm: 30, // 480px
  md: 48, // 768px
  lg: 62, // 992px
  xl: 80, // 1280px
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

export const useBreakpointUp = (bp: Breakpoint): boolean =>
  useMediaQuery(`(min-width: ${BREAKPOINTS[bp]}rem)`);
