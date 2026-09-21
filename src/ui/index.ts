// What is left of the in-repo UI kit: the icon component, because
// `MaterialSymbol` is the union that keeps a plausible-but-absent icon name from
// reaching the build; the chip, because two unrelated control rows wear it and
// its stylesheet is a module neither of them could reach; and the class-name
// joiner. Mantine supplies the rest — `theme.ts` beside this is where it is
// configured.
export { ControlChip } from './ControlChip';
export { cx } from './cx';
export { Icon, type MaterialSymbol } from './Icon';
export { theme } from './theme';
