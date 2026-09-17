import { useAtom } from 'jotai';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { metaLineOf } from '../localities/bilderCommon';
import { funnGroupsOf, funnSectionsOf } from '../localities/funnGroups';
import { isBboxAssumed } from '../localities/uploadPlacement';
import type { LocalityWorkspaceApi } from '../localities/useLocalityWorkspace';
import {
  bildeGroupShownAtom,
  bildeKeyOf,
  bildeOpacityAtom,
  bildeShownAtom,
  setGroundOverlayOpacity,
  setGroundOverlayStack,
} from '../map/groundOverlay';
import { GroundMember, useLayerFailures } from './groundMembers';
import { LayerGroup, type LayerMember, LayerMembers } from './LayerGroup';

/*
 * `[Bilde ▾]` — the Files, over [Visning] and under [Skisse]. A File is bytes
 * with no spec behind it, so all it can do is lie down at its rectangle and be
 * faded. Grouped by funn, and that grouping is the paint order too: `keys` is
 * read off the grouped list, so the pulldown cannot sort for display alone.
 */
export const BildeControl = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t } = useTranslation();
  const [shown, setShown] = useAtom(bildeShownAtom);
  const [opacity, setOpacity] = useAtom(bildeOpacityAtom);
  const [groupShown, setGroupShown] = useAtom(bildeGroupShownAtom);
  const { failedIds, report } = useLayerFailures();

  const groups = funnGroupsOf(ws.fileItems, ws.findItems);
  const files = groups.flatMap((g) => g.items);
  const shownFiles = files.filter((rec) => shown.has(rec.id));
  const sections = funnSectionsOf(groups, {
    none: t('localities.funn.none'),
    untitled: t('localities.funn.untitled'),
  });

  // Keyed on the ids: the list is rebuilt on every realtime event.
  const stackKey = shownFiles.map((rec) => rec.id).join(' ');
  const keys = useMemo(
    () => shownFiles.map((rec) => bildeKeyOf(rec.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stackKey],
  );

  // Held, not withdrawn, the same rule as [Visning]'s.
  useEffect(() => {
    setGroundOverlayStack(
      'bilde',
      keys,
      groupShown ? new Set<string>() : new Set(keys),
    );
  }, [keys, groupShown]);

  useEffect(
    () => () => setGroundOverlayStack('bilde', [], new Set<string>()),
    [],
  );

  // Pushed for every File, not only the shown ones: `opacityByKey` outlives
  // the member. Off `ws.fileItems`, which is memoised where the grouped list
  // is a fresh array every render.
  const items = ws.fileItems;
  useEffect(() => {
    for (const rec of items) {
      setGroundOverlayOpacity(
        bildeKeyOf(rec.id),
        (opacity.get(rec.id) ?? 100) / 100,
      );
    }
  }, [items, opacity]);

  const toggleFile = (id: string) =>
    setShown((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const members: LayerMember[] = files.map((rec, i) => ({
    id: rec.id,
    // The author's caption wins; a screenshot's `meta` names its ground.
    label:
      rec.caption.trim() ||
      metaLineOf(rec) ||
      t('localities.layers.file', { n: i + 1 }),
    meta: rec.caption.trim() ? (metaLineOf(rec) ?? undefined) : undefined,
    shown: shown.has(rec.id),
    opacity: opacity.get(rec.id) ?? 100,
    note: isBboxAssumed(rec) ? t('localities.layers.assumed') : undefined,
    warning: failedIds.has(rec.id)
      ? t('localities.layers.unavailable')
      : undefined,
    section: sections?.get(rec.id),
  }));

  // Absent rather than disabled with no Files; the effects above have already
  // declared this group's empty stack.
  if (members.length === 0) return null;

  return (
    <>
      <LayerGroup
        // Not `photo_library`: that is the rail button on this same row.
        icon="image"
        label={t('localities.layers.bilde')}
        toggleLabel={t(
          groupShown
            ? 'localities.layers.bildeHide'
            : 'localities.layers.bildeShow',
        )}
        membersLabel={t('localities.layers.bildeMembers')}
        shown={groupShown}
        shownCount={members.filter((m) => m.shown).length}
        onToggle={() => setGroupShown(!groupShown)}
      >
        {() => (
          <LayerMembers
            members={members}
            onPressMember={toggleFile}
            onSetOpacity={(id, value) =>
              setOpacity((cur) => new Map(cur).set(id, value))
            }
          />
        )}
      </LayerGroup>
      {shownFiles.map((rec) => (
        <GroundMember
          key={rec.id}
          layerKey={bildeKeyOf(rec.id)}
          rec={rec}
          onFailed={report}
        />
      ))}
    </>
  );
};
