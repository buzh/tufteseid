import {
  Badge,
  Box,
  Button,
  Dialog,
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  Flex,
  HStack,
  Icon,
  IconButton,
  Input,
  MaterialSymbol,
  SimpleGrid,
  Spinner,
  Stack,
  Text,
  toaster,
} from '@kvib/react';
import { useSetAtom } from 'jotai';
import type { ChangeEvent, Dispatch, SetStateAction } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AttachmentKind,
  AttachmentRecord,
  createAttachment,
  deleteAttachment,
  getAttachmentUrl,
  updateAttachmentCaption,
} from '../api/attachments';
import { LocalityRecord } from '../api/localities';
import { lightboxOpenAtom } from './atoms';
import { ConfirmPopover } from './ui';

const KIND_ICON: Record<AttachmentKind, MaterialSymbol> = {
  extract: 'terrain',
  screenshot: 'photo_camera',
  upload: 'image',
};

// Tokened URLs are async (the file field is protected), so every image
// needs a small fetch-then-render dance. `thumb` falls back to the
// original when PB can't generate one — it regularly can't for the huge
// stitched extract PNGs.
const useAttachmentUrl = (
  rec: AttachmentRecord | null,
  thumb?: '200x200' | '800x0',
) => {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setUrl(null);
    setFailed(false);
  }, [rec?.id]);

  useEffect(() => {
    if (!rec) return;
    let cancelled = false;
    getAttachmentUrl(rec, failed ? undefined : thumb)
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch((e) => console.warn('[BilderSection] url failed', e));
    return () => {
      cancelled = true;
    };
    // `rec` is read, not depended on: the list reloads on every realtime
    // event and a fresh object identity would refetch every token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec?.id, rec?.file, thumb, failed]);

  return { url, onError: () => setFailed(true) };
};

const MetaLine = ({ rec }: { rec: AttachmentRecord }) => {
  const meta = rec.meta ?? {};
  const parts = [
    typeof meta.sourceLabel === 'string' ? meta.sourceLabel : null,
    typeof meta.style === 'string' ? meta.style : null,
    typeof meta.metresPerPx === 'number'
      ? `${meta.metresPerPx} m/px`
      : null,
  ].filter((s): s is string => !!s);
  if (parts.length === 0) return null;
  return (
    <Text fontSize="xs" color="gray.500" lineClamp={2}>
      {parts.join(' · ')}
    </Text>
  );
};

const Thumb = ({
  rec,
  onOpen,
}: {
  rec: AttachmentRecord;
  onOpen: () => void;
}) => {
  const { url, onError } = useAttachmentUrl(rec, '200x200');
  return (
    <Stack gap={0.5}>
      <Box
        as="button"
        onClick={onOpen}
        position="relative"
        w="100%"
        aspectRatio={1}
        borderRadius="md"
        overflow="hidden"
        borderWidth="1px"
        borderColor="gray.200"
        bg="gray.100"
        cursor="pointer"
        title={rec.caption || rec.kind}
        _hover={{ borderColor: 'green.500' }}
      >
        {url ? (
          <img
            src={url}
            alt={rec.caption || rec.kind}
            onError={onError}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        ) : (
          <Flex align="center" justify="center" h="100%">
            <Spinner size="xs" />
          </Flex>
        )}
        <Box
          position="absolute"
          bottom="4px"
          left="4px"
          bg="rgba(0, 0, 0, 0.55)"
          color="white"
          borderRadius="sm"
          px={1}
          display="flex"
          alignItems="center"
        >
          <Icon icon={KIND_ICON[rec.kind]} size={14} />
        </Box>
      </Box>
      {rec.caption && (
        <Text fontSize="10px" color="gray.600" lineClamp={1}>
          {rec.caption}
        </Text>
      )}
    </Stack>
  );
};

// Full-size view. Previously this was window.open into a new tab, which
// loses the caption, the metadata and the way back.
const Lightbox = ({
  items,
  index,
  isMine,
  onIndex,
  onClose,
  onDeleted,
  onCaption,
}: {
  items: AttachmentRecord[];
  index: number;
  isMine: boolean;
  onIndex: (i: number) => void;
  onClose: () => void;
  onDeleted: (rec: AttachmentRecord) => void;
  onCaption: (rec: AttachmentRecord, caption: string) => void;
}) => {
  const { t } = useTranslation();
  const rec = items[index] ?? null;
  const { url, onError } = useAttachmentUrl(rec, '800x0');
  const [caption, setCaption] = useState(rec?.caption ?? '');

  useEffect(() => {
    setCaption(rec?.caption ?? '');
  }, [rec?.id, rec?.caption]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        ['INPUT', 'TEXTAREA'].includes(target.tagName)
      ) {
        return;
      }
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      if (e.key === 'ArrowRight' && index < items.length - 1) {
        onIndex(index + 1);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [index, items.length, onIndex]);

  if (!rec) return null;

  const openOriginal = () => {
    getAttachmentUrl(rec)
      .then((u) => window.open(u, '_blank', 'noopener'))
      .catch((e) => console.warn('[BilderSection] open failed', e));
  };

  const commitCaption = () => {
    if (caption.trim() === (rec.caption ?? '')) return;
    onCaption(rec, caption.trim());
  };

  return (
    <Dialog
      open
      placement="center"
      size="xl"
      onOpenChange={(e) => !e.open && onClose()}
    >
      <DialogContent>
        <DialogBody p={4}>
          <Stack gap={3}>
            <Flex
              align="center"
              justify="center"
              bg="gray.900"
              borderRadius="md"
              minH="200px"
              maxH="60vh"
              overflow="hidden"
              position="relative"
            >
              {url ? (
                <img
                  src={url}
                  alt={rec.caption || rec.kind}
                  onError={onError}
                  style={{
                    maxWidth: '100%',
                    maxHeight: '60vh',
                    objectFit: 'contain',
                    display: 'block',
                  }}
                />
              ) : (
                <Spinner size="md" />
              )}
              {items.length > 1 && (
                <>
                  <IconButton
                    icon="chevron_left"
                    aria-label={t('localities.bilder.previous')}
                    position="absolute"
                    left="8px"
                    variant="solid"
                    size="sm"
                    borderRadius="full"
                    disabled={index === 0}
                    onClick={() => onIndex(index - 1)}
                  />
                  <IconButton
                    icon="chevron_right"
                    aria-label={t('localities.bilder.next')}
                    position="absolute"
                    right="8px"
                    variant="solid"
                    size="sm"
                    borderRadius="full"
                    disabled={index === items.length - 1}
                    onClick={() => onIndex(index + 1)}
                  />
                </>
              )}
            </Flex>

            <Flex align="center" gap={2}>
              <Badge colorPalette="gray" size="sm">
                {t(`localities.bilder.kind.${rec.kind}`)}
              </Badge>
              <Text fontSize="xs" color="gray.500">
                {index + 1} / {items.length}
              </Text>
            </Flex>

            <Input
              size="sm"
              value={caption}
              disabled={!isMine}
              placeholder={t('localities.bilder.captionPlaceholder')}
              maxLength={200}
              onChange={(e) => setCaption(e.target.value)}
              onBlur={commitCaption}
            />
            <MetaLine rec={rec} />

            <HStack justify="flex-end">
              <Button
                size="sm"
                variant="tertiary"
                leftIcon="open_in_new"
                onClick={openOriginal}
              >
                {t('localities.bilder.openOriginal')}
              </Button>
              {isMine && (
                <ConfirmPopover
                  title={t('localities.bilder.confirmDelete')}
                  confirmLabel={t('localities.bilder.delete')}
                  onConfirm={() => onDeleted(rec)}
                  trigger={
                    <Button
                      size="sm"
                      variant="tertiary"
                      colorPalette="red"
                      leftIcon="delete"
                    >
                      {t('localities.bilder.delete')}
                    </Button>
                  }
                />
              )}
            </HStack>
          </Stack>
        </DialogBody>
        <DialogCloseTrigger />
      </DialogContent>
    </Dialog>
  );
};

export const BilderSection = ({
  locality,
  userId,
  isMine,
  items,
  setItems,
}: {
  locality: LocalityRecord;
  userId: string;
  isMine: boolean;
  items: AttachmentRecord[] | null;
  setItems: Dispatch<SetStateAction<AttachmentRecord[] | null>>;
}) => {
  const { t } = useTranslation();
  const [uploading, setUploading] = useState(false);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const setLightboxOpen = useSetAtom(lightboxOpenAtom);

  // The workspace's keyboard layer stands down while this is up.
  useEffect(() => {
    setLightboxOpen(openIndex != null);
    return () => setLightboxOpen(false);
  }, [openIndex, setLightboxOpen]);

  const onUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const rec = await createAttachment(
        { locality: locality.id, kind: 'upload', caption: file.name },
        userId,
        file,
        file.name,
      );
      setItems((prev) => (prev ? [rec, ...prev] : [rec]));
    } catch (err) {
      console.warn('[BilderSection] upload failed', err);
      toaster.error({ title: t('localities.bilder.uploadFailed') });
    } finally {
      setUploading(false);
    }
  };

  const remove = async (rec: AttachmentRecord) => {
    try {
      await deleteAttachment(rec.id);
      setItems((prev) => (prev ? prev.filter((it) => it.id !== rec.id) : prev));
      setOpenIndex(null);
    } catch (e) {
      console.warn('[BilderSection] delete failed', e);
      toaster.error({ title: t('localities.workspace.saveFailed') });
    }
  };

  const setCaption = async (rec: AttachmentRecord, caption: string) => {
    try {
      const updated = await updateAttachmentCaption(rec.id, caption);
      setItems((prev) =>
        prev ? prev.map((it) => (it.id === rec.id ? updated : it)) : prev,
      );
    } catch (e) {
      console.warn('[BilderSection] caption save failed', e);
      toaster.error({ title: t('localities.workspace.saveFailed') });
    }
  };

  if (items == null) {
    return (
      <Flex align="center" gap={2}>
        <Spinner size="xs" />
        <Text fontSize="xs" color="gray.500">
          {t('localities.bilder.loading')}
        </Text>
      </Flex>
    );
  }

  return (
    <>
      {items.length === 0 && (
        <Text fontSize="xs" color="gray.600" mb={2}>
          {t('localities.bilder.empty')}
        </Text>
      )}
      <SimpleGrid columns={3} gap={2}>
        {isMine && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: 'none' }}
              onChange={onUpload}
            />
            <Box
              as="button"
              w="100%"
              aspectRatio={1}
              borderRadius="md"
              borderWidth="1px"
              borderStyle="dashed"
              borderColor="gray.300"
              color="gray.500"
              display="flex"
              flexDirection="column"
              alignItems="center"
              justifyContent="center"
              gap={0.5}
              cursor="pointer"
              _hover={{ borderColor: 'green.500', color: 'green.600' }}
              // Inert rather than `disabled` while an upload runs: this is
              // a Box, so it takes style props, not button attributes.
              pointerEvents={uploading ? 'none' : undefined}
              opacity={uploading ? 0.6 : 1}
              onClick={() => fileInputRef.current?.click()}
              title={t('localities.bilder.upload')}
            >
              {uploading ? (
                <Spinner size="sm" />
              ) : (
                <Icon icon="add_photo_alternate" size={22} />
              )}
              <Text fontSize="10px">
                {uploading
                  ? t('localities.bilder.uploading')
                  : t('localities.bilder.upload')}
              </Text>
            </Box>
          </>
        )}
        {items.map((rec, i) => (
          <Thumb key={rec.id} rec={rec} onOpen={() => setOpenIndex(i)} />
        ))}
      </SimpleGrid>

      {openIndex != null && (
        <Lightbox
          items={items}
          index={Math.min(openIndex, items.length - 1)}
          isMine={isMine}
          onIndex={setOpenIndex}
          onClose={() => setOpenIndex(null)}
          onDeleted={remove}
          onCaption={setCaption}
        />
      )}
    </>
  );
};
