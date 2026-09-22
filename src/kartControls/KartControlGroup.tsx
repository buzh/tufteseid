// The Kart arm: one chip, because Kart has one axis. Which of Kartverket's
// cartographies — or the amtskart series from before them — is drawing.
//
// Modelled on the LiDAR row's render menu rather than on its dataset menu:
// there is nothing to fetch, nothing to rank against the viewport and nothing
// for Automatisk to overrule, so every row is on offer at every zoom and the
// chip is never dimmed. The full name is on the chip here, not just a glyph —
// "Gråtone" is short, and unlike a render the map itself does not obviously say
// which of the four cartographies you are looking at.
//
// Amtskart is set off below a rule because it is not a fifth cartography of the
// same landscape: it is a different century's reading of it, and a reader who
// picks it by accident sees a map with no Nordland and wonders what broke. The
// rule's position comes from `KART_VARIANTS`, so the list cannot drift from the
// order the ring is declared in.

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

// What each variant is, in one glyph: the ordinary map, the same map drained of
// colour, the scanned sheet, the coast read for depth, and a document.
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
                {/* A Text rather than a Menu.Label: this is a sentence, and a
                    label is styled for two words on one line. */}
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
