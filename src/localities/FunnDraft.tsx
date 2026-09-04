import { Button, Flex, HStack, Input, Stack, Text } from '@kvib/react';
import { useTranslation } from 'react-i18next';
import { DrawControls } from '../draw/drawControls/DrawControls';
import { NoteInput } from './ui';

// The new-funn / edit-the-drawing form. Unlike an existing row (which
// saves on blur) a draft is a commit-or-discard form: there is no record
// yet to fall back to, and the drawing on the map has to be cleaned up
// either way.
export const FunnDraft = ({
  editing,
  title,
  note,
  saving,
  error,
  onTitle,
  onNote,
  onSave,
  onCancel,
}: {
  editing: boolean;
  title: string;
  note: string;
  saving: boolean;
  error: string | null;
  onTitle: (v: string) => void;
  onNote: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) => {
  const { t } = useTranslation();
  return (
    <Stack gap={2.5}>
      <Text fontSize="xs" color="gray.600">
        {t(
          editing
            ? 'localities.funn.draft.instructionsEdit'
            : 'localities.funn.draft.instructions',
        )}
      </Text>

      <DrawControls />

      <Input
        size="sm"
        value={title}
        onChange={(e) => onTitle(e.target.value)}
        placeholder={t('localities.funn.draft.titlePlaceholder')}
        maxLength={200}
      />
      <NoteInput
        value={note}
        onChange={onNote}
        placeholder={t('localities.funn.draft.notePlaceholder')}
      />

      {error && (
        <Text fontSize="xs" color="red.600">
          {error}
        </Text>
      )}

      <Flex justify="flex-end">
        <HStack>
          <Button size="sm" variant="tertiary" onClick={onCancel}>
            {t('localities.funn.draft.cancel')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            colorPalette="green"
            onClick={onSave}
            disabled={saving || title.trim().length === 0}
          >
            {saving
              ? t('localities.workspace.saving')
              : t('localities.funn.draft.save')}
          </Button>
        </HStack>
      </Flex>
    </Stack>
  );
};
