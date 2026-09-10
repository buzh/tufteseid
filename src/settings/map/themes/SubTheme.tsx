import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  WARNING_THRESHOLD,
  useThemeLayers,
} from '../../../map/layers/themeLayers';
import { ThemeLayerName } from '../../../map/layers/themeWMS';
import { Section, Switch, Tooltip } from '../../../ui';
import styles from './MapThemes.module.css';
import { SubTheme, ThemeLayer } from './types';

export const SubThemeSection = ({
  subTheme,
  toggleLayer,
  defaultOpen = false,
}: {
  subTheme: SubTheme;
  toggleLayer: (layerName: ThemeLayerName) => void;
  defaultOpen?: boolean;
}) => {
  const { activeLayerSet, addThemeLayerToMap, removeThemeLayerFromMap } =
    useThemeLayers();
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);

  const activeCount = activeLayerSet.size;
  const isLayerChecked = (layerName: ThemeLayerName) =>
    activeLayerSet.has(layerName);
  const isDisabled = (layerName: ThemeLayerName) =>
    !isLayerChecked(layerName) && activeCount >= WARNING_THRESHOLD;

  const activeInSubTheme = subTheme.layers.filter((layer) =>
    isLayerChecked(layer.name),
  ).length;
  const totalInSubTheme = subTheme.layers.length;

  // A subtheme with one layer is just that layer — a disclosure around a
  // single switch is a click for nothing.
  if (totalInSubTheme === 1) {
    return (
      <LayerLine
        toggleLayer={toggleLayer}
        layer={subTheme.layers[0]}
        checked={isLayerChecked(subTheme.layers[0].name)}
        disabled={isDisabled(subTheme.layers[0].name)}
      />
    );
  }

  const allOn = activeInSubTheme === totalInSubTheme;

  return (
    <Section
      title={subTheme.heading}
      open={open}
      onOpenChange={setOpen}
      count={
        activeInSubTheme > 0 ? `${activeInSubTheme}/${totalInSubTheme}` : null
      }
      countPalette="green"
      bodyClassName={styles.layers}
      action={
        subTheme.disableToggleAll ? undefined : (
          <Tooltip
            label={
              allOn
                ? t('map.settings.layers.theme.subtheme.toggleall.removeall')
                : t('map.settings.layers.theme.subtheme.toggleall.addall')
            }
          >
            <Switch
              checked={allOn}
              onChange={(checked) => {
                if (checked) {
                  addThemeLayerToMap(subTheme.layers.map((l) => l.name));
                } else {
                  removeThemeLayerFromMap(subTheme.layers.map((l) => l.name));
                }
              }}
            />
          </Tooltip>
        )
      }
    >
      {subTheme.layers.map((layer) => (
        <LayerLine
          key={layer.name}
          toggleLayer={toggleLayer}
          layer={layer}
          checked={isLayerChecked(layer.name)}
          disabled={isDisabled(layer.name)}
        />
      ))}
    </Section>
  );
};

// Label left, switch right — the switch's own <label> spans the row, so the
// whole line is the hit target without a second click handler on a wrapper.
export const LayerLine = ({
  toggleLayer,
  layer,
  checked,
  disabled,
}: {
  toggleLayer: (layerName: ThemeLayerName) => void;
  layer: ThemeLayer;
  checked: boolean;
  disabled: boolean;
}) => (
  <div className={styles.layer}>
    <Switch
      className={styles.layerSwitch}
      checked={checked}
      disabled={disabled}
      onChange={() => toggleLayer(layer.name)}
      label={layer.label}
    />
  </div>
);
