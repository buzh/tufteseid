// The Mantine theme is the app's design system. `tokens.css` is what is left of
// the old one: the surviving map stylesheets read its custom properties, so it
// stays until those are rebuilt, but nothing new should reach for it.
//
// Mantine injects these as CSS variables in a runtime `<style>` element, which
// is why the Caddyfile's `style-src` had to grow `style-src-elem 'unsafe-inline'`
// — see the comment there.

import { createTheme, type MantineColorsTuple } from '@mantine/core';

// The green from the old ramp, filled out to Mantine's ten shades. 0–2 and 4–7
// and 9 are `tokens.css` verbatim; 3 and 8 are interpolated, because that ramp
// only ever needed the steps it used.
const skog: MantineColorsTuple = [
  '#edf7ef',
  '#d0ecd6',
  '#a9d9b4',
  '#7fc291',
  '#4fa45f',
  '#3b8a4c',
  '#2f7040',
  '#245832',
  '#1b4427',
  '#14301c',
];

export const theme = createTheme({
  primaryColor: 'skog',
  // 5 is `--c-accent`; on a dark surface it wants a step of headroom.
  primaryShade: { light: 5, dark: 4 },
  colors: { skog },
  // Self-hosted in `mainApp.tsx`, and the only face the app loads.
  fontFamily:
    "Mulish, system-ui, -apple-system, 'Segoe UI', sans-serif",
  headings: { fontFamily: 'inherit', fontWeight: '600' },
  defaultRadius: 'md',
  // The ribbon is dense and sits over the map, so the app's base is one step
  // below Mantine's: 14px rather than 16px, matching `--font-md`.
  fontSizes: {
    xs: '11px',
    sm: '13px',
    md: '14px',
    lg: '16px',
    xl: '20px',
  },
  radius: {
    xs: '3px',
    sm: '4px',
    md: '6px',
    lg: '10px',
    xl: '16px',
  },
  components: {
    // Menus in this app are pickers over a map: they can be tall, and they
    // must not push the page around.
    Menu: {
      defaultProps: {
        shadow: 'md',
        withinPortal: true,
        position: 'bottom-start',
        offset: 6,
      },
    },
    Tooltip: {
      defaultProps: {
        withArrow: true,
        openDelay: 350,
        multiline: true,
        maw: 320,
      },
    },
  },
});
