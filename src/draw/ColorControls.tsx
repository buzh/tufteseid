import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  primaryColorAtom,
  recentColorsAtom,
  secondaryColorAtom,
  selectedFeatureAtom,
} from '../settings/draw/atoms';
import styles from './Draw.module.css';
import { getFeatureType } from './drawControls/drawUtils';
import { useDrawSettings } from './drawControls/hooks/drawSettings';

/*
 * Colour pair for the active tool: the native colour well plus a separate
 * transparency slider, over the swatches of what has been picked before.
 *
 * The well cannot express alpha — `<input type="color">` is six digits by
 * definition — and alpha is not decoration here: fills default to
 * half-transparent so the terrain stays readable under a drawn polygon. So
 * the two halves are edited separately and composed back into the
 * `#rrggbbaa` the OpenLayers styles already take.
 */
export const ColorControls = () => {
  const [primaryColor, setPrimaryColor] = useAtom(primaryColorAtom);
  const [secondaryColor, setSecondaryColor] = useAtom(secondaryColorAtom);
  const [selectedFeature] = useAtom(selectedFeatureAtom);
  const { drawType } = useDrawSettings();
  const { t } = useTranslation();

  const selectedFeatureType = selectedFeature
    ? getFeatureType(selectedFeature)
    : null;

  const currentType = drawType === 'Move' ? selectedFeatureType : drawType;

  const { primaryLabel, secondaryLabel } = useColorLabels(currentType);

  return (
    <div className={styles.group}>
      <span className={styles.groupLabel}>{t('draw.controls.color')}</span>
      <div className={styles.colorGrid}>
        <ColorRow
          label={primaryLabel}
          color={primaryColor}
          onSetColor={setPrimaryColor}
        />
        {secondaryLabel && (
          <ColorRow
            label={secondaryLabel}
            color={secondaryColor}
            onSetColor={setSecondaryColor}
          />
        )}
      </div>
    </div>
  );
};

const ColorRow = ({
  label,
  color,
  onSetColor,
}: {
  label: string;
  color: string;
  onSetColor: (v: string) => void;
}) => {
  const { t } = useTranslation();
  const [recentColors, setRecentColors] = useAtom(recentColorsAtom);
  const { hex, alpha } = splitColor(color);

  // Recorded when the user lets go, not on every frame of a drag — otherwise
  // the strip fills with the colours passed through on the way to the one
  // they wanted.
  const remember = () => setRecentColors((prev) => addRecentColor(prev, color));

  return (
    <div className={styles.colorColumn}>
      <label className={styles.colorHead}>
        <input
          type="color"
          className={styles.swatch}
          value={hex}
          onChange={(e) => onSetColor(joinColor(e.target.value, alpha))}
          onBlur={remember}
        />
        <span className={styles.colorLabel}>{label}</span>
      </label>

      {/* Transparency, not alpha: 0 % is the solid colour. The stored value is
          still the alpha channel the swatch joins onto the hex — only the
          number the user reads is turned round. */}
      <input
        type="range"
        className={styles.opacity}
        min={0}
        max={100}
        value={Math.round(100 - alpha * 100)}
        aria-label={`${label} – ${t('draw.controls.transparency')}`}
        title={`${t('draw.controls.transparency')}: ${Math.round(100 - alpha * 100)} %`}
        onChange={(e) =>
          onSetColor(joinColor(hex, (100 - Number(e.target.value)) / 100))
        }
        onPointerUp={remember}
        onBlur={remember}
      />

      {recentColors.length > 0 && (
        <div className={styles.recents}>
          {recentColors.map((c) => (
            <button
              key={c}
              type="button"
              className={styles.recentSwatch}
              title={c}
              aria-label={`${t('draw.controls.recentColors')}: ${c}`}
              onClick={() => onSetColor(c)}
            >
              <span className={styles.recentFill} style={{ background: c }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/*
 * `#rgb`, `#rrggbb` and `#rrggbbaa` all turn up: the defaults carry alpha,
 * the Text tool writes flat black and white, and the recent-colours list is
 * whatever localStorage held from an earlier version.
 */
const splitColor = (value: string): { hex: string; alpha: number } => {
  const raw = value.trim().replace(/^#/, '');
  const digits =
    raw.length === 3 || raw.length === 4
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  // A colour well rejects anything that isn't `#rrggbb`, so an unparseable
  // string — an `rgba()` left in localStorage by an older build — has to land
  // somewhere rather than make the control render empty.
  if (!/^([0-9a-f]{6}|[0-9a-f]{8})$/i.test(digits)) {
    return { hex: '#000000', alpha: 1 };
  }
  const hex = `#${digits.slice(0, 6)}`;
  const alpha = digits.length === 8 ? parseInt(digits.slice(6), 16) / 255 : 1;
  return { hex, alpha };
};

const joinColor = (hex: string, alpha: number) => {
  const clamped = Math.min(1, Math.max(0, alpha));
  const suffix = Math.round(clamped * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${suffix}`;
};

const addRecentColor = (list: string[], color: string) => {
  const updated = list.filter((c) => c !== color);
  updated.unshift(color);
  return updated.slice(0, 16);
};

const useColorLabels = (drawType: string | null) => {
  const { t } = useTranslation();
  const p = 'draw.controls.';

  switch (drawType) {
    case 'Text':
      return {
        primaryLabel: t(p + 'colorText'),
        secondaryLabel: t(p + 'colorBackground'),
      };
    case 'Point':
      return { primaryLabel: t(p + 'colorPoint'), secondaryLabel: null };
    case 'LineString':
      return { primaryLabel: t(p + 'defaults.primary'), secondaryLabel: null };
    case 'Polygon':
    case 'Circle':
      return {
        primaryLabel: t(p + 'colorStroke'),
        secondaryLabel: t(p + 'colorFill'),
      };
    default:
      return {
        primaryLabel: t(p + 'defaults.primary'),
        secondaryLabel: t(p + 'defaults.secondary'),
      };
  }
};
