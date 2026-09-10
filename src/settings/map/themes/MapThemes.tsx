import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getDirectLayersForCategory,
  getMainCategories,
  getSubcategories,
  themeLayerConfig,
} from '../../../map/layers/themeLayerConfigApi';
import {
  WARNING_THRESHOLD,
  useThemeLayers,
} from '../../../map/layers/themeLayers';
import { ThemeLayerName } from '../../../map/layers/themeWMS';
import { Alert, Section } from '../../../ui';
import styles from './MapThemes.module.css';
import { LayerLine, SubThemeSection } from './SubTheme';
import { SubTheme, Theme } from './types';

export const MapThemes = () => {
  const { activeLayerSet, addThemeLayerToMap, removeThemeLayerFromMap } =
    useThemeLayers();
  const { t, i18n } = useTranslation();

  const activeCount = activeLayerSet.size;
  const showLimitWarning = activeCount >= WARNING_THRESHOLD;

  const [expandedItems, setExpandedItems] = useState<string[]>([]);

  const isLayerChecked = useCallback(
    (layerName: ThemeLayerName): boolean => {
      return activeLayerSet.has(layerName);
    },
    [activeLayerSet],
  );

  const configThemeLayers = useMemo((): Theme[] => {
    const currentLang = i18n.language as 'nb' | 'nn' | 'en';
    const mainCategories = getMainCategories(themeLayerConfig);
    const result: Theme[] = [];

    mainCategories.forEach((mainCategory) => {
      const subcategories = getSubcategories(themeLayerConfig, mainCategory.id);
      const directLayers = getDirectLayersForCategory(
        themeLayerConfig,
        mainCategory.id,
      ).map((layer) => ({
        name: layer.id as ThemeLayerName,
        label: layer.name[currentLang] || layer.name.nb,
      }));

      if (subcategories.length > 0) {
        const subThemes: SubTheme[] = subcategories.map((subCategory) => {
          const layers = themeLayerConfig.layers.filter(
            (layer) => layer.categoryId === subCategory.id,
          );
          return {
            name: subCategory.id,
            heading: subCategory.name[currentLang] || subCategory.name.nb,
            layers: layers.map((layer) => ({
              name: layer.id as ThemeLayerName,
              label: layer.name[currentLang] || layer.name.nb,
            })),
          };
        });

        result.push({
          name: mainCategory.id,
          heading: mainCategory.name[currentLang] || mainCategory.name.nb,
          subThemes,
          directLayers,
        });
      } else {
        result.push({
          name: mainCategory.id,
          heading: mainCategory.name[currentLang] || mainCategory.name.nb,
          subThemes: [],
          directLayers,
        });
      }
    });

    return result;
  }, [i18n.language]);

  const getActiveCategoryCount = useCallback(
    (theme: Theme): number => {
      return theme.subThemes.reduce((count, subTheme) => {
        return (
          count +
          subTheme.layers.filter((layer) => isLayerChecked(layer.name)).length
        );
      }, 0);
    },
    [isLayerChecked],
  );

  const getTotalCategoryLayers = useCallback((theme: Theme): number => {
    return theme.subThemes.reduce((count, subTheme) => {
      return count + subTheme.layers.length;
    }, 0);
  }, []);

  const toggleLayer = useCallback(
    (layerName: ThemeLayerName) => {
      if (isLayerChecked(layerName)) {
        removeThemeLayerFromMap(layerName);
      } else {
        addThemeLayerToMap(layerName);
      }
    },
    [addThemeLayerToMap, removeThemeLayerFromMap, isLayerChecked],
  );

  const toggleExpanded = useCallback((name: string) => {
    setExpandedItems((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }, []);

  return (
    <div className={styles.root}>
      {showLimitWarning && (
        <Alert tone="info">
          {t('map.settings.layers.theme.warningPerformance')}
        </Alert>
      )}

      {configThemeLayers.map((theme) => {
        const activeInCategory = getActiveCategoryCount(theme);
        const totalInCategory = getTotalCategoryLayers(theme);
        const defaultOpen =
          theme.subThemes.length === 1 && theme.directLayers.length === 0;

        return (
          <Section
            key={theme.name}
            title={theme.heading}
            open={expandedItems.includes(theme.name)}
            onOpenChange={() => toggleExpanded(theme.name)}
            count={
              activeInCategory > 0
                ? `${activeInCategory}/${totalInCategory}`
                : null
            }
            countPalette="green"
            className={styles.theme}
            bodyClassName={styles.themeBody}
          >
            {theme.subThemes.map((subTheme) => (
              <SubThemeSection
                key={subTheme.name}
                subTheme={subTheme}
                toggleLayer={toggleLayer}
                defaultOpen={defaultOpen}
              />
            ))}
            {theme.directLayers.map((layer) => (
              <LayerLine
                key={layer.name}
                toggleLayer={toggleLayer}
                layer={layer}
                checked={isLayerChecked(layer.name)}
                disabled={
                  !isLayerChecked(layer.name) &&
                  activeCount >= WARNING_THRESHOLD
                }
              />
            ))}
          </Section>
        );
      })}
    </div>
  );
};
