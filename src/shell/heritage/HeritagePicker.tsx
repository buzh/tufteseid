import { useAtom } from 'jotai';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { activeThemeLayersAtom } from '../../map/layers/atoms';
import {
  HERITAGE_DETAILS,
  type HeritageDetail,
  heritageDetailsAtom,
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
import { ModeButton } from '../ModeButton';
import { PulldownCheck, PulldownItem } from '../Pulldown';
import pulldown from '../Pulldown.module.css';
import styles from './HeritagePicker.module.css';

const SOURCES = themeLayerConfig.layers.map((l) => l.id as ThemeLayerName);

/** The source whose sublayers and rendering the panel below can reshape. */
const RESHAPEABLE: ThemeLayerName = 'heritageSites';

/**
 * The Kulturminner submenu — what the heritage overlay draws and how hard.
 *
 * This replaces the "Temakart" card, which was upstream's generic theme-layer
 * tree: expandable categories, subthemes, a count warning at fifteen active
 * layers. The fork has five layers in one category, all from the same rights
 * holder, so the tree was scaffolding around a list of five checkboxes — and
 * it spent a dock slot to say so, next to the map it was covering.
 *
 * What is here instead is the four things the register can actually be asked:
 * which services, which of kulturminner2's three registers, how they are
 * drawn, and how strongly. All four are in `src/map/layers/heritage.ts`
 * together with the WMS tables they resolve against.
 *
 * A popover rather than a row on the settings strip. The strip belongs to the
 * ground, and the heritage overlay is not a ground — it is the thing you are
 * reading the ground *against*, and it stays on while you cycle LiDAR
 * datasets underneath it. Giving it the strip would mean the strip's subject
 * changed on its own, so the controls under your cursor would be for
 * something else by the time you reached them.
 */
export const HeritagePicker = () => {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useAtom(activeThemeLayersAtom);
  const [details, setDetails] = useAtom(heritageDetailsAtom);
  const [render, setRender] = useAtom(heritageRenderAtom);
  const [opacity, setOpacity] = useAtom(heritageOpacityAtom);

  const toggleSource = (id: ThemeLayerName) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleDetail = (detail: HeritageDetail) =>
    setDetails((prev) => {
      const next = new Set(prev);
      if (next.has(detail)) next.delete(detail);
      else next.add(detail);
      return next;
    });

  const showRender = active.has(RESHAPEABLE);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      width={272}
      padded={false}
      label={t('ribbon.heritage.settings')}
      className={pulldown.trigger}
      trigger={
        <ModeButton
          icon="tune"
          label={t('ribbon.heritage.settingsShort')}
          tooltip={t('ribbon.heritage.settings')}
          active={open}
          badge={active.size}
          onClick={() => setOpen(!open)}
        />
      }
    >
      <div className={pulldown.head}>
        <span>{t('ribbon.heritage.sourcesHead')}</span>
        {active.size > 0 && (
          <Button size="xs" palette="gray" onClick={() => setActive(new Set())}>
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
          {/* The three registers inside kulturminner2, indented under it. Only
              while it is on: they are its sublayers, and offering them next to
              a source that is switched off invites the reasonable guess that
              ticking one turns the source on. */}
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

          {/* The subsets. One axis with the two above, because STYLES is one
              axis — see heritage.ts. Under its own heading so the list does
              not read as five more ways of drawing the same thing. */}
          <div className={pulldown.head}>
            <span>{t('ribbon.heritage.subsetHead')}</span>
          </div>
          {HERITAGE_VERN_RENDERS.map((r) => (
            <RenderItem key={r} render={r} active={render} onPick={setRender} />
          ))}
        </>
      )}

      <div className={pulldown.rule} />
      <div className={styles.opacity}>
        <label className={styles.opacityLabel} htmlFor="heritage-opacity">
          {t('ribbon.heritage.opacity', {
            percent: Math.round(opacity * 100),
          })}
        </label>
        <input
          id="heritage-opacity"
          type="range"
          className={styles.range}
          min={Math.round(MIN_HERITAGE_OPACITY * 100)}
          max={100}
          step={5}
          value={Math.round(opacity * 100)}
          onChange={(e) => setOpacity(Number(e.target.value) / 100)}
        />
      </div>
    </Popover>
  );
};

/**
 * Kept as a component so the label lookup and the "is this the current one"
 * test happen in one place for all seven renders — they come from two
 * different lists and are easy to get subtly out of step.
 */
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
