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
 * `[Bilde ▾]` — the Files, over [Visning] and under [Skisse]
 * (docs/lokalitet-view.md §13.1, §13.10 step 6).
 *
 * A screenshot is bytes and nothing else: there is no spec behind it, so there
 * is nothing to re-run and no `Gjenskap` here. What a File can do is lie down
 * at its own rectangle and be faded, which is exactly what a `LayerMembers`
 * row is — so this control is [Visning] minus the preset and minus the action,
 * and the two share `groundMembers.tsx` so that "a member on the map is a
 * mounted component" cannot come to mean two things.
 *
 * **This is what replaced `Vis i ruta`.** The old verb lived on the selected
 * card and put *one* File on the ground, because the ground was one slot and
 * the arbiter made the terrain render and the pinned bilde take turns; walking
 * the rail moved it, and switching to another lokalitet cleared it. None of
 * those were decisions — they were the slot. Here every eligible File has a
 * switch, several can be down at once, each carries its own fade, and the rail
 * has stopped being a map control (§13.2).
 *
 * Step 7 added the uploads, and added nothing to this file but a mark. An
 * upload has no georeference of its own, so `Plasser i ruta` on its card gives
 * it one (§13.5) and `fileItems` lists it from then on like any other File —
 * the *question* was where it goes, and once a record answers it there is
 * nothing here that needs to know it was ever open. What the row does have to
 * say is that the answer was assumed rather than measured, which is `note`.
 *
 * Step 9 grouped the list by funn (§13.6). It is the same members in a
 * different order, and the order is the point: a funn is a container for
 * images as well as a sublocation, so the photographs of the pit sit together
 * and above the lokalitet's own. The grouping decides the paint order too —
 * `keys` below is read off the grouped list, because a pulldown that sorted
 * for display alone would contradict the row's one teaching claim (§13.1) on
 * the same screen it makes it.
 *
 * **Nothing here writes** (§13.8): a reader gets the group at full function,
 * and the one verb in this thread that writes is on the card, in edit — the
 * funn a File belongs to is set there too, beside its caption.
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

  // Keyed on the ids rather than the array, for the reason `VisningControl`
  // gives: the item list is rebuilt on every realtime event and every
  // keystroke in the name field.
  const stackKey = shownFiles.map((rec) => rec.id).join(' ');
  const keys = useMemo(
    () => shownFiles.map((rec) => bildeKeyOf(rec.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stackKey],
  );

  // The group label is a hold, not a withdrawal — the same rule as [Visning]'s,
  // and it matters less here only because a File's producer is a decode rather
  // than a stitch. Saying it the same way is the point: one meaning for one
  // gesture across the row.
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

  // Pushed for every File and not only the shown ones: `opacityByKey` outlives
  // the member, so switching one back on has to find the fade it was left at.
  //
  // Off `ws.fileItems` rather than the grouped list, which is two facts at
  // once: a fade does not care what order its layer paints in, and the grouped
  // list is a fresh array every render while the hook's is memoised.
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
    // §13.4 again: the caption is the author's own name for the image and wins
    // where there is one. A screenshot's `meta` carries the ground it was taken
    // over, which is the nearest thing it has to provenance.
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

  // Absent rather than disabled on a lokalitet with no Files, the same call
  // `SkisseControl` makes: a group control over nothing cannot answer the only
  // question it is asked. Nothing is stranded by that — the effects above have
  // already declared this group's empty stack.
  if (members.length === 0) return null;

  return (
    <>
      <LayerGroup
        // Not `photo_library`: that is the rail button two places along this
        // same row, and after step 6 the two say different things — one is a
        // drawer of images, this one is what is on the ground.
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
