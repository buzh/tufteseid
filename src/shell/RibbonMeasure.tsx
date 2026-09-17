import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { mapToolAtom } from '../map/overlay/atoms';
import {
  measureEnabledEffect,
  measureTypeAtom,
  type MeasureType,
} from '../measure/atoms';
import { IconButton, Segmented, type SegmentedOption, Tooltip } from '../ui';

/**
 * Measure length or area. Inline rather than in a pulldown: an anchored panel
 * would close on the first map click, and an open overlay suspends the
 * A/D/W/S/E cycling keys while it is up.
 *
 * `measureEnabledEffect` is mounted unconditionally so its teardown branch
 * runs at all — unmounted with the panel, it never observes the tool change
 * and leaves the OL interaction attached.
 */
export const RibbonMeasure = () => {
  const { t } = useTranslation();
  const [tool, setTool] = useAtom(mapToolAtom);
  const [measureType, setMeasureType] = useAtom(measureTypeAtom);
  useAtom(measureEnabledEffect);

  const active = tool === 'measure';

  const options: SegmentedOption<Exclude<MeasureType, null>>[] = [
    { value: 'length', label: t('measure.length'), icon: 'straighten' },
    { value: 'area', label: t('measure.area'), icon: 'square_foot' },
  ];

  return (
    <>
      <Tooltip label={t('measure.label')}>
        <IconButton
          icon="straighten"
          size="md"
          variant={active ? 'primary' : 'ghost'}
          aria-label={t('measure.label')}
          aria-pressed={active}
          onClick={() => {
            setTool(active ? null : 'measure');
            setMeasureType(active ? null : 'length');
          }}
        />
      </Tooltip>
      {active && (
        <Segmented
          value={measureType ?? 'length'}
          options={options}
          onChange={setMeasureType}
          label={t('measure.label')}
        />
      )}
    </>
  );
};
