// Mine lokaliteter: the index the map could not give.
//
// A pin is where it is, which is the one way of finding a spot that requires
// already knowing the ground it is on. This is the other way — every record the
// reader has written, newest change first, and one click flies the map to it
// and opens its card. That last part is nothing this component does: it writes
// `activeSpotAtom`, and the mover behind the short link (`shareLink.ts`) is
// what animates the view, so a spot opened from here, from a click on its pin
// and from a followed link all arrive the same way.
//
// Their own, not everything the session may see. The map draws other people's
// public pins as well, and they are worth looking at where they are — but an
// index is a list of what you are answerable for, and a gazetteer of strangers'
// records under the heading "mine" is a different surface.
//
// A `Menu` rather than the `Popover` the Kulturminner chevron opens: every row
// in here is a transaction that ends the visit, where every row in that one is
// a setting the reader leaves set. Closing on the first click is exactly right
// for the first and exactly wrong for the second.
//
// Nothing on the chip but the chevron, same as that one and for the same
// reason: it shares a box with the `+`, a glyph an eighth of an inch from
// another glyph reads as a second subject, and a count in it would change the
// width of the band every time a spot was saved. The heading inside names it
// and the `title` carries the count.

import { Badge, Group, Menu, ScrollArea, Text, TextInput } from '@mantine/core';
import { useAtomValue, useSetAtom } from 'jotai';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { SpotRecord } from '../api/spots';
import { isAuthDialogOpenAtom, isSignedInAtom } from '../auth/atoms';
import { activeSpotAtom, spotDraftAtom } from '../spots/atoms';
import { mySpotsAtom, spotsFailedAtom } from '../spots/spotRecords';
import { ControlChip } from '../ui/ControlChip';
import { Icon } from '../ui/Icon';
import styles from './SpotMenu.module.css';

/**
 * How many rows before the list gets a filter over it. A box above five rows
 * is furniture; above twenty it is the only way through. The threshold is where
 * a reader stops being able to see the whole list at once.
 */
const FILTER_FROM = 8;

/** As tall as the dataset menu's list, for the same reason: past this the
 *  dropdown is taller than the map it is standing on. */
const LIST_MAX_HEIGHT = 340;

/** The day it last changed. No clock: what this separates is one field trip
 *  from another, and two spots written an hour apart are the same visit. */
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

  // Deaf while a draft is open, for the reason the map's own click handler is:
  // the pin is being placed, and a row in here would move the map off it and
  // open a card the draft box is standing in front of. Dimmed and inert rather
  // than gone — the boxes in this row must not move under a cursor that is
  // about to press the `+` beside it.
  const drafting = draft != null;

  const title = !signedIn
    ? t('spots.mine.needsAccount')
    : drafting
      ? t('spots.mine.busy')
      : spots
        ? // `total` rather than `count`, which i18next reads as a request for
          // plural forms this key has none of.
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
          {/* `miw` so the name can be ellipsised: a flex item is as wide as
              its content unless it is told it may be narrower, and a name is
              allowed 200 characters. */}
          <Text size="sm" truncate miw={0}>
            {spot.name}
          </Text>
          {/* Only the public ones carry a badge: private is what a spot is
              unless it was given away, so saying it on every row would be
              saying nothing on every row. */}
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
        // Signed out the chevron is honest about what is behind it: there is no
        // list without an account, and the dialog is both the answer and the
        // way to get one — the same thing the `+` beside it does.
        if (next && !signedIn) {
          openAuthDialog(true);
          return;
        }
        if (next && drafting) return;
        // A filter left behind is a list that opens short for no visible
        // reason — the field only stands while there are rows enough to need
        // it, and a deletion can take that away with the text still in it.
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

        {/* Only once the list is longer than a glance. The field is inside the
            dropdown rather than in the band: what it filters is in here, and a
            search box in the row would be the app's search box, which this is
            not. */}
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
