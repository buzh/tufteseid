// The reader's own spots. A row writes `activeSpotAtom` and nothing else; the
// mover behind the short link (`shareLink.ts`) animates the view.

import { Badge, Group, Menu, ScrollArea, Text, TextInput } from '@mantine/core';
import { useAtomValue, useSetAtom } from 'jotai';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { SpotRecord } from '../api/spots';
import { isAuthDialogOpenAtom, isSignedInAtom } from '../auth/atoms';
import { activeSpotAtom, spotDraftAtom, spotPlacingAtom } from '../spots/atoms';
import { mySpotsAtom, spotsFailedAtom } from '../spots/spotRecords';
import { ControlChip } from '../ui/ControlChip';
import { Icon } from '../ui/Icon';
import styles from './SpotMenu.module.css';

/** How many rows before the list gets a filter over it. */
const FILTER_FROM = 8;

const LIST_MAX_HEIGHT = 340;

const changedOn = (iso: string, language: string): string =>
  new Date(iso).toLocaleDateString(language, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

export const SpotMenu = () => {
  const { t, i18n } = useTranslation();
  const signedIn = useAtomValue(isSignedInAtom);
  const spots = useAtomValue(mySpotsAtom);
  const failed = useAtomValue(spotsFailedAtom);
  const active = useAtomValue(activeSpotAtom);
  const draft = useAtomValue(spotDraftAtom);
  const placing = useAtomValue(spotPlacingAtom);
  const setActive = useSetAtom(activeSpotAtom);
  const openAuthDialog = useSetAtom(isAuthDialogOpenAtom);

  const [opened, setOpened] = useState(false);
  const [query, setQuery] = useState('');

  const needle = query.trim().toLowerCase();
  const filtered = !needle
    ? spots
    : (spots?.filter((spot) =>
        [spot.name, spot.description].some((field) =>
          field.toLowerCase().includes(needle),
        ),
      ) ?? null);

  const drafting = draft != null || placing;

  const title = !signedIn
    ? t('spots.mine.needsAccount')
    : drafting
      ? t('spots.mine.busy')
      : spots
        ? // `total`, not `count`: i18next reads `count` as a request for plural
          // forms this key has none of.
          t('spots.mine.count', { total: spots.length })
        : t('spots.mine.label');

  const row = (spot: SpotRecord) => {
    const open = spot.id === active?.id;
    return (
      <Menu.Item
        key={spot.id}
        onClick={() => setActive(spot)}
        leftSection={
          open ? (
            <Icon icon="check" size={18} />
          ) : (
            <span className={styles.gutter} />
          )
        }
      >
        <Group gap="xs" wrap="nowrap" justify="space-between">
          {/* `miw={0}` so the name can be ellipsised: a flex item is as wide
              as its content unless told it may be narrower. */}
          <Text size="sm" truncate miw={0}>
            {spot.name}
          </Text>
          {spot.visibility === 'public' && (
            <Badge size="xs" variant="light">
              {t('spots.public')}
            </Badge>
          )}
        </Group>
        <Text size="xs" c="dimmed">
          {changedOn(spot.updated, i18n.language)}
        </Text>
      </Menu.Item>
    );
  };

  return (
    <Menu
      opened={opened}
      onChange={(next) => {
        if (next && !signedIn) {
          openAuthDialog(true);
          return;
        }
        if (next && drafting) return;
        if (!next) setQuery('');
        setOpened(next);
      }}
      width={300}
      position="bottom-end"
    >
      <Menu.Target>
        <ControlChip
          dimmed={!signedIn || drafting}
          title={title}
          aria-label={title}
        />
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{t('spots.mine.label')}</Menu.Label>

        {(spots?.length ?? 0) > FILTER_FROM && (
          <TextInput
            size="xs"
            mx="xs"
            mb={6}
            value={query}
            placeholder={t('spots.mine.filterPlaceholder')}
            aria-label={t('spots.mine.filterPlaceholder')}
            leftSection={<Icon icon="search" size={16} />}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        )}

        {failed && (
          <Menu.Item disabled leftSection={<Icon icon="warning" size={18} />}>
            {t('spots.mine.failed')}
          </Menu.Item>
        )}
        {!failed && spots == null && (
          <Menu.Item disabled>{t('spots.mine.loading')}</Menu.Item>
        )}
        {spots?.length === 0 && (
          <Menu.Item disabled className={styles.empty}>
            {t('spots.mine.empty')}
          </Menu.Item>
        )}
        {needle && filtered?.length === 0 && (
          <Menu.Item disabled>
            {t('spots.mine.noMatch', { query: query.trim() })}
          </Menu.Item>
        )}

        <ScrollArea.Autosize mah={LIST_MAX_HEIGHT} type="scroll">
          {filtered?.map(row)}
        </ScrollArea.Autosize>
      </Menu.Dropdown>
    </Menu>
  );
};
