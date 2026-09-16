import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { type BeholdOffer, beholdOfferAtom } from '../localities/behold';
import { metaLineOf } from '../localities/bilderCommon';
import type { LocalityWorkspaceApi } from '../localities/useLocalityWorkspace';
import { viewSpecOf } from '../localities/viewSpec';
import {
  groundShownAtom,
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
import { recreateViewAtom } from './useRecreateView';
import { useVisningRingHint, visningRingAtom } from './visningRing';

/*
 * `[Visning ▾]` — the layer row's bottom group, and the one that holds the
 * ground itself (docs/lokalitet-view.md §13.1, §13.10 step 5).
 *
 * Its members are the ground preset — whichever of the five is on screen —
 * and every View in the lokalitet: an extract, a terrain render or a flyfoto
 * grab, each over its own rectangle, each with its own fade. That is the list
 * §13.1's eligibility rule produces, and the rule is `kind` and nothing else:
 * a sketch is [Skisse]'s and a screenshot is [Bilde]'s.
 *
 * **The list reads bottom-to-top, like the row does.** The preset is first
 * because it is underneath, and each View below it in the pulldown is above it
 * on the map. The row's one teaching claim is that position means depth
 * (§13.1); a pulldown that inverted it inside the group would be teaching the
 * opposite thing two pixels away.
 *
 * **Held, not withdrawn.** The group's own switch and the preset's are the two
 * that take down layers somebody else declared — the background stack is
 * `backgroundLayers/utils.ts`'s and the live terrain render is
 * `useTerrainAnalysis`'s — so neither may reach for the producer. They say so
 * to the two mechanisms that can hold a layer down and give it back unchanged:
 * `setBackgroundHidden` and `setGroundOverlayStack`'s held set. A member's own
 * switch is the other kind and does withdraw: the `<GroundMember>` under it
 * unmounts and `useGroundView` takes its pixels off the map, which is what
 * keeps a lokalitet's worth of unwatched WMS stitches from being kept warm.
 *
 * **Nothing here writes** (§13.8), so there is no stance gate: a reader gets
 * the group at full function, `Gjenskap` included.
 */
export const VisningControl = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t } = useTranslation();
  const handle = useAtomValue(groundHandleAtom);
  const offer = useAtomValue(beholdOfferAtom);
  const [groundShown, setGroundShown] = useAtom(groundShownAtom);
  const [shown, setShown] = useAtom(visningShownAtom);
  const [opacity, setOpacity] = useAtom(visningOpacityAtom);
  const [groupShown, setGroupShown] = useAtom(visningGroupShownAtom);
  const recreate = useSetAtom(recreateViewAtom);
  const spendProvisional = useSetAtom(spendProvisionalViewAtom);
  const setRing = useSetAtom(visningRingAtom);
  const ringHint = useVisningRingHint();
  const { failedIds, report } = useLayerFailures();

  const views = ws.viewItems;
  const shownViews = views.filter((rec) => shown.has(rec.id));

  /*
   * The same list, handed to the keyboard (`visningRing.ts`).
   *
   * Every View, not the shown ones: W/S walks the pulldown, and a ring made of
   * what is already up would have one stop. Keyed on the ids for the reason
   * the stack below is, and emptied on the way out — row 1 registers the keys
   * and cannot see whether this group is on screen.
   */
  const ringKey = views.map((rec) => rec.id).join(' ');
  const ringIds = useMemo(
    () => views.map((rec) => rec.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ringKey],
  );

  useEffect(() => {
    setRing(ringIds);
    return () => setRing([]);
  }, [ringIds, setRing]);

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
    const held = !groupShown
      ? new Set(keys)
      : groundShown
        ? new Set<string>()
        : new Set([TERRAIN_KEY]);
    setGroundOverlayStack('visning', keys, held);
  }, [keys, groupShown, groundShown]);

  // The background stack is the other half of "the ground is off", and it is
  // not in this module's stack at all — it is the tile layers under the whole
  // group. Both switches reach it: the group's, because a group that is off
  // shows nothing, and the preset's, because that is what the preset *is*.
  useEffect(() => {
    setBackgroundHidden(!groupShown || !groundShown);
  }, [groupShown, groundShown]);

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

  const toggleView = (id: string) =>
    setShown((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  // Dialling a member's fade is composing the stack as much as switching one
  // is, and somebody who has faded the cover to read through it has said what
  // they want it to do.
  const setViewOpacity = (id: string, value: number) => {
    spendProvisional('keep');
    setOpacity((cur) => new Map(cur).set(id, value));
  };

  const members: LayerMember[] = [
    {
      id: 'ground',
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
      shown: groundShown,
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
      // `Gjenskap`, where it lives now (§13.2): it stopped being a button on
      // the card and became the pulldown's apply, unchanged underneath —
      // `useRecreateView` still does the work. Every row here has a view
      // behind it by construction, so unlike the button it replaced there is
      // no absent case to handle.
      action: {
        icon: 'restart_alt' as const,
        label: t('localities.layers.apply'),
        onClick: () => {
          const spec = viewSpecOf(rec);
          if (spec) recreate(spec);
        },
      },
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
            // Either switch is the user taking this group in hand, so the
            // arrival cover stops being the app's guess and is never withdrawn
            // from under them again (`provisionalViewAtom`). `keep`: the
            // switches say what is on the ground, and this is only about who
            // said it.
            onToggleMember={(id) => {
              spendProvisional('keep');
              if (id === 'ground') setGroundShown(!groundShown);
              else toggleView(id);
            }}
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
