// Mantine's own stylesheet is precompiled; this is for ours. The preset gives
// the CSS modules in `src/` the `light-dark()`, `rem()` and breakpoint mixins
// Mantine's docs assume, so a module written against the theme behaves the same
// way Mantine's own styles do.
module.exports = {
  plugins: {
    'postcss-preset-mantine': {},
    'postcss-simple-vars': {
      variables: {
        'mantine-breakpoint-xs': '36em',
        'mantine-breakpoint-sm': '48em',
        'mantine-breakpoint-md': '62em',
        'mantine-breakpoint-lg': '75em',
        'mantine-breakpoint-xl': '88em',
      },
    },
  },
};
