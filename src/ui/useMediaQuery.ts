import { useSyncExternalStore } from 'react';

// Plain matchMedia. Replaces kvib's useKvibContext + getBreakpointCondition +
// useMediaQuery trio, which was the only reason src/shared/hooks.ts imported
// from the component library at all.

const subscribe = (query: string) => (onChange: () => void) => {
  const mql = window.matchMedia(query);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
};

// Cache per query so the subscribe identity is stable across renders —
// useSyncExternalStore resubscribes whenever it changes.
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
    () => false, // SSR/first paint: assume desktop, matching the old behaviour
  );

// Breakpoints, in rem to match the values kvib/Chakra used, so the
// mobile/desktop split does not shift for anyone as components migrate.
// Only `md` is load-bearing today; the rest are here so ribbon rows have
// somewhere to wrap.
export const BREAKPOINTS = {
  sm: 30, // 480px
  md: 48, // 768px
  lg: 62, // 992px
  xl: 80, // 1280px
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

export const useBreakpointUp = (bp: Breakpoint): boolean =>
  useMediaQuery(`(min-width: ${BREAKPOINTS[bp]}rem)`);
