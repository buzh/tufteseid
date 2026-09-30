import {
  Badge,
  Group,
  Menu,
  ScrollArea,
  SegmentedControl,
  Text,
  TextInput,
} from '@mantine/core';
import { useAtomValue, useSetAtom } from 'jotai';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { SpotRecord } from '../api/spots';
import { isAuthDialogOpenAtom, isSignedInAtom } from '../auth/atoms';
import { activeSpotAtom, spotDraftAtom, spotPlacingAtom } from '../spots/atoms';
import { isoDay } from '../shared/utils/isoDay';
import { mySpotsAtom, spotsFailedAtom } from '../spots/spotRecords';
import { popularSpotsAtom, spotScoresAtom } from '../spots/spotScores';
import { ControlChip } from '../ui/ControlChip';
import { Icon } from '../ui/Icon';
import styles from './SpotMenu.module.css';

/** How many rows before the list gets a filter over it. */
const FILTER_FROM = 8;

const LIST_MAX_HEIGHT = 340;

type Tab = 'mine' | 'popular';

export const SpotMenu = () => {
  const { t } = useTranslation();
  const signedIn = useAtomValue(isSignedInAtom);
  const mine = useAtomValue(mySpotsAtom);
  const popular = useAtomValue(popularSpotsAtom);
  const scores = useAtomValue(spotScoresAtom);
  const failed = useAtomValue(spotsFailedAtom);
  const active = useAtomValue(activeSpotAtom);
  const draft = useAtomValue(spotDraftAtom);
  const placing = useAtomValue(spotPlacingAtom);
  const setActive = useSetAtom(activeSpotAtom);
  const openAuthDialog = useSetAtom(isAuthDialogOpenAtom);

  const [opened, setOpened] = useState(false);
  const [tab, setTab] = useState<Tab>('popular');
  const [query, setQuery] = useState('');

  // The ranking needs no account, so the menu opens for a guest too.
  const spots = tab === 'mine' ? mine : popular;

  const needle = query.trim().toLowerCase();
  const filtered = !needle
    ? spots
    : (spots?.filter((spot) =>
        [spot.name, spot.description].some((field) =>
          field.toLowerCase().includes(needle),
        ),
      ) ?? null);

  const drafting = draft != null || placing;

  const title = drafting
    ? t('spots.list.busy')
    : signedIn && mine
      ? // `total`, not `count`: i18next reads `count` as a request for
        // plural forms this key has none of.
        t('spots.mine.count', { total: mine.length })
      : t('spots.list.label');

  const row = (spot: SpotRecord) => {
    const open = spot.id === active?.id;
    // Absent from the view means nobody has voted, not an unknown tally.
    const score = scores?.get(spot.id)?.score ?? 0;
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
          {tab === 'popular' ? (
            <Badge
              size="xs"
              variant="light"
              color={score < 0 ? 'gray' : undefined}
              leftSection={<Icon icon="thumb_up" size={10} />}
            >
              {score}
            </Badge>
          ) : (
            spot.visibility === 'public' && (
              <Badge size="xs" variant="light">
                {t('spots.public')}
              </Badge>
            )
          )}
        </Group>
        <Text size="xs" c="dimmed">
          {isoDay(spot.updated)}
        </Text>
      </Menu.Item>
    );
  };

  return (
    <Menu
      opened={opened}
      onChange={(next) => {
        if (next && drafting) return;
        if (next) setTab(signedIn ? 'mine' : 'popular');
        if (!next) setQuery('');
        setOpened(next);
      }}
      width={300}
      position="bottom-end"
    >
      <Menu.Target>
        <ControlChip dimmed={drafting} title={title} aria-label={title} />
      </Menu.Target>
      <Menu.Dropdown>
        <SegmentedControl
          fullWidth
          size="xs"
          mb={6}
          value={tab}
          onChange={(next) => {
            setTab(next as Tab);
            setQuery('');
          }}
          data={[
            { value: 'mine', label: t('spots.list.tabMine') },
            { value: 'popular', label: t('spots.list.tabPopular') },
          ]}
        />

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

        {tab === 'mine' && !signedIn ? (
          <Menu.Item
            leftSection={<Icon icon="login" size={18} />}
            onClick={() => openAuthDialog(true)}
          >
            {t('spots.mine.needsAccount')}
          </Menu.Item>
        ) : (
          <>
            {failed && (
              <Menu.Item
                disabled
                leftSection={<Icon icon="warning" size={18} />}
              >
                {t(tab === 'mine' ? 'spots.mine.failed' : 'spots.list.failed')}
              </Menu.Item>
            )}
            {!failed && spots == null && (
              <Menu.Item disabled>{t('spots.mine.loading')}</Menu.Item>
            )}
            {spots?.length === 0 && (
              <Menu.Item disabled className={styles.empty}>
                {t(tab === 'mine' ? 'spots.mine.empty' : 'spots.list.empty')}
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
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
};
