import { useAtom, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  drawTypeAtom,
  primaryColorAtom,
  secondaryColorAtom,
} from '../settings/draw/atoms';
import { cx, Icon, type MaterialSymbol } from '../ui';
import styles from './Draw.module.css';
import { DrawType } from './drawControls/hooks/drawSettings';

export const DrawToolSelector = () => {
  const { t } = useTranslation();
  const drawTypeButtons: {
    value: DrawType;
    icon: MaterialSymbol;
    label: string;
  }[] = [
    {
      value: 'LineString',
      icon: 'diagonal_line',
      label: t('draw.controls.tool.label.linestring'),
    },
    {
      value: 'Polygon',
      icon: 'pentagon',
      label: t('draw.controls.tool.label.polygon'),
    },
    {
      value: 'Point',
      icon: 'atr',
      label: t('draw.controls.tool.label.point'),
    },
    {
      value: 'Circle',
      icon: 'circle',
      label: t('draw.controls.tool.label.circle'),
    },
    {
      value: 'Text',
      icon: 'text_fields',
      label: t('draw.controls.tool.label.text'),
    },
    {
      value: 'Move',
      icon: 'arrow_selector_tool',
      label: t('draw.controls.tool.label.edit'),
    },
  ];
  return (
    <div className={styles.tools}>
      {drawTypeButtons.map((button) => (
        <DrawTypeButton
          key={button.value}
          type={button.value}
          icon={button.icon}
          label={button.label}
        />
      ))}
    </div>
  );
};

// Icon over label rather than a `Segmented` row: six tools with names do not
// fit across the 320px the draft row gives the drawing column, and the name
// is what tells a first-time user what the glyph is for.
const DrawTypeButton = ({
  type,
  icon,
  label,
}: {
  type: DrawType;
  icon: MaterialSymbol;
  label: string;
}) => {
  const [drawType, setDrawType] = useAtom(drawTypeAtom);
  const isCurrentTool = drawType === type;

  const setPrimaryColor = useSetAtom(primaryColorAtom);
  const setSecondaryColor = useSetAtom(secondaryColorAtom);

  return (
    <button
      type="button"
      aria-pressed={isCurrentTool}
      className={cx(styles.tool, isCurrentTool && styles.toolActive)}
      onClick={() => {
        if (isCurrentTool) {
          return;
        }

        // Text on the map is read against the terrain under it, so it starts
        // black on white rather than inheriting the line colours.
        if (type === 'Text') {
          setPrimaryColor('#000000ff');
          setSecondaryColor('#ffffffff');
        }
        setDrawType(type);
      }}
    >
      <Icon icon={icon} filled size={20} />
      <span className={styles.toolLabel}>{label}</span>
    </button>
  );
};
