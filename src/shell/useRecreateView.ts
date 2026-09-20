// Apply a `ViewSpec` to the live map: the other half of
// `src/localities/viewSpec.ts`, which reads one out of an attachment.
//
// A command atom plus a hook rather than a function a caller invokes, because
// some of the state it writes is `useState` inside `useTerrainAnalysis` and so
// only reachable beside the control hooks in RibbonGlobalRow.
//
// Resolving a dataset is asynchronous: a LiDAR project is a name in a
// 1936-entry WMS catalogue and a flyfoto acquisition a row in an ArcGIS query,
// and either can be asked for before its list has ever been fetched. Both
// fetches are cached.

import { atom, useAtom, useAtomValue } from 'jotai';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { frameExtentIn } from '../funn/frame';
import { activeLocalityAtom } from '../localities/atoms';
import { fetchFlyfotoProjectsForBbox } from '../localities/flyfotoProjects';
import type { ViewSpec } from '../localities/viewSpec';
import { mapAtom } from '../map/atoms';
import {
  fetchLidarProjects,
  stylesForModel,
} from '../map/layers/config/backgroundLayers/lidarProjects';
import { toast } from '../ui';
import { fitPadding } from './chromeInsets';
import type { FlyfotoControls } from './flyfoto/useFlyfotoControls';
import type { LidarControls } from './lidar/useLidarControls';
import type { TerrainAnalysis } from './terrain/useTerrainAnalysis';
import type { GroundControls } from './useGroundMode';

/**
 * The view asked for, until it has been applied. `useRecreateView` clears it
 * on success or failure, so a second press is a second command.
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
  const map = useAtomValue(mapAtom);

  // This effect must run when a spec arrives and at no other time, or it
  // re-enters the ground under a user who has moved on. Everything it writes
  // is a setter, so a closure one render stale is the same closure.
  const latest = useRef({ ground, lidar, flyfoto, terrain, locality, map, t });
  latest.current = { ground, lidar, flyfoto, terrain, locality, map, t };

  useEffect(() => {
    if (!spec) return;
    let cancelled = false;
    const { ground, lidar, flyfoto, terrain, locality, map, t } =
      latest.current;
    // Cleared on failure too, so a second press is a second attempt.
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
        // Knobs first: entering Terreng starts the DEM fetch, keyed on the
        // model this call sets.
        terrain.restoreView(spec);
        ground.select('terreng');
        done();
        break;

      case 'lidar': {
        ground.select('lidar');
        lidar.setLidarModel(spec.model);
        // The recorded render is handed to the activation rather than set
        // first, so the dataset clamps it to what that ground offers: asking a
        // LiDAR WMS for a style it does not have answers HTTP 200 with a JSON
        // error body, i.e. a blank map and no error. Passing it also keeps the
        // cache out of it — a View that recorded the WMS hillshade comes back
        // on the WMS hillshade, even where the store holds that flight.
        if (spec.source === 'national') {
          lidar.activateNational(spec.style);
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
            // Clamped against the model too: DOM publishes one style whatever
            // the DTM catalogue lists.
            const published = stylesForModel(project.styles, spec.model);
            lidar.activateProject(
              project,
              published.includes(spec.style) ? spec.style : published[0],
            );
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
        // Against the lokalitet's rectangle, not the pulldown's viewport list:
        // that list is empty when zoomed out. Same cached query.
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

      case 'sketch': {
        // A sketch names no ground, so there is none to enter — only the
        // frame it was drawn on, at the scale it was drawn at.
        const view = map.getView();
        const size = map.getSize();
        if (size) {
          const extent = frameExtentIn(
            spec.scene.frame,
            view.getProjection().getCode(),
          );
          view.fit(extent, {
            size,
            padding: fitPadding(map),
            duration: 400,
          });
        }
        done();
        break;
      }

      case 'scene':
        // A scene is put back by `restoreScene`; this module only sees its
        // ground. A whole scene arriving is a caller bug, spent anyway.
        done();
        break;
    }

    return () => {
      cancelled = true;
    };
  }, [spec, setSpec]);
};
