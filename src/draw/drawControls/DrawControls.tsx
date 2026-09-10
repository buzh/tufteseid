import { useAtom } from 'jotai';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  clearInteractions,
  drawEnabledEffect,
  drawTypeEffect,
  selectedFeatureAtom,
  snapEffect,
} from '../../settings/draw/atoms.ts';
import { useIsMobileScreen } from '../../shared/hooks.ts';
import { Button, ConfirmPopover, cx } from '../../ui';
import { ColorControls } from '../ColorControls.tsx';
import styles from '../Draw.module.css';
import { DrawToolSelector } from '../DrawToolSelector.tsx';
import {
  drawStyleEffect,
  editPointIconEffect,
  editPrimaryColorEffect,
  editSecondaryColorEffect,
  editTextEffect,
  lineWidthEffect,
} from '../effects.ts';
import { LineStyleControl } from '../LineStyleControl.tsx';
import { LineWidthControl } from '../LineWidthControl.tsx';
import { MeasurementControls } from '../MeasurementControls.tsx';
import { PointStyleSelector } from '../PointStyleSelector.tsx';
import { TextStyleControl } from '../TextStyleControl.tsx';
import { useDrawControlsKeyboardEffects } from './drawControlsKeyboardEffects.ts';
import { getFeatureType } from './drawUtils.ts';
import { EditControls } from './EditControls.tsx';
import { DrawType, useDrawSettings } from './hooks/drawSettings.ts';

const MEASUREMENT_TYPES: DrawType[] = [
  'LineString',
  'Polygon',
  'Circle',
  'Move',
];

export const DrawControls = () => {
  const { drawType, clearDrawing } = useDrawSettings();
  const [selectedFeature] = useAtom(selectedFeatureAtom);
  const isMobile = useIsMobileScreen();
  const { t } = useTranslation();
  useAtom(drawEnabledEffect);
  useAtom(drawTypeEffect);
  useAtom(snapEffect);
  useAtom(drawStyleEffect);
  useAtom(editPrimaryColorEffect);
  useAtom(editSecondaryColorEffect);
  useAtom(lineWidthEffect);
  useAtom(editTextEffect);
  useAtom(editPointIconEffect);

  useDrawControlsKeyboardEffects();
  useEffect(() => {
    return () => {
      clearInteractions();
    };
  }, []);

  const selectedFeatureType = selectedFeature
    ? getFeatureType(selectedFeature)
    : null;

  const currentType = drawType === 'Move' ? selectedFeatureType : drawType;

  const showMeasurementControls =
    drawType !== 'Move' &&
    currentType != null &&
    MEASUREMENT_TYPES.includes(currentType);

  return (
    <div className={cx(styles.controls, isMobile && styles.mobileReserve)}>
      {/* On a phone the same strip is pinned to the bottom edge, within
          thumb reach — see BottomDrawToolSelector. */}
      {!isMobile && <DrawToolSelector />}

      {drawType === 'Move' && !selectedFeature && (
        <p className={styles.instruction}>
          {t('draw.controls.editInstruction')}
        </p>
      )}

      {currentType === 'Text' && <TextStyleControl />}

      <div className={styles.row}>
        {currentType && <ColorControls />}
        {currentType === 'Point' && <PointStyleSelector />}
      </div>

      {/* Line style, width and the measurement toggle wrap against each
          other rather than switching layout at a breakpoint: which of them
          are on screen depends on the active tool. */}
      <div className={styles.row}>
        {drawType === 'LineString' && <LineStyleControl />}
        <LineWidthControl />
        {showMeasurementControls && <MeasurementControls />}
      </div>

      <EditControls drawType={drawType} />

      <ConfirmPopover
        title={t('draw.confrimClear')}
        confirmLabel={t('shared.yes')}
        cancelLabel={t('shared.cancel')}
        onConfirm={clearDrawing}
        trigger={(props) => (
          <Button
            {...props}
            size="xs"
            palette="red"
            leftIcon="delete"
            className={styles.clear}
          >
            {t('draw.clear')}
          </Button>
        )}
      />
    </div>
  );
};
