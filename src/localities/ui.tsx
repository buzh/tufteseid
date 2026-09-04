import {
  Badge,
  Box,
  Button,
  CollapsibleContent,
  CollapsibleRoot,
  CollapsibleTrigger,
  Flex,
  HStack,
  Icon,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverRoot,
  PopoverTitle,
  PopoverTrigger,
  Text,
  Textarea,
} from '@kvib/react';
import { useAtom } from 'jotai';
import type { ChangeEvent, ReactNode } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { openSectionsAtom, WorkspaceSectionId } from './atoms';

// Shared chrome for the lokalitet workspace. Everything here exists so
// the panel reads as one surface instead of a stack of ad-hoc forms —
// notably: no native <textarea>/<select> with hardcoded hex borders, and
// no window.confirm for destructive actions.

// kvib narrows `colorPalette` per component: Badge passes chakra's token
// set straight through, while Button and IconButton accept exactly these
// four. Naming both keeps a bare `string` out of a lookup table that
// feeds either one.
export type BadgePalette = 'gray' | 'green' | 'yellow' | 'red' | 'blue';
export type ButtonPalette = 'green' | 'blue' | 'gray' | 'red';

// One collapsible block with a heading, a count and an optional action
// button on the header row. Open state lives in openSectionsAtom, not
// local state, so it survives the remount on lokalitet swap.
export const WorkspaceSection = ({
  id,
  title,
  count,
  countPalette = 'gray',
  action,
  children,
}: {
  id: WorkspaceSectionId;
  title: string;
  count?: number | string | null;
  countPalette?: BadgePalette;
  action?: ReactNode;
  children: ReactNode;
}) => {
  const [openSections, setOpenSections] = useAtom(openSectionsAtom);
  const open = openSections.has(id);

  const setOpen = (next: boolean) => {
    setOpenSections((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(id);
      else copy.delete(id);
      return copy;
    });
  };

  return (
    <CollapsibleRoot open={open} onOpenChange={(e) => setOpen(e.open)}>
      <Flex align="center" gap={2} minH="28px">
        <CollapsibleTrigger flex="1" minW={0}>
          <Flex align="center" gap={1.5} cursor="pointer">
            <Box
              transform={open ? 'rotate(90deg)' : undefined}
              transition="transform 120ms"
              display="flex"
            >
              <Icon icon="chevron_forward" size={18} />
            </Box>
            <Text fontSize="sm" fontWeight="bold">
              {title}
            </Text>
            {count != null && count !== 0 && (
              <Badge colorPalette={countPalette} size="sm">
                {count}
              </Badge>
            )}
          </Flex>
        </CollapsibleTrigger>
        {action}
      </Flex>
      <CollapsibleContent>
        <Box pt={1.5} pl={0.5}>
          {children}
        </Box>
      </CollapsibleContent>
    </CollapsibleRoot>
  );
};

// Multi-line input, styled to sit next to kvib's Input rather than
// looking like a raw <textarea> with an inline stylesheet, which is what
// the proof-of-concept forms used.
export const NoteInput = ({
  value,
  onChange,
  onBlur,
  placeholder,
  rows = 2,
  disabled,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  autoFocus?: boolean;
}) => (
  <Textarea
    value={value}
    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
    onBlur={onBlur}
    placeholder={placeholder}
    rows={rows}
    maxLength={20000}
    disabled={disabled}
    autoFocus={autoFocus}
    size="sm"
    fontSize="sm"
    lineHeight="1.4"
    borderColor="gray.300"
    resize="vertical"
    _hover={{ borderColor: disabled ? 'gray.300' : 'gray.400' }}
    _focus={{
      borderColor: 'green.500',
      outline: '1px solid',
      outlineColor: 'green.500',
      outlineOffset: '-1px',
    }}
  />
);

// Segmented picker — one click per value, which beats a <select> for the
// two three-way choices in here (synlighet, funn-status list filter).
export const Segmented = <T extends string>({
  value,
  options,
  onChange,
  disabled,
  size = 'xs',
}: {
  value: T;
  options: { value: T; label: string; palette?: ButtonPalette }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  size?: 'xs' | 'sm';
}) => (
  <Flex
    borderRadius="md"
    overflow="hidden"
    borderWidth="1px"
    borderColor="gray.200"
    w="fit-content"
    maxW="100%"
  >
    {options.map((o) => (
      <Button
        key={o.value}
        variant={value === o.value ? 'primary' : 'tertiary'}
        colorPalette={o.palette ?? 'green'}
        size={size}
        borderRadius={0}
        px={2.5}
        disabled={disabled}
        aria-pressed={value === o.value}
        onClick={() => onChange(o.value)}
      >
        {o.label}
      </Button>
    ))}
  </Flex>
);

// Destructive confirm anchored to the button that triggers it, matching
// the "tøm tegning" popover in DrawControlsFooter. Replaces
// window.confirm, which yanks the user out of the app and reads as
// unfinished.
export const ConfirmPopover = ({
  trigger,
  title,
  confirmLabel,
  onConfirm,
}: {
  trigger: ReactNode;
  title: string;
  confirmLabel: string;
  onConfirm: () => void;
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <PopoverRoot open={open} onOpenChange={(e) => setOpen(e.open)}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent width="260px">
        <PopoverArrow />
        <PopoverBody>
          <PopoverTitle fontSize="sm">{title}</PopoverTitle>
          <HStack mt={3} justifyContent="flex-end">
            <Button size="xs" variant="tertiary" onClick={() => setOpen(false)}>
              {t('localities.funn.draft.cancel')}
            </Button>
            <Button
              size="xs"
              variant="primary"
              colorPalette="red"
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </HStack>
        </PopoverBody>
      </PopoverContent>
    </PopoverRoot>
  );
};
