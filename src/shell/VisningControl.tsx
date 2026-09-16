import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { type BeholdOffer, beholdOfferAtom } from '../localities/behold';
import { metaLineOf } from '../localities/bilderCommon';
import type { LocalityWorkspaceApi } from '../localities/useLocalityWorkspace';
import { viewSpecOf } from '../localities/viewSpec';
import {
  setGroundOverlayOpacity,
  setGroundOverlayStack,
  spendProvisionalViewAtom,
  TERRAIN_KEY,
  viewKeyOf,
  visningGroupShownAtom,
  visningOpacityAtom,
  visningShownAtom,
} from '../map/groundOverlay';
import { setBackgroundHidden } from '../map/layers/config/backgroundLayers/utils';
import { groundHandleAtom } from './groundHandle';
import { GroundMember, useLayerFailures } from './groundMembers';
import { LayerGroup, type LayerMember, LayerMembers } from './LayerGroup';
import {
  selectVisningAtom,
  useVisningRingHint,
  visningRingAtom,
  type VisningStop,
} from './visningRing';

/*
 * `[Visning ▾]` — the layer row's bottom group, and the one that holds the
 * ground itself (docs/lokalitet-view.md §13.1, §13.10 step 5).
 *
 * Its members are the ground preset — whichever of the five is on screen —
 * and every View in the lokalitet: an extract, a terrain render or a flyfoto
 * grab, each over its own rectangle. That is the list §13.1's eligibility rule
 * produces, and the rule is `kind` and nothing else: a sketch is [Skisse]'s
 * and a screenshot is [Bilde]'s.
 *
 * **One at a time, and picking one enters it.** The rows are a selection, not
 * a set of checkboxes, and the press goes through `selectVisningAtom` — which
 * is also what W/S has walked since the ring landed, so the keys and the
 * pointer are now one path rather than two that disagreed about how many
 * members a choice leaves standing. Selecting also applies the View's own
 * spec, which is where `Gjenskap` went: a row that put a saved render on the
 * ground and left the ribbon describing some other ground was a surface lying
 * about what is on screen. The argument for both halves is in `visningRing.ts`.
 *
 * The preset is the group's other stop rather than a switch of its own. "No
 * View over the rectangle" is what it means, and it is where a reader who has
 * walked into an image walks back out — so it is first in the list, which is
 * also where it is on the map: **the list reads bottom-to-top, like the row
 * does.** The row's one teaching claim is that position means depth (§13.1),
 * and the fade under the selected View is what that claim is for — the one
 * image up, read against the ground selecting it just put underneath.
 *
 * **Held, not withdrawn.** The group's own switch takes down layers somebody
 * else declared — the background stack is `backgroundLayers/utils.ts`'s and
 * the live terrain render is `useTerrainAnalysis`'s — so it may not reach for
 * the producer. It says so to the two mechanisms that can hold a layer down
 * and give it back unchanged: `setBackgroundHidden` and
 * `setGroundOverlayStack`'s held set. Choosing a different member is the other
 * kind and does withdraw: the `<GroundMember>` under the old one unmounts and
 * `useGroundView` takes its pixels off the map, which is what keeps a
 * lokalitet's worth of unwatched WMS stitches from being kept warm.
 *
 * **Nothing here writes** (§13.8), so there is no stance gate: a reader gets
 * the group at full function.
 */
/**
 * The preset's row id. Not an attachment id and never will be — a member of
 * this group is a record or it is the ground.
 */
const GROUND_ROW = 'ground';

