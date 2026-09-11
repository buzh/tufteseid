// Gjenskap: apply a `ViewSpec` to the live map.
//
// The other half of `src/localities/viewSpec.ts`. That module reads a stored
// view out of an attachment; this one puts it back on screen — enter the
// ground, pick the dataset, set the knobs — so that a render saved six months
// ago can be reproduced at today's zoom, over today's theme layers, and
// compared against them.
//
// It is a command atom plus a hook rather than a function the Bilder section
// calls, because the state it has to write is not reachable from there. Two of
// the four grounds keep their controls in hooks that are mounted exactly once,
// from RibbonGlobalRow — Terrenganalyse's whole state is `useState` inside
// `useTerrainAnalysis`, not atoms — so the only place that can apply a spec is
// beside those hooks. The button therefore says what it wants and this hook
// does it: one writer, one place, and the button stays a button.
//
// Resolving a dataset is asynchronous on purpose. A LiDAR project is a name in
// a 1936-entry WMS catalogue and a flyfoto acquisition is a row in an ArcGIS
// query, and either can be recreated before its list has ever been fetched —
// pressing Gjenskap from a cold load is the normal case, not the edge one.
// Both fetches are cached, so the second press is instant.

import { atom, useAtom, useAtomValue } from 'jotai';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { activeLocalityAtom } from '../localities/atoms';
import { fetchFlyfotoProjectsForBbox } from '../localities/flyfotoProjects';
import type { ViewSpec } from '../localities/viewSpec';
import {
  fetchLidarProjects,
  stylesForModel,
} from '../map/layers/config/backgroundLayers/lidarProjects';
import { toast } from '../ui';
import type { FlyfotoControls } from './flyfoto/useFlyfotoControls';
import type { LidarControls } from './lidar/useLidarControls';
import type { TerrainAnalysis } from './terrain/useTerrainAnalysis';
import type { GroundControls } from './useGroundMode';

/**
 * The view somebody asked to be taken back to, until it has been. Set it and
 * forget it — `useRecreateView` clears it once it has applied or given up, so
 * pressing Gjenskap twice on the same image is two commands rather than one
 * that never lands.
 */
export const recreateViewAtom = atom<ViewSpec | null>(null);

export const useRecreateView = (
  ground: GroundControls,
  lidar: LidarControls,
  flyfoto: FlyfotoControls,
  terrain: TerrainAnalysis,
) => {
  const { t } = useTranslation();
  const [spec, setSpec] = useAtom(recreateViewAtom);
  const locality = useAtomValue(activeLocalityAtom);

  // The four control objects are rebuilt on every render, and this effect must
  // run when a *spec* arrives and at no other time — a re-run would re-enter
  // the ground under a user who has since moved on. Everything it writes is
  // either an atom setter or a `useState` setter, so a closure one render
  // stale is the same closure.
  const latest = useRef({ ground, lidar, flyfoto, terrain, locality, t });
  latest.current = { ground, lidar, flyfoto, terrain, locality, t };

  useEffect(() => {
    if (!spec) return;
    let cancelled = false;
    const { ground, lidar, flyfoto, terrain, locality, t } = latest.current;
    // Applied or given up, either way it is spent. Clearing on failure too is
    // what makes a second press a second attempt.
    const done = () => setSpec(null);
    const giveUp = (what: string) => {
      toast.warning({
        title: t('localities.bilder.recreateFailed'),
        description: what,
      });
      done();
    };

    switch (spec.kind) {
      case 'terrain':
        // Knobs first, then the mode: entering Terreng is what starts the DEM
        // fetch, and that fetch is keyed on the model this call sets.
        terrain.restoreView(spec);
        ground.select('terreng');
        done();
        break;

      case 'lidar': {
        ground.select('lidar');
        lidar.setLidarModel(spec.model);
        if (spec.source === 'national') {
          // Set the wanted style *first* and let `activateNational` resolve
          // it: that path reads the current style as its preference and clamps
          // it to what the dataset actually publishes. Writing the style
          // afterwards would skip the clamp, and asking a LiDAR WMS for a
          // style it does not have answers HTTP 200 with a JSON error body —
          // i.e. a blank map and nothing in the console.
          lidar.setActiveLidarStyle(spec.style);
          lidar.activateNational();
          done();
          break;
        }
        const wanted = spec.source.projectName;
        fetchLidarProjects()
          .then((projects) => {
            if (cancelled) return;
            const project = projects.find((p) => p.projectName === wanted);
            if (!project) {
              giveUp(wanted);
              return;
            }
            // Clamped by the same rule the pulldown uses, and against the
            // model as well: DOM publishes one style whatever the DTM
            // catalogue lists for the project.
            const published = stylesForModel(project.styles, spec.model);
            lidar.setActiveLidarStyle(
              published.includes(spec.style) ? spec.style : published[0],
            );
            lidar.activateProject(project);
            done();
          })
          .catch(() => {
            if (!cancelled) giveUp(wanted);
          });
        break;
      }

      case 'flyfoto': {
        flyfoto.enterFlyfoto();
        if (spec.source === 'mosaic' || !locality) {
          done();
          break;
        }
        const wantedId = spec.source.projectId;
        // Against the lokalitet's own rectangle rather than the viewport list
        // the pulldown shows: that list is only fetched while ortofoto is
        // already the background and is empty when zoomed out, and the
        // acquisition we want is by definition one that covers this lokalitet.
        // Same cached query either way.
        fetchFlyfotoProjectsForBbox(locality.bbox)
          .then((projects) => {
            if (cancelled) return;
            const project = projects.find((p) => p.id === wantedId);
            if (!project) {
              giveUp(wantedId);
              return;
            }
            flyfoto.activateProject(project);
            done();
          })
          .catch(() => {
            if (!cancelled) giveUp(wantedId);
          });
        break;
      }
    }

    return () => {
      cancelled = true;
    };
  }, [spec, setSpec]);
};
