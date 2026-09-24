// A tip floating beside the surface it is about, with the reader's way of
// never seeing it again. Mantine's `Popover` does the anchoring, so the target
// need only be something that takes a ref.

import {
  Button,
  Checkbox,
  Group,
  Popover,
  type FloatingPosition,
} from '@mantine/core';
import { useSetAtom } from 'jotai';
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './Hint.module.css';
import { closeHintAtom, useHintOpen, type HintId } from './hints';
import { Icon } from './Icon';

export type HintProps = {
  id: HintId;
  /** One line each, already filtered to what applies here. Empty: no tip. */
  tips: string[];
  position?: FloatingPosition;
  children: ReactElement;
};

export const Hint = ({
  id,
  tips,
  position = 'left-start',
  children,
}: HintProps) => {
  const { t } = useTranslation();
  const open = useHintOpen(id);
  const close = useSetAtom(closeHintAtom);
  const [forever, setForever] = useState(false);

  // Wrapped even when there is no tip to show: `Popover.Target` clones its
  // child, so taking the wrapper away would remount the surface underneath and
  // lose whatever state it holds.
  return (
    <Popover
      opened={open && tips.length > 0}
      onChange={(next) => {
        if (!next) close(id, forever);
      }}
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
