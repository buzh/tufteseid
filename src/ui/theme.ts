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
