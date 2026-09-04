import {
  Badge,
  Box,
  Button,
  Flex,
  HStack,
  Icon,
  IconButton,
  Input,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverRoot,
  PopoverTitle,
  PopoverTrigger,
  Spinner,
  Stack,
  Text,
} from '@kvib/react';
import { useSetAtom } from 'jotai';
import type { MouseEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LocalityFindRecord,
  LocalityFindStatus,
} from '../api/localityFinds';
import { hoveredFunnIdAtom } from './atoms';
import { BadgePalette, NoteInput } from './ui';

const STATUS_ORDER: LocalityFindStatus[] = [
  'mulig',
  'sannsynlig',
  'avkreftet',
  'rapportert',
];

const STATUS_PALETTE: Record<LocalityFindStatus, BadgePalette> = {
  mulig: 'yellow',
  sannsynlig: 'green',
  avkreftet: 'red',
  rapportert: 'blue',
};

// Status used to cycle on click through four values with no way back and
// no way to see what the next one was. It's a pick-from-a-list, so it's a
// list.
const StatusPicker = ({
  value,
  editable,
  onChange,
}: {
  value: LocalityFindStatus;
  editable: boolean;
  onChange: (v: LocalityFindStatus) => void;
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const badge = (
    <Badge
      colorPalette={STATUS_PALETTE[value]}
      size="sm"
      flexShrink={0}
      whiteSpace="nowrap"
    >
      {t(`localities.funn.status.${value}`)}
    </Badge>
  );

  if (!editable) return badge;

  return (
    <PopoverRoot open={open} onOpenChange={(e) => setOpen(e.open)}>
      <PopoverTrigger asChild>
        <Box
          as="button"
          display="flex"
          alignItems="center"
          gap={0.5}
          flexShrink={0}
          borderRadius="sm"
          title={t('localities.funn.status.pickHint')}
          onClick={(e: MouseEvent) => e.stopPropagation()}
        >
          {badge}
          <Icon icon="keyboard_arrow_down" size={14} />
        </Box>
      </PopoverTrigger>
      <PopoverContent width="190px">
        <PopoverArrow />
        <PopoverBody>
          <PopoverTitle fontSize="xs" mb={2}>
            {t('localities.funn.status.heading')}
          </PopoverTitle>
          <Stack gap={1}>
            {STATUS_ORDER.map((s) => (
              <Button
                key={s}
                size="xs"
                justifyContent="flex-start"
                variant={s === value ? 'secondary' : 'ghost'}
                colorPalette="gray"
                onClick={(e: MouseEvent) => {
                  e.stopPropagation();
                  setOpen(false);
                  if (s !== value) onChange(s);
                }}
              >
                {/* The same badge the row shows, so picking is
                    recognition rather than reading a word list. */}
                <Badge colorPalette={STATUS_PALETTE[s]} size="sm">
                  {t(`localities.funn.status.${s}`)}
                </Badge>
              </Button>
            ))}
          </Stack>
        </PopoverBody>
      </PopoverContent>
    </PopoverRoot>
  );
};

// Row actions behind one affordance instead of three always-on icon
// buttons. Delete confirms in place rather than nesting a second popover.
const RowMenu = ({
  onEditText,
  onEditGeometry,
  onDelete,
}: {
  onEditText: () => void;
  onEditGeometry: () => void;
  onDelete: () => void;
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const close = () => {
    setOpen(false);
    setConfirming(false);
  };

  return (
    <PopoverRoot
      open={open}
      onOpenChange={(e) => {
        setOpen(e.open);
        if (!e.open) setConfirming(false);
      }}
    >
      <PopoverTrigger asChild>
        <IconButton
          icon="more_vert"
          size="xs"
          variant="ghost"
          aria-label={t('localities.funn.actions.menu')}
          onClick={(e: MouseEvent) => e.stopPropagation()}
        />
      </PopoverTrigger>
      <PopoverContent width="230px">
        <PopoverArrow />
        <PopoverBody onClick={(e: MouseEvent) => e.stopPropagation()}>
          {confirming ? (
            <>
              <PopoverTitle fontSize="sm">
                {t('localities.funn.confirmDeleteShort')}
              </PopoverTitle>
              <HStack mt={3} justifyContent="flex-end">
                <Button
                  size="xs"
                  variant="tertiary"
                  onClick={() => setConfirming(false)}
                >
                  {t('localities.funn.draft.cancel')}
                </Button>
                <Button
                  size="xs"
                  variant="primary"
                  colorPalette="red"
                  onClick={() => {
                    close();
                    onDelete();
                  }}
                >
                  {t('localities.funn.actions.delete')}
                </Button>
              </HStack>
            </>
          ) : (
            <Stack gap={1}>
              <Button
                size="xs"
                variant="ghost"
                justifyContent="flex-start"
                leftIcon="edit"
                onClick={() => {
                  close();
                  onEditText();
                }}
              >
                {t('localities.funn.actions.edit')}
              </Button>
              <Button
                size="xs"
                variant="ghost"
                justifyContent="flex-start"
                leftIcon="draw"
                onClick={() => {
                  close();
                  onEditGeometry();
                }}
              >
                {t('localities.funn.actions.editGeometry')}
              </Button>
              <Button
                size="xs"
                variant="ghost"
                colorPalette="red"
                justifyContent="flex-start"
                leftIcon="delete"
                onClick={() => setConfirming(true)}
              >
                {t('localities.funn.actions.delete')}
              </Button>
            </Stack>
          )}
        </PopoverBody>
      </PopoverContent>
    </PopoverRoot>
  );
};

const FunnRow = ({
  funn,
  editable,
  selected,
  onSelect,
  onStatus,
  onSaveMeta,
  onEditGeometry,
  onDelete,
}: {
  funn: LocalityFindRecord;
  editable: boolean;
  selected: boolean;
  onSelect: (f: LocalityFindRecord) => void;
  onStatus: (f: LocalityFindRecord, s: LocalityFindStatus) => void;
  onSaveMeta: (f: LocalityFindRecord, title: string, note: string) => void;
  onEditGeometry: (f: LocalityFindRecord) => void;
  onDelete: (f: LocalityFindRecord) => void;
}) => {
  const { t } = useTranslation();
  const setHovered = useSetAtom(hoveredFunnIdAtom);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(funn.title);
  const [note, setNote] = useState(funn.note ?? '');
  const rowRef = useRef<HTMLDivElement | null>(null);

  // Keyboard navigation moves the selection; the row it lands on has to
  // come into view on its own.
  useEffect(() => {
    if (selected) {
      rowRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [selected]);

  // A realtime update to the record while the row sits open would
  // otherwise be overwritten by the stale draft on the next blur.
  useEffect(() => {
    if (!editing) {
      setTitle(funn.title);
      setNote(funn.note ?? '');
    }
  }, [funn.title, funn.note, editing]);

  // Existing records save on blur — no Lagre/Avbryt pair for a field you
  // are editing in place. Drafts (new funn) are still forms; see
  // FunnDraft.
  const commit = () => {
    const nextTitle = title.trim();
    const nextNote = note.trim();
    if (nextTitle.length === 0) {
      setTitle(funn.title);
      return;
    }
    if (nextTitle === funn.title && nextNote === (funn.note ?? '')) return;
    onSaveMeta(funn, nextTitle, nextNote);
  };

  return (
    <Box
      ref={rowRef}
      borderWidth="1px"
      borderLeftWidth="3px"
      borderColor={selected ? 'green.500' : 'gray.200'}
      borderLeftColor={selected ? 'green.500' : 'gray.200'}
      borderRadius="md"
      bg={selected ? 'green.50' : undefined}
      p={2}
      cursor={editing ? undefined : 'pointer'}
      _hover={editing ? undefined : { bg: selected ? 'green.50' : 'gray.50' }}
      onMouseEnter={() => setHovered(funn.id)}
      onMouseLeave={() => setHovered(null)}
      onClick={() => !editing && onSelect(funn)}
      title={editing ? undefined : t('localities.funn.actions.zoom')}
    >
      <Flex justify="space-between" align="flex-start" gap={2}>
        <Box flex="1" minW={0}>
          {editing ? (
            <Stack gap={1.5}>
              <Input
                size="sm"
                value={title}
                autoFocus
                onChange={(e) => setTitle(e.target.value)}
                onBlur={commit}
                maxLength={200}
              />
              <NoteInput
                value={note}
                onChange={setNote}
                onBlur={commit}
                placeholder={t('localities.funn.draft.notePlaceholder')}
              />
              <Flex justify="flex-end">
                <Button
                  size="xs"
                  variant="secondary"
                  colorPalette="green"
                  onClick={() => {
                    commit();
                    setEditing(false);
                  }}
                >
                  {t('localities.funn.actions.done')}
                </Button>
              </Flex>
            </Stack>
          ) : (
            <>
              <Text fontWeight="semibold" fontSize="sm" lineClamp={1}>
                {funn.title}
              </Text>
              {funn.note && (
                <Text fontSize="xs" color="gray.600" lineClamp={2}>
                  {funn.note}
                </Text>
              )}
            </>
          )}
        </Box>
        {!editing && (
          <HStack gap={0.5} flexShrink={0}>
            <StatusPicker
              value={funn.status}
              editable={editable}
              onChange={(s) => onStatus(funn, s)}
            />
            {editable && (
              <RowMenu
                onEditText={() => setEditing(true)}
                onEditGeometry={() => onEditGeometry(funn)}
                onDelete={() => onDelete(funn)}
              />
            )}
          </HStack>
        )}
      </Flex>
    </Box>
  );
};

export const FunnList = ({
  items,
  editable,
  selectedId,
  onSelect,
  onStatus,
  onSaveMeta,
  onEditGeometry,
  onDelete,
}: {
  items: LocalityFindRecord[] | null;
  editable: boolean;
  selectedId: string | null;
  onSelect: (f: LocalityFindRecord) => void;
  onStatus: (f: LocalityFindRecord, s: LocalityFindStatus) => void;
  onSaveMeta: (f: LocalityFindRecord, title: string, note: string) => void;
  onEditGeometry: (f: LocalityFindRecord) => void;
  onDelete: (f: LocalityFindRecord) => void;
}) => {
  const { t } = useTranslation();
  const setHovered = useSetAtom(hoveredFunnIdAtom);

  // The halo has no business outliving the list it belongs to.
  useEffect(() => () => setHovered(null), [setHovered]);

  if (items == null) {
    return (
      <Flex align="center" gap={2}>
        <Spinner size="xs" />
        <Text fontSize="xs" color="gray.500">
          {t('localities.funn.loading')}
        </Text>
      </Flex>
    );
  }

  if (items.length === 0) {
    return (
      <Text fontSize="xs" color="gray.600">
        {t('localities.funn.empty')}
      </Text>
    );
  }

  return (
    <Stack gap={1.5}>
      {items.map((f) => (
        <FunnRow
          key={f.id}
          funn={f}
          editable={editable}
          selected={f.id === selectedId}
          onSelect={onSelect}
          onStatus={onStatus}
          onSaveMeta={onSaveMeta}
          onEditGeometry={onEditGeometry}
          onDelete={onDelete}
        />
      ))}
    </Stack>
  );
};
