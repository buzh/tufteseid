// The Mantine theme is the app's design system: anthracite ground, papaya
// accent, dark by default. There is no light scheme to keep in step — the map
// is the bright thing on the screen and the furniture around it stays out of
// the way.
//
// Mantine injects these as CSS variables in a runtime `<style>` element, which
// is why the Caddyfile's `style-src` had to grow `style-src-elem 'unsafe-inline'`
// — see the comment there.

import { createTheme, type MantineColorsTuple } from '@mantine/core';

// Anthracite, lightest first, because that is the direction Mantine reads a
// dark ramp in: shade 7 is the page, 6 a raised surface, 5 its hover, 4 the
// border, 3 placeholders, 2 dimmed text, 0 text. Shade 7 is RAL 7016 exactly;
// the rest hold its hue (192°) at 11–13% saturation, so the greys stay cool
// without turning blue. Contrast on the page: text 9.7:1, dimmed 5.5:1.
const anthracite: MantineColorsTuple = [
  '#d7dde0',
  '#c3cdd0',
  '#99a9ad',
  '#778c92',
  '#56676c',
  '#3b474a',
  '#323c3e',
  '#293133',
  '#1f2628',
  '#181e20',
];

// Papaya, with the accent at shade 5 (5.7:1 on the page). Orange rather than
// the old green because the accent has to be found against terrain: hillshade
// is grey, ortofoto is green and brown, and a green control sat inside both.
const papaya: MantineColorsTuple = [
  '#fff1e5',
  '#ffdcc2',
  '#ffc194',
  '#ffa366',
  '#ff9752',
  '#ff8b3d',
  '#f7701d',
  '#dd5a0e',
  '#b24810',
  '#8a380f',
];

export const theme = createTheme({
  primaryColor: 'papaya',
  primaryShade: { light: 6, dark: 5 },
  // Papaya at shade 5 is bright enough that a filled surface wants dark text
  // on it, not white. Mantine works that out per colour if asked.
  autoContrast: true,
  // `dark` carries the same ten steps under the name Mantine resolves
  // `--mantine-color-body`, `-text`, `-dimmed` and `-default` from, so
  // overriding it is what actually makes the app anthracite. The second
  // registration is so the palette has a name the app can say out loud.
  colors: { papaya, anthracite, dark: anthracite },
  // Self-hosted in `mainApp.tsx`, and the only face the app loads.
  fontFamily: "Mulish, system-ui, -apple-system, 'Segoe UI', sans-serif",
  headings: { fontFamily: 'inherit', fontWeight: '600' },
  defaultRadius: 'md',
  // The ribbon is dense and sits against the map, so the app's base is one step
  // below Mantine's: 14px rather than 16px.
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
