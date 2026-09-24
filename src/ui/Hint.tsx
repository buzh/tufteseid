import {
  Button,
  Checkbox,
  Group,
  Popover,
  type FloatingPosition,
} from '@mantine/core';
import { useSetAtom } from 'jotai';
import { useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './Hint.module.css';
import {
  closeHintAtom,
  TYPING_SURFACE,
  useHintOpen,
  type HintId,
} from './hints';
import { Icon } from './Icon';

// Arrows walking a focused slider are not the reader pressing a watched key.
const EXEMPT = `${TYPING_SURFACE}, [role="slider"]`;

export type HintProps = {
  id: HintId;
  /** One line each, already filtered to what applies here. Empty: no tip. */
  tips: string[];
  /** `KeyboardEvent.key` values. Pressing one takes the tip down. */
  keys?: string[];
  position?: FloatingPosition;
  children: ReactElement;
};

export const Hint = ({
  id,
  tips,
  keys = [],
  position = 'left-start',
  children,
}: HintProps) => {
  const { t } = useTranslation();
  const open = useHintOpen(id);
  const close = useSetAtom(closeHintAtom);
  const [forever, setForever] = useState(false);

  const opened = open && tips.length > 0;

  // Joined rather than passed as the array it is: a caller builds the list
  // inline, so a fresh one every render would re-bind the listener every
  // render.
  const watched = keys.join(' ');
  useEffect(() => {
    if (!opened || !watched) return;
    const wanted = watched.split(' ');
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(EXEMPT)) return;
      // A letter key arrives capitalised under shift; the named ones never do.
      const pressed =
        event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (wanted.includes(pressed)) close(id, forever);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [opened, watched, close, id, forever]);

  // Wrapped even when there is no tip to show: `Popover.Target` clones its
  // child, so taking the wrapper away would remount the surface underneath and
  // lose whatever state it holds.
  return (
    <Popover
      opened={opened}
      onChange={(next) => {
        if (!next) close(id, forever);
      }}
      // Mantine's click-outside fires on `mousedown`, so the first frame of a
      // pan would otherwise take the tip off the screen before it was read.
      closeOnClickOutside={false}
      position={position}
      width={260}
      shadow="md"
      withArrow
    >
      <Popover.Target>{children}</Popover.Target>
      <Popover.Dropdown className={styles.dropdown}>
        <div className={styles.head}>
          <Icon icon="lightbulb" size={14} />
          {t('hints.title')}
        </div>

        <ul className={styles.tips}>
          {tips.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>

        <Group gap="xs" justify="space-between" wrap="nowrap">
          <Checkbox
            size="xs"
            label={t('hints.never')}
            checked={forever}
            onChange={(event) => setForever(event.currentTarget.checked)}
          />
          <Button
            size="xs"
            variant="default"
            onClick={() => close(id, forever)}
          >
            {t('hints.close')}
          </Button>
        </Group>
      </Popover.Dropdown>
    </Popover>
  );
};
