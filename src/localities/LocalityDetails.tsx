import { Flex, Stack, Text } from '@kvib/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LocalityPatch,
  LocalityRecord,
  LocalityVisibility,
} from '../api/localities';
import { formatDate } from './format';
import { NoteInput, Segmented } from './ui';

const VISIBILITY_ORDER: LocalityVisibility[] = ['private', 'limited', 'public'];

const Fact = ({ label, value }: { label: string; value: string }) => (
  <Flex justify="space-between" gap={3} fontSize="xs">
    <Text color="gray.500">{label}</Text>
    <Text color="gray.700" textAlign="right" lineClamp={1}>
      {value}
    </Text>
  </Flex>
);

// Everything you set once and then stop looking at. Folded away by
// default so the funn/bilder you came back for are the first thing in
// the panel. Saves on blur (description) or on click (synlighet) — the
// dirty-state Lagre button it replaces was the only thing in the
// workspace that made you confirm a single-field edit.
export const LocalityDetails = ({
  locality,
  isMine,
  onPatch,
}: {
  locality: LocalityRecord;
  isMine: boolean;
  onPatch: (patch: LocalityPatch) => void;
}) => {
  const { t, i18n } = useTranslation();
  const [description, setDescription] = useState(locality.description ?? '');

  useEffect(() => {
    setDescription(locality.description ?? '');
  }, [locality.description]);

  const commitDescription = () => {
    const next = description.trim();
    if (next === (locality.description ?? '')) return;
    onPatch({ description: next });
  };

  return (
    <Stack gap={3}>
      <Stack gap={1}>
        <Text fontSize="xs" fontWeight="semibold" color="gray.600">
          {t('localities.workspace.description')}
        </Text>
        <NoteInput
          value={description}
          onChange={setDescription}
          onBlur={commitDescription}
          placeholder={t('localities.workspace.descriptionPlaceholder')}
          rows={3}
          disabled={!isMine}
        />
      </Stack>

      <Stack gap={1}>
        <Text fontSize="xs" fontWeight="semibold" color="gray.600">
          {t('localities.workspace.visibility')}
        </Text>
        <Segmented<LocalityVisibility>
          value={locality.visibility}
          disabled={!isMine}
          onChange={(v) => onPatch({ visibility: v })}
          options={VISIBILITY_ORDER.map((v) => ({
            value: v,
            label: t(`localities.visibility.${v}`),
          }))}
        />
        {locality.visibility === 'limited' && (
          <Text fontSize="xs" color="gray.500">
            {t('localities.visibility.limitedHint')}
          </Text>
        )}
      </Stack>

      <Stack gap={1}>
        {locality.expand?.owner && (
          <Fact
            label={t('localities.workspace.owner')}
            value={locality.expand.owner.name || locality.expand.owner.id}
          />
        )}
        <Fact
          label={t('localities.workspace.created')}
          value={formatDate(locality.created, i18n.language)}
        />
        <Fact
          label={t('localities.workspace.updated')}
          value={formatDate(locality.updated, i18n.language)}
        />
      </Stack>
    </Stack>
  );
};
