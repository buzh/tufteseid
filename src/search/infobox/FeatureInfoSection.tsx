import { useAtomValue } from 'jotai';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  featureInfoLoadingAtom,
  featureInfoResultAtom,
} from '../../map/featureInfo/atoms';
import type {
  FeatureInfoFeature,
  FeatureProperties,
  LayerFeatureInfo,
} from '../../map/featureInfo/types';
import type { FieldConfig } from '../../map/layers/themeLayerConfigApi';
import { Alert, cx, Section, Spinner } from '../../ui';
import styles from './InfoBox.module.css';

type Entry = [string, string | number | boolean | null];

const IMAGE_FIELD_PATTERN = /^bildefil\d*$/i;

const getFieldConfig = (
  fieldName: string,
  fieldConfigs?: FieldConfig[],
): FieldConfig | undefined => {
  return fieldConfigs?.find(
    (fc) => fc.name.toLowerCase() === fieldName.toLowerCase(),
  );
};

const isSpecialField = (
  fieldName: string,
  fieldConfigs?: FieldConfig[],
): boolean => {
  const config = getFieldConfig(fieldName, fieldConfigs);
  return config?.type === 'symbol' || config?.type === 'picture';
};

const getImageFields = (properties: FeatureProperties): string[] => {
  return Object.entries(properties)
    .filter(
      ([key, value]) =>
        IMAGE_FIELD_PATTERN.test(key) &&
        typeof value === 'string' &&
        value.trim() !== '',
    )
    .map(([, value]) => value as string);
};