export const VisningControl = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t } = useTranslation();
  const handle = useAtomValue(groundHandleAtom);
  const offer = useAtomValue(beholdOfferAtom);
  const shown = useAtomValue(visningShownAtom);
  const [opacity, setOpacity] = useAtom(visningOpacityAtom);
  const [groupShown, setGroupShown] = useAtom(visningGroupShownAtom);
  const select = useSetAtom(selectVisningAtom);
  const spendProvisional = useSetAtom(spendProvisionalViewAtom);
  const setRing = useSetAtom(visningRingAtom);
  const ringHint = useVisningRingHint();
  const { failedIds, report } = useLayerFailures();

  const views = ws.viewItems;
  const shownViews = views.filter((rec) => shown.has(rec.id));

  /*
   * The same list, handed to `visningRing.ts` — which is where both the
   * keyboard and this pulldown's own press read it back from.
   *
   * Every View, not the shown ones: a list made of what is already up would
   * have one entry. Each row carries the spec it applies, because selecting is
   * a `Gjenskap` and the ring is walked from row 1, where the attachments are
   * not. Keyed on the ids for the reason the stack below is, and emptied on
   * the way out — row 1 registers the keys and cannot see whether this group
   * is on screen.
   */
  const ringKey = views.map((rec) => rec.id).join(' ');
  const stops = useMemo(
    (): VisningStop[] =>
      views.map((rec) => ({ id: rec.id, spec: viewSpecOf(rec) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ringKey],
  );

  useEffect(() => {
    setRing(stops);
    return () => setRing([]);
  }, [stops, setRing]);

  // The caret's tooltip is where the ring is announced, the pulldown being
  // what it walks — and only once there is something in it, which is the same
  // condition the keys themselves use.
  const membersLabel = t('localities.layers.visningMembers') + ringHint;

  /*
   * The arrangement, said to the map.
   *
   * Keyed on the ids rather than on the array, because `attachmentItems` is
   * rebuilt on every realtime event and every keystroke in the name field —
   * and re-declaring the stack is cheap only because the module compares
   * before it redraws, not because redrawing is free.
   */
  const stackKey = shownViews.map((rec) => rec.id).join(' ');
  const keys = useMemo(
    () => [TERRAIN_KEY, ...shownViews.map((rec) => viewKeyOf(rec.id))],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stackKey],
  );

  useEffect(() => {
    setGroundOverlayStack(
      'visning',
      keys,
      groupShown ? new Set<string>() : new Set(keys),
    );
  }, [keys, groupShown]);

  // The background stack is the other half of "this group is off", and it is
  // not in this module's stack at all — it is the tile layers under the whole
  // group. One switch reaches it now: the group's. The preset used to have a
  // switch of its own that hid the background and held `TERRAIN_KEY` down —
  // "a sketch and its funn on white, with nothing underneath arguing" — and
  // that reading is the group label's alone since the members became a
  // selection, because the preset's row now means "no View", not "no ground".
  useEffect(() => {
    setBackgroundHidden(!groupShown);
  }, [groupShown]);

  // Unmounting the lokalitet row must not leave the map with no ground and no
  // control that could give it back.
  useEffect(
    () => () => {
      setBackgroundHidden(false);
      setGroundOverlayStack('visning', [], new Set<string>());
    },
    [],
  );

  // Percent here, 0–1 on the other side of the boundary — the same conversion
  // `setSketchOverlays` makes, in the same direction. Pushed for every View and
  // not only the shown ones: the alpha outlives the member (`opacityByKey`),
  // so switching one back on has to find the fade it was left at.
  useEffect(() => {
    for (const rec of views) {
      setGroundOverlayOpacity(
        viewKeyOf(rec.id),
        (opacity.get(rec.id) ?? 100) / 100,
      );
    }
  }, [views, opacity]);

  // Dialling a member's fade is composing the stack as much as choosing one
  // is, and somebody who has faded the cover to read through it has said what
  // they want it to do.
  const setViewOpacity = (id: string, value: number) => {
    spendProvisional('keep');
    setOpacity((cur) => new Map(cur).set(id, value));
  };

  const members: LayerMember[] = [
    {
      id: GROUND_ROW,
      // The preset carries no fade: the background is a *stack* of tile
      // layers, so one slider here would be three fades rather than one, and
      // the two grounds that can be faded already have that control where all
      // their other modifiers are — on the settings strip. Step 4's rule said
      // the same thing from the other end (opacity is a raster idea).
      label: handle
        ? handle.mode === 'terreng'
          ? t('ribbon.terrain.label')
          : t(`ribbon.mode.${handle.mode}`)
        : t('localities.layers.ground'),
      meta: groundMetaOf(offer, t('ribbon.flyfoto.mosaic')),
      // Selected when no View is: this row is the group's "nothing over the
      // rectangle" stop, and the ground is under every other row anyway.
      shown: shown.size === 0,
    },
    ...views.map((rec, i) => ({
      id: rec.id,
      // §13.4: the row's label is the provenance. The caption is the author's
      // own name for the image and wins where there is one; underneath it the
      // same dataset · style · resolution line the card prints, from the same
      // reading of `meta`, so the two cannot drift.
      label:
        rec.caption.trim() ||
        metaLineOf(rec) ||
        t('localities.layers.view', { n: i + 1 }),
      meta: rec.caption.trim() ? (metaLineOf(rec) ?? undefined) : undefined,
      shown: shown.has(rec.id),
      opacity: opacity.get(rec.id) ?? 100,
      warning: failedIds.has(rec.id)
        ? t('localities.layers.unavailable')
        : undefined,
    })),
  ];

  return (
    <>
      <LayerGroup
        icon="landscape"
        label={t('localities.layers.visning')}
        toggleLabel={t(
          groupShown
            ? 'localities.layers.visningHide'
            : 'localities.layers.visningShow',
        )}
        membersLabel={membersLabel}
        shown={groupShown}
        shownCount={members.filter((m) => m.shown).length}
        onToggle={() => setGroupShown(!groupShown)}
      >
        {() => (
          <LayerMembers
            members={members}
            select
            // The preset's row is "no View", which is `selectVisning`'s null —
            // so the group has one entrance and the ground row is not a case
            // inside it. Spending the arrival latch is `selectVisning`'s too:
            // asking for a member by name is the user taking this group in
            // hand, and the cover is never withdrawn from under them again.
            onPressMember={(id) => select(id === GROUND_ROW ? null : id)}
            onSetOpacity={setViewOpacity}
          />
        )}
      </LayerGroup>
      {shownViews.map((rec) => (
        <GroundMember
          key={rec.id}
          layerKey={viewKeyOf(rec.id)}
          rec={rec}
          onFailed={report}
        />
      ))}
    </>
  );
};

/**
 * What the ground on screen *is*, under its name — the acquisition, the style,
 * the knobs.
 *
 * Off `beholdOfferAtom` because that is the one thing row 1 already publishes
 * about the live ground, and it says exactly this: the dataset a keep would
 * name. Standard and Hybrid offer nothing to keep and have nothing to say here
 * either, which is correct rather than a gap — their cartography ring is a
 * property of the preset, not a second dataset under it.
 */
const groundMetaOf = (
  offer: BeholdOffer | null,
  mosaicLabel: string,
): string | undefined => {
  if (!offer) return undefined;
  switch (offer.ground) {
    case 'lidar':
      return [offer.source?.label, offer.style].filter(Boolean).join(' · ');
    case 'flyfoto':
      return offer.project
        ? [offer.project.projectName, offer.project.year]
            .filter(Boolean)
            .join(' · ')
        : mosaicLabel;
    case 'terreng':
      return offer.describe()?.caption;
    default:
      return undefined;
  }
};
