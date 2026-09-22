// The head of the control row: which ground is being read, and the way to
// another one.
//
// It stands where the wordmark used to, and does that job better — the band
// already had to say which ring the controls belonged to, and a chip that says
// it can also change it. Everything after it in the row belongs to the ground
// named here, which is why it is first and why there is exactly one of it.
//
// Three rows and no more. A ground is not a layer: what Kart *means* is the
// variant menu beside this, what LiDAR means is four controls, and folding
// those members in here would make one menu of thirty rows out of a choice the
// reader makes in two steps.

import { Menu, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { ControlChip } from '../ui/ControlChip';
import { Icon, type MaterialSymbol } from '../ui/Icon';
import {
  GROUND_MODES,
  type GroundControls,
  type GroundMode,
} from './useGroundControls';

// What each ground is a picture of, rather than what service draws it: the
// landform, the map of it, the photograph of it.
const GROUND_ICON: Record<GroundMode, MaterialSymbol> = {
  lidar: 'landscape',
  kart: 'map',
  flyfoto: 'photo_camera',
};

export const GroundMenu = ({ ground }: { ground: GroundControls }) => {
  const { t } = useTranslation();
  const { mode, select } = ground;

  // `?backgroundLayer=empty` is a ground nobody is on. Saying so and offering
  // the three is better than pretending one of them is drawing.
  const label = mode ? t(`grounds.${mode}.name`) : t('grounds.none');
  const title = mode
    ? t('grounds.chipTitle', {
        ground: label,
        hint: t(`grounds.${mode}.hint`),
      })
    : t('grounds.noneHint');

  return (
    <Menu width={300}>
      <Menu.Target>
        <ControlChip
          icon={mode ? GROUND_ICON[mode] : 'layers_clear'}
          label={label}
          title={title}
          aria-label={title}
        />
      </Menu.Target>
      <Menu.Dropdown>
        {GROUND_MODES.map((candidate) => (
          <Menu.Item
            key={candidate}
            onClick={() => select(candidate)}
            leftSection={<Icon icon={GROUND_ICON[candidate]} size={18} />}
            rightSection={
              candidate === mode ? <Icon icon="check" size={18} /> : undefined
            }
          >
            <Text size="sm">{t(`grounds.${candidate}.name`)}</Text>
            <Text size="xs" c="dimmed">
              {t(`grounds.${candidate}.hint`)}
            </Text>
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
};