const ImageGallery = ({
  imageBaseUrl,
  imageFilenames,
}: {
  imageBaseUrl: string;
  imageFilenames: string[];
}) => {
  if (imageFilenames.length === 0) return null;

  return (
    <div className={styles.images}>
      {imageFilenames.map((filename, index) => {
        const imageUrl = `${imageBaseUrl}/${filename}`;
        return (
          <a
            key={index}
            href={imageUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <img src={imageUrl} alt={`Bilde ${index + 1}`} />
          </a>
        );
      })}
    </div>
  );
};

const SymbolGallery = ({
  symbols,
}: {
  symbols: Array<{ url: string; alt: string }>;
}) => {
  if (symbols.length === 0) return null;

  return (
    <div className={styles.symbols}>
      {symbols.map((symbol, index) => (
        <img key={index} src={symbol.url} alt={symbol.alt} title={symbol.alt} />
      ))}
    </div>
  );
};

const getSymbolFields = (
  properties: FeatureProperties,
  fieldConfigs?: FieldConfig[],
): Array<{ url: string; alt: string }> => {
  if (!fieldConfigs) return [];

  const symbols: Array<{ url: string; alt: string }> = [];

  for (const config of fieldConfigs) {
    if (config.type !== 'symbol' || !config.baseurl) continue;

    const value = properties[config.name];
    if (!value || (typeof value === 'string' && value.trim() === '')) continue;

    const filename = config.filetype
      ? `${value}.${config.filetype}`
      : String(value);
    const baseUrl = config.baseurl.endsWith('/')
      ? config.baseurl.slice(0, -1)
      : config.baseurl;
    const url = `${baseUrl}/${filename}`;
    const alt = config.alias || config.name;

    symbols.push({ url, alt });
  }

  return symbols;
};

const formatPropertyValue = (
  value: unknown,
  fieldConfig?: FieldConfig,
): string => {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nei';

  let displayValue: string;
  if (typeof value === 'number') {
    if (fieldConfig?.decimals !== undefined) {
      displayValue = value.toFixed(fieldConfig.decimals);
    } else if (Number.isInteger(value)) {
      displayValue = value.toString();
    } else {
      displayValue = value.toFixed(2);
    }
  } else {
    displayValue = String(value);
  }

  if (fieldConfig?.unit && displayValue !== '-') {
    displayValue = `${displayValue} ${fieldConfig.unit}`;
  }

  return displayValue;
};

const isUrl = (value: string): boolean => {
  return value.startsWith('http://') || value.startsWith('https://');
};

const buildLinkUrl = (
  value: string,
  fieldConfig?: FieldConfig,
): string | null => {
  if (!fieldConfig?.type || fieldConfig.type !== 'link') return null;

  if (isUrl(value)) return value;

  if (!fieldConfig.baseurl || fieldConfig.baseurl.trim() === '') return null;

  const baseUrl = fieldConfig.baseurl.trim().endsWith('/')
    ? fieldConfig.baseurl.trim().slice(0, -1)
    : fieldConfig.baseurl.trim();

  if (baseUrl === '') return isUrl(value) ? value : null;

  return `${baseUrl}/${value}`;
};

const PropertyItem = ({
  name,
  value,
  fieldConfig,
}: {
  name: string;
  value: unknown;
  fieldConfig?: FieldConfig;
}) => {
  const displayName = fieldConfig?.alias || name;
  const displayValue = formatPropertyValue(value, fieldConfig);

  if (name.startsWith('_') && name !== '_html') return null;

  if (name === '_html' && typeof value === 'string') {
    return (
      <Alert tone="warning">
        HTML-respons mottatt. Dette laget returnerer ikke strukturert data.
      </Alert>
    );
  }

  if (
    fieldConfig?.type === 'link' &&
    (typeof value === 'string' || typeof value === 'number') &&
    String(value).trim() !== ''
  ) {
    const linkUrl = buildLinkUrl(String(value), fieldConfig);
    if (linkUrl) {
      return (
        <div className={styles.field}>
          <span className={cx(styles.fieldLabel, styles.small)}>
            {displayName}
          </span>
          <a
            className={cx(styles.link, styles.small)}
            href={linkUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {value}
          </a>
        </div>
      );
    }
  }

  if (isUrl(displayValue)) {
    return (
      <div className={styles.field}>
        <span className={cx(styles.fieldLabel, styles.small)}>
          {displayName}
        </span>
        <a
          className={cx(styles.link, styles.small)}
          href={displayValue}
          target="_blank"
          rel="noopener noreferrer"
        >
          Link
        </a>
      </div>
    );
  }

  return (
    <div className={styles.field}>
      <span className={cx(styles.fieldLabel, styles.small)}>{displayName}</span>
      <span className={styles.small}>{displayValue}</span>
    </div>
  );
};

const FeatureProperties = ({
  feature,
  index,
  imageBaseUrl,
  fieldConfigs,
}: {
  feature: FeatureInfoFeature;
  index: number;
  imageBaseUrl?: string;
  fieldConfigs?: FieldConfig[];
}) => {
  const imageFilenames = imageBaseUrl ? getImageFields(feature.properties) : [];
  const symbols = getSymbolFields(feature.properties, fieldConfigs);

  const allEntries = Object.entries(feature.properties).filter(([key]) => {
    if (key.startsWith('_') && key !== '_html') return false;
    if (imageBaseUrl && IMAGE_FIELD_PATTERN.test(key)) return false;
    if (isSpecialField(key, fieldConfigs)) return false;
    const config = getFieldConfig(key, fieldConfigs);
    if (config?.type === 'picture') return false;
    if (fieldConfigs && !config) return false;
    return true;
  });

  const entryLookup = new Map<string, Entry>(
    allEntries.map(([key, value]) => [
      key.toLowerCase(),
      [key, value] as Entry,
    ]),
  );
  const entries: Entry[] = fieldConfigs
    ? fieldConfigs
        .map((fc) => entryLookup.get(fc.name.toLowerCase()))
        .filter((e): e is Entry => e !== undefined)
    : (allEntries as Entry[]);

  if (
    entries.length === 0 &&
    imageFilenames.length === 0 &&
    symbols.length === 0
  ) {
    return (
      <span className={cx(styles.small, styles.empty)}>Ingen egenskaper</span>
    );
  }

  if (feature.properties._html) {
    return <PropertyItem name="_html" value={feature.properties._html} />;
  }

  return (
    <div>
      {feature.id && (
        <p className={styles.featureId}>Feature ID: {feature.id}</p>
      )}
      {symbols.length > 0 && <SymbolGallery symbols={symbols} />}
      {imageBaseUrl && imageFilenames.length > 0 && (
        <ImageGallery
          imageBaseUrl={imageBaseUrl}
          imageFilenames={imageFilenames}
        />
      )}
      {entries.map(([key, value]) => (
        <PropertyItem
          key={`${index}-${key}`}
          name={key}
          value={value}
          fieldConfig={getFieldConfig(key, fieldConfigs)}
        />
      ))}
    </div>
  );
};

const LayerFeatureInfoSection = ({
  layerInfo,
  open,
  onOpenChange,
}: {
  layerInfo: LayerFeatureInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const featureCount = layerInfo.features.length;

  // The badge carries the count, or the word Feil when the layer failed —
  // `Section` takes either, so the two cases differ only in what goes in it.
  if (layerInfo.error) {
    return (
      <Section
        title={layerInfo.layerTitle}
        count="Feil"
        countPalette="red"
        open={open}
        onOpenChange={onOpenChange}
      >
        <span className={cx(styles.small, styles.error)}>
          {layerInfo.error}
        </span>
      </Section>
    );
  }

  return (
    <Section
      title={layerInfo.layerTitle}
      count={featureCount}
      countPalette="green"
      open={open}
      onOpenChange={onOpenChange}
    >
      {layerInfo.features.map((feature, index) => (
        <div key={index} className={styles.featureGroup}>
          {featureCount > 1 && (
            <p className={styles.featureGroupTitle}>Objekt {index + 1}</p>
          )}
          <FeatureProperties
            feature={feature}
            index={index}
            imageBaseUrl={layerInfo.imageBaseUrl}
            fieldConfigs={layerInfo.fieldConfigs}
          />
        </div>
      ))}
    </Section>
  );
};

export const FeatureInfoSection = ({
  open,
  onOpenChange,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
}) => {
  const { t } = useTranslation();
  const result = useAtomValue(featureInfoResultAtom);
  const loading = useAtomValue(featureInfoLoadingAtom);
  // Which layer within the section is expanded. One at a time, and the first
  // one whenever a new click brings a new set — with several layers under the
  // cursor the list is a menu, not a report to read straight through.
  const [openLayer, setOpenLayer] = useState<string | null>(null);

  const totalFeatures = result
    ? result.layers.reduce((sum, layer) => sum + layer.features.length, 0)
    : 0;

  useEffect(() => {
    setOpenLayer(result?.layers[0]?.layerId ?? null);
    // A single hit is unambiguous, so show it rather than making the user
    // open a section to find out what they clicked.
    if (totalFeatures === 1) {
      onOpenChange(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  if (loading) {
    return (
      <Section
        title={t('featureInfo.title', 'Objektinformasjon')}
        open={open}
        onOpenChange={onOpenChange}
        className={className}
      >
        <div className={styles.loadingRow}>
          <Spinner size={16} />
          <span className={styles.small}>
            {t('featureInfo.loading', 'Henter informasjon...')}
          </span>
        </div>
      </Section>
    );
  }

  if (!result || result.layers.length === 0) {
    return null;
  }

  return (
    <Section
      title={t('featureInfo.title', 'Objektinformasjon')}
      count={totalFeatures}
      countPalette="blue"
      open={open}
      onOpenChange={onOpenChange}
      className={className}
    >
      {result.layers.map((layerInfo) => (
        <LayerFeatureInfoSection
          key={layerInfo.layerId}
          layerInfo={layerInfo}
          open={openLayer === layerInfo.layerId}
          onOpenChange={(isOpen) =>
            setOpenLayer(isOpen ? layerInfo.layerId : null)
          }
        />
      ))}
    </Section>
  );
};
