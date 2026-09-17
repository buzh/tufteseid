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
 * `[Visning ▾]` — the layer row's bottom group: the ground preset and every
 * View, membership decided by `kind` alone. The rows are a selection, not
 * checkboxes. Held, not withdrawn: the group's switch holds the layers
 * `backgroundLayers/utils.ts` and `useTerrainAnalysis` declared, through
 * `setBackgroundHidden` and the held set, rather than reaching for either.
 */
/** The preset's row id. Never an attachment id. */
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

  // Emptied on the way out: row 1 registers the keys and cannot see whether
  // this group is on screen.
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

  const membersLabel = t('localities.layers.visningMembers') + ringHint;

  // Keyed on the ids: the list is rebuilt on every realtime event.
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

  // The background tile layers are not in this module's stack at all.
  useEffect(() => {
    setBackgroundHidden(!groupShown);
  }, [groupShown]);

  // Unmounting must not leave the map with no ground and no way back.
  useEffect(
    () => () => {
      setBackgroundHidden(false);
      setGroundOverlayStack('visning', [], new Set<string>());
    },
    [],
  );

  // Percent here, 0–1 across the boundary. Pushed for every View, not only
  // the shown ones: the alpha outlives the member (`opacityByKey`).
  useEffect(() => {
    for (const rec of views) {
      setGroundOverlayOpacity(
        viewKeyOf(rec.id),
        (opacity.get(rec.id) ?? 100) / 100,
      );
    }
  }, [views, opacity]);

  // Dialling a fade is taking the group in hand, so it spends the latch too.
  const setViewOpacity = (id: string, value: number) => {
    spendProvisional('keep');
    setOpacity((cur) => new Map(cur).set(id, value));
  };

  const members: LayerMember[] = [
    {
      id: GROUND_ROW,
      // No `opacity`: the background is a stack, so a slider would be three.
      label: handle
        ? handle.mode === 'terreng'
          ? t('ribbon.terrain.label')
          : t(`ribbon.mode.${handle.mode}`)
        : t('localities.layers.ground'),
      meta: groundMetaOf(offer, t('ribbon.flyfoto.mosaic')),
      shown: shown.size === 0,
    },
    ...views.map((rec, i) => ({
      id: rec.id,
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
            // The preset's row is "no View", i.e. `selectVisning`'s null.
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

/** Acquisition, style and knobs under the ground's name, off `beholdOfferAtom`.
 * Standard and Hybrid say nothing: their cartography is part of the preset. */
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
