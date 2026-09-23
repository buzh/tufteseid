import { Menu, Text } from '@mantine/core';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KART_VARIANTS,
  type KartVariant,
} from '../map/layers/config/backgroundLayers/kartVariants';
import { ControlChip } from '../ui/ControlChip';
import { Icon, type MaterialSymbol } from '../ui/Icon';
import type { KartControls } from './useKartControls';

const VARIANT_ICON: Record<KartVariant, MaterialSymbol> = {
  topo: 'map',
  topograatone: 'filter_b_and_w',
  toporaster: 'image',
  sjokartraster: 'sailing',
  amtskart: 'history_edu',
};

export const KartControlGroup = ({ kart }: { kart: KartControls }) => {
  const { t } = useTranslation();
  const { active, activate } = kart;

  const label = t(`kartControls.variant.${active}`);
  const title = t('kartControls.chipTitle', {
    variant: label,
    hint: t(`kartControls.meta.${active}`),
  });

  return (
    <Menu width={320}>
      <Menu.Target>
        <ControlChip
          icon={VARIANT_ICON[active]}
          label={label}
          title={title}
          aria-label={title}
        />
      </Menu.Target>
      <Menu.Dropdown>
        {KART_VARIANTS.map((variant) => (
          <Fragment key={variant}>
            {variant === 'amtskart' && (
              <>
                <Menu.Divider />
                <Text size="xs" c="dimmed" px="sm" py={4}>
                  {t('kartControls.historicHint')}
                </Text>
              </>
            )}
            <Menu.Item
              onClick={() => activate(variant)}
              leftSection={<Icon icon={VARIANT_ICON[variant]} size={18} />}
              rightSection={
                variant === active ? <Icon icon="check" size={18} /> : undefined
              }
            >
              <Text size="sm">{t(`kartControls.variant.${variant}`)}</Text>
              <Text size="xs" c="dimmed">
                {t(`kartControls.meta.${variant}`)}
              </Text>
            </Menu.Item>
          </Fragment>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
};
