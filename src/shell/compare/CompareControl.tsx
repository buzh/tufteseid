import { useAtom } from 'jotai';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { COMPARE_GROUNDS, compareGroundAtom } from '../../map/compare/atoms';
import { Button, Popover } from '../../ui';
import { ModeButton } from '../ModeButton';
import { PulldownItem } from '../Pulldown';
import styles from '../Pulldown.module.css';
import type { GroundMode } from '../useGroundMode';

/**
 * Sammenlign — put a second ground on the right of a draggable curtain.
 *
 * A mode you enter and leave rather than a persistent split: two live tile
 * stacks are roughly twice the GetMap requests, and Kartverket rate-limits
 * per source IP across every visitor of this deployment
 * (docs/wms-proxy-and-tiles.md). Leaving tears the B stack down.
 *
 * Not one of the five ground buttons, because it does not answer "what does
 * the ground look like" — it answers "against what". Hence its own group,
 * and no digit key.
 */
export const CompareControl = ({
  mode,
  previous,
}: {
  mode: GroundMode;
  previous: () => GroundMode | null;
}) => {
  const { t } = useTranslation();
  const [ground, setGround] = useAtom(compareGroundAtom);
  const [open, setOpen] = useState(false);

  // Entering lands on the ground you were last on, which is almost always
  // the one you just flipped away from to see this one — i.e. the comparison
  // you were already making by hand. Terreng cannot be a B half, and neither
  // can the ground already filling the map, so both fall through to the
  // other of the two that matter.
  const enter = () => {
    const prev = previous();
    setGround(
      prev && prev !== 'terreng' && prev !== mode
        ? prev
        : mode === 'flyfoto'
          ? 'lidar'
          : 'flyfoto',
    );
  };

  return (
    <>
      <ModeButton
        icon="compare"
        label={t('ribbon.compare.label')}
        tooltip={t('ribbon.compare.tip')}
        active={ground != null}
        onClick={() => {
          if (ground) setGround(null);
          else enter();
        }}
      />

      {ground && (
        <Popover
          open={open}
          onOpenChange={setOpen}
          width={220}
          padded={false}
          label={t('ribbon.compare.groundLabel')}
          className={styles.trigger}
          trigger={
            <Button
              variant="secondary"
              size="md"
              className={styles.triggerButton}
              rightIcon="arrow_drop_down"
              title={t('ribbon.compare.groundLabel')}
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              <span className={styles.triggerLabel}>
                {t(`ribbon.mode.${ground}`)}
              </span>
            </Button>
          }
        >
          <div className={styles.head}>
            <span>{t('ribbon.compare.head')}</span>
          </div>
          {COMPARE_GROUNDS.map((g) => (
            <PulldownItem
              key={g}
              label={t(`ribbon.mode.${g}`)}
              // Naming the half that is already on the map keeps the list
              // from looking like it offers a comparison it can't make.
              meta={g === mode ? t('ribbon.compare.sameAsLeft') : undefined}
              active={g === ground}
              onActivate={() => {
                setGround(g);
                setOpen(false);
              }}
            />
          ))}
        </Popover>
      )}
    </>
  );
};
