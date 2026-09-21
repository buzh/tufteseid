// What is left of the in-repo UI kit after the interface was taken down to the
// map: the icon component, because `MaterialSymbol` is the union that keeps a
// plausible-but-absent icon name from reaching the build, and the class-name
// joiner. The rest of the kit is being rebuilt with the new interface.
export { cx } from './cx';
export { Icon, type MaterialSymbol } from './Icon';
