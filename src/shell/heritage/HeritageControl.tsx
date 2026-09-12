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

/** The source whose sublayers and rendering the panel below can reshape, and
 *  the one the eye reaches for when nothing at all is on. */
const RESHAPEABLE: ThemeLayerName = 'heritageSites';

/**
 * `Kulturminner` — one control with a seam in it. Press the labelled half for
 * what the heritage overlay draws and how hard; press the eye to take it off
 * the map and put it back.
 *
 * **It used to be two buttons**: a `castle` that toggled `heritageSites` and
 * an `Oppsett` (`tune`) beside it that opened this panel. Two controls for one
 * subject, and the split was in the wrong place — the first could only ever
 * say one of the five sources, while the count badge saying how many were on
 * lived on the second. Turn on three sources from the panel and the button
 * labelled `Kulturminner` was a switch for one of them; press it and two
 * stayed behind. Now the noun names the whole overlay, the badge is on the
 * noun, and on/off is the eye — which is `Funn`'s arrangement three rows down
 * (`EyeSplit`), for the same reason: the button that lists what it hides is
 * the button the switch belongs on.
 *
 * The panel replaces the "Temakart" card, which was upstream's generic
 * theme-layer tree: expandable categories, subthemes, a count warning at
 * fifteen active layers. The fork has five layers in one category, all from
 * the same rights holder, so the tree was scaffolding around a list of five
 * checkboxes — and it spent a dock slot to say so, next to the map it was
 * covering.
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
    // Ticking a source is a request to see it, and the eye is a blind over
    // all of them: leaving it down would answer a checkbox with nothing on
    // the map and no visible reason why. Outside the updater — a setter is
    // not a place to put a side effect.
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
  // On the map, as against ticked: hiding keeps the selection (heritage.ts),
  // and nothing ticked draws nothing whatever the blind says.
  const shown = !hidden && active.size > 0;

  /*
   * Three states, one press, and the third is the one worth stating: with no
   * source ticked at all the eye *arms* the overlay rather than raising an
   * empty blind, turning on heritageSites — the register most readings start
   * from, and what the old `castle` button meant by one press.
   *
   * That is what keeps the merge from costing anything. A first visitor's
   * route to the heritage record has to be one press on a control named after
   * it; without this they would have to open the panel and know which of five
   * Riksantikvaren services to tick.
   */
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
            {/* The three registers inside kulturminner2, indented under it.
                Only while it is on: they are its sublayers, and offering them
                next to a source that is switched off invites the reasonable
                guess that ticking one turns the source on. */}
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
        {/* Counted as transparency, so 0 % is the overlay at full strength.
            The atom still holds opacity — it is what the WMS layers take and
            what `?heritageOpacity` has always meant — so the flip lives here
            and the floor becomes a ceiling: `MIN_HERITAGE_OPACITY` is why the
            track stops at 80 % rather than letting the record vanish. */}
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
