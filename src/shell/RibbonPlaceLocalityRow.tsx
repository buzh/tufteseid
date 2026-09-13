import { useTranslation } from 'react-i18next';
import { MAX_SIDE_M, MIN_SIDE_M } from '../localities/bboxLimits';
import { formatBboxArea, formatBboxSpan } from '../localities/format';
import type { LocalityPlacement } from '../localities/placement';
import { useLocalityPlacement } from '../localities/useLocalityPlacement';
import { Button, cx, Icon } from '../ui';
import styles from './Ribbon.module.css';
import rowStyles from './RibbonPlaceLocalityRow.module.css';

/**
 * The placement row — a lokalitet's rectangle while it is being placed, and
 * before anything about it has been written (docs/ui-architecture.md §5.6).
 *
 * One line, no body, the same shape as the funn draft row: the rectangle is on
 * the map, which is where it has to be looked at, and a panel over the terrain
 * being framed would be the one surface guaranteed to cover the thing it is
 * about.
 *
 * Four things on it, left to right — what this row is scoped to, how big the
 * rectangle is, what to do with it, and the two ways it ends. `Opprett` is the
 * only write in the session; `Avbryt` has nothing to undo, which is the whole
 * argument for placing before creating.
 */
export const RibbonPlaceLocalityRow = ({
  placement,
}: {
  placement: LocalityPlacement;
}) => {
  const { t, i18n } = useTranslation();
  const place = useLocalityPlacement(placement);

  return (
    <div className={cx(styles.row, styles.rowSub, rowStyles.row)}>
      <span className={rowStyles.label}>{t('localities.placing.heading')}</span>

      <span className={rowStyles.span}>
        {formatBboxSpan(place.bbox, i18n.language)}
        {' · '}
        {formatBboxArea(place.bbox, i18n.language)}
      </span>

      {/* Why the drag stopped. The band is not arbitrary — it is what the
          producers can render (bboxLimits.ts) — so the row says the number
          rather than just refusing to go past it. */}
      {place.atLimit && (
        <span className={rowStyles.limit}>
          <Icon icon="crop_free" size={16} />
          {t(
            place.atLimit === 'max'
              ? 'localities.placing.atMax'
              : 'localities.placing.atMin',
            { max: MAX_SIDE_M, min: MIN_SIDE_M },
          )}
        </span>
      )}

      <span className={rowStyles.hint}>{t('localities.placing.hint')}</span>

      <div className={rowStyles.actions}>
        <Button
          variant="primary"
          leftIcon="check"
          disabled={place.creating}
          onClick={place.commit}
          title={t('localities.placing.createHint')}
        >
          {t(
            place.creating
              ? 'localities.placing.creating'
              : 'localities.placing.create',
          )}
        </Button>
        <Button
          variant="ghost"
          palette="gray"
          disabled={place.creating}
          onClick={place.cancel}
        >
          {t('localities.placing.cancel')}
        </Button>
      </div>
    </div>
  );
};
