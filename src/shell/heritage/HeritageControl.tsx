import { useAtom } from 'jotai';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { activeThemeLayersAtom } from '../../map/layers/atoms';
import {
  HERITAGE_DETAILS,
  type HeritageDetail,
  heritageDetailsAtom,
  heritageHiddenAtom,
  heritageOpacityAtom,
  HERITAGE_VERN_RENDERS,
  type HeritageRender,
  heritageRenderAtom,
  MIN_HERITAGE_OPACITY,
} from '../../map/layers/heritage';
import {
  themeLayerConfig,
  themeLayerName,
} from '../../map/layers/themeLayerConfigApi';
import type { ThemeLayerName } from '../../map/layers/themeWMS';
import { Button, Popover } from '../../ui';
import { EyeSplit } from '../EyeSplit';
import { ModeButton } from '../ModeButton';
import { PulldownCheck, PulldownItem } from '../Pulldown';
import pulldown from '../Pulldown.module.css';
import styles from './HeritageControl.module.css';

const SOURCES = themeLayerConfig.layers.map((l) => l.id as ThemeLayerName);

// The source whose sublayers and rendering the panel can reshape, and the one
// the eye arms when nothing at all is on.
const RESHAPEABLE: ThemeLayerName = 'heritageSites';

// Kulturminner: the labelled half opens what the overlay draws and how hard,
// the eye takes the whole overlay off the map. The four axes and the WMS
// tables they resolve against are `src/map/layers/heritage.ts`.
export const HeritageControl = () => {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useAtom(activeThemeLayersAtom);
  const [hidden, setHidden] = useAtom(heritageHiddenAtom);
  const [details, setDetails] = useAtom(heritageDetailsAtom);
  const [render, setRender] = useAtom(heritageRenderAtom);
  const [opacity, setOpacity] = useAtom(heritageOpacityAtom);

  const toggleSource = (id: ThemeLayerName) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // The eye is a blind over every source, so ticking one has to raise it or
    // the checkbox answers with nothing on the map. Outside the updater: a
    // setter is not a place for a side effect.
    if (!active.has(id)) setHidden(false);
  };

  const toggleDetail = (detail: HeritageDetail) =>
    setDetails((prev) => {
      const next = new Set(prev);
      if (next.has(detail)) next.delete(detail);
      else next.add(detail);
      return next;
    });

  const showRender = active.has(RESHAPEABLE);
  // On the map, as against ticked: hiding keeps the selection (heritage.ts).
  const shown = !hidden && active.size > 0;

  // With nothing ticked the eye arms the overlay rather than raising an empty
  // blind, so reaching the heritage record is one press on the control named
  // after it.
  const toggleShown = () => {
    if (active.size === 0) {
      setActive(new Set([RESHAPEABLE]));
      setHidden(false);
      return;
    }
    setHidden(!hidden);
  };

  return (
    <EyeSplit
      shown={shown}
      label={t(shown ? 'ribbon.heritage.hide' : 'ribbon.heritage.show')}
      onToggle={toggleShown}
    >
      <Popover
        open={open}
        onOpenChange={setOpen}
        width={272}
        padded={false}
        label={t('ribbon.heritage.settings')}
        className={pulldown.trigger}
        trigger={
          <ModeButton
            icon="castle"
            label={t('ribbon.heritage.label')}
            tooltip={t('ribbon.heritage.settings')}
            active={open}
            badge={active.size}
            joinedRight
            onClick={() => setOpen(!open)}
          />
        }
      >
        <div className={pulldown.head}>
          <span>{t('ribbon.heritage.sourcesHead')}</span>
          {active.size > 0 && (
            <Button
              size="xs"
              palette="gray"
              onClick={() => setActive(new Set())}
            >
              {t('ribbon.heritage.clear')}
            </Button>
          )}
        </div>

        {SOURCES.map((id) => (
          <Fragment key={id}>
            <PulldownCheck
              label={themeLayerName(id, i18n.language)}
              checked={active.has(id)}
              onToggle={() => toggleSource(id)}
            />
            {/* kulturminner2's three registers, shown only while it is on:
                they are sublayers, and ticking one does not turn it on. */}
            {id === RESHAPEABLE &&
              active.has(id) &&
              HERITAGE_DETAILS.map((detail) => (
                <PulldownCheck
                  key={detail}
                  indent
                  label={t(`ribbon.heritage.detail.${detail}`)}
                  checked={details.has(detail)}
                  onToggle={() => toggleDetail(detail)}
                />
              ))}
          </Fragment>
        ))}

        {showRender && (
          <>
            <div className={pulldown.rule} />
            <div className={pulldown.head}>
              <span>{t('ribbon.heritage.renderHead')}</span>
            </div>
            <RenderItem
              render="omriss"
              active={render}
              onPick={setRender}
              hint={t('ribbon.heritage.omrissHint')}
            />
            <RenderItem render="flate" active={render} onPick={setRender} />

            {/* The vern subsets: one axis with the two renders above, because
                the WMS STYLES parameter is one axis. */}
            <div className={pulldown.head}>
              <span>{t('ribbon.heritage.subsetHead')}</span>
            </div>
            {HERITAGE_VERN_RENDERS.map((r) => (
              <RenderItem
                key={r}
                render={r}
                active={render}
                onPick={setRender}
              />
            ))}
          </>
        )}

        <div className={pulldown.rule} />
        {/* Counted as transparency (0 % is full strength) while the atom holds
            opacity, which is what the WMS layers and `?heritageOpacity` take,
            so `MIN_HERITAGE_OPACITY` becomes the track's ceiling. */}
        <div className={styles.opacity}>
          <label className={styles.opacityLabel} htmlFor="heritage-opacity">
            {t('ribbon.heritage.transparency', {
              percent: Math.round(100 - opacity * 100),
            })}
          </label>
          <input
            id="heritage-opacity"
            type="range"
            className={styles.range}
            min={0}
            max={Math.round(100 - MIN_HERITAGE_OPACITY * 100)}
            step={5}
            value={Math.round(100 - opacity * 100)}
            onChange={(e) => setOpacity((100 - Number(e.target.value)) / 100)}
          />
        </div>
      </Popover>
    </EyeSplit>
  );
};

// One component for all seven renders, which come from two different lists, so
// the label lookup and the active test cannot drift apart.
const RenderItem = ({
  render,
  active,
  hint,
  onPick,
}: {
  render: HeritageRender;
  active: HeritageRender;
  hint?: string;
  onPick: (render: HeritageRender) => void;
}) => {
  const { t } = useTranslation();
  return (
    <PulldownItem
      label={t(`ribbon.heritage.render.${render}`)}
      meta={hint}
      active={active === render}
      onActivate={() => onPick(render)}
    />
  );
};
