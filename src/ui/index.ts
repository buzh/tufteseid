/*
 * In-repo UI kit. Plain CSS Modules over design tokens, no runtime style
 * injection, no new dependencies — what replaced @kvib/react, which the app
 * no longer depends on at all. Rationale: docs/ui-architecture.md.
 *
 * Import from 'src/ui' rather than the individual files so the eventual
 * additions and removals are invisible to call sites.
 */
export { Alert, type AlertTone } from './Alert';
export { Badge, CountBadge, type BadgePalette } from './Badge';
export {
  Button,
  IconButton,
  type ButtonPalette,
  type ButtonVariant,
  type ControlSize,
} from './Button';
export { ConfirmPopover } from './ConfirmPopover';
export { cx } from './cx';
export { Dialog } from './Dialog';
export { Field, Input, NoteInput } from './Field';
export { Icon, type MaterialSymbol } from './Icon';
export { anyOverlayOpenAtom, overlayOpenCountAtom } from './overlayAtoms';
export { Popover } from './Popover';
export { Section } from './Section';
export { Segmented, type SegmentedOption } from './Segmented';
export { Spinner } from './Spinner';
export { Switch } from './Switch';
export { toast, Toaster, type ToastOptions, type ToastTone } from './Toast';
export { Tooltip } from './Tooltip';
export {
  BREAKPOINTS,
  useBreakpointUp,
  useMediaQuery,
  type Breakpoint,
} from './useMediaQuery';
