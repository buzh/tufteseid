// Mantine emits these as CSS variables in a runtime `<style>` element, so the
// Caddyfile needs `style-src-elem 'unsafe-inline'`.

import { createTheme, type MantineColorsTuple } from '@mantine/core';

// Lightest first: the direction Mantine reads a dark ramp in.
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

// Mantine puts only its *own* sizes through `rem()`, which is what carries
// `--mantine-scale`; an override here is emitted verbatim. So the two scales
// below have to answer to the reader's size preference themselves
// (`src/ui/uiScale.ts`).
const scaled = (px: number) => `calc(${px}px * var(--ui-scale))`;

export const theme = createTheme({
  primaryColor: 'papaya',
  primaryShade: { light: 6, dark: 5 },
  autoContrast: true,
  // Mantine resolves `--mantine-color-body`, `-text`, `-dimmed` and `-default`
  // from `dark`, so overriding it is what makes the app anthracite.
  colors: { papaya, anthracite, dark: anthracite },
  // Self-hosted in `mainApp.tsx`.
  fontFamily: "Mulish, system-ui, -apple-system, 'Segoe UI', sans-serif",
  headings: { fontFamily: 'inherit', fontWeight: '600' },
  defaultRadius: 'md',
  fontSizes: {
    xs: scaled(11),
    sm: scaled(13),
    md: scaled(14),
    lg: scaled(16),
    xl: scaled(20),
  },
  radius: {
    xs: scaled(3),
    sm: scaled(4),
    md: scaled(6),
    lg: scaled(10),
    xl: scaled(16),
  },
  components: {
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
