// What is left of the in-repo UI kit: the icon component, because
// `MaterialSymbol` is the union that keeps a plausible-but-absent icon name from
// reaching the build, and the class-name joiner. Mantine supplies the rest —
// `theme.ts` beside this is where it is configured.
export { cx } from './cx';
export { Icon, type MaterialSymbol } from './Icon';
export { theme } from './theme';
