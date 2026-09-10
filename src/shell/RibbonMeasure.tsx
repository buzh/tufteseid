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
 * Measure length or area. Inline in the ribbon rather than in a pulldown:
 * measuring is a mode you stay in while clicking around the map, and an
 * anchored panel would either close on the first click or sit on top of the
 * thing being measured. It also keeps the keyboard free — an open overlay
 * suspends the A/D/W/S/E cycling keys for as long as it is up.
 *
 * measureEnabledEffect is mounted unconditionally. It already returns early
 * unless the measure tool is active, and leaving it mounted is what
 * guarantees the teardown branch runs at all: hosting it inside the panel
 * meant the effect could be unmounted before it observed the tool change,
 * leaving the OL interaction attached.
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
