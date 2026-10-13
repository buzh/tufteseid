

import { atom, useAtomValue, useSetAtom } from 'jotai';
import { transform } from 'ol/proj';
import { useEffect, useRef } from 'react';

import { getSpotByCode, type SpotRecord } from '../api/spots';
import {
  authPromptAtom,
  currentUserAtom,
  isAuthDialogOpenAtom,
} from '../auth/atoms';
import { mapAtom } from '../map/atoms';
import {
  getUrlParameter,
  removeUrlParameter,
  setUrlParameter,
} from '../shared/utils/urlUtils';
import { activeSpotAtom, spotReadingAtom } from './atoms';

const bootCode = getUrlParameter('lok');

export const shareUrlOf = (code: string): string =>
  `${window.location.origin}/l/${code}`;

const LINK_ZOOM = 16;

export const spotLinkFailedAtom = atom(false);

const LINK_FAILED_MS = 10000;

export const useSpotShareLink = () => {
  const map = useAtomValue(mapAtom);
  const user = useAtomValue(currentUserAtom);
  const active = useAtomValue(activeSpotAtom);
  const setActive = useSetAtom(activeSpotAtom);
  const setReading = useSetAtom(spotReadingAtom);
  const setAuthDialogOpen = useSetAtom(isAuthDialogOpenAtom);
  const setAuthPrompt = useSetAtom(authPromptAtom);
  const setLinkFailed = useSetAtom(spotLinkFailedAtom);

  const settled = useRef(bootCode == null);
  const unresolved = useRef(bootCode);

  useEffect(() => {
    const code = unresolved.current;
    if (!code) return;
    let live = true;

    getSpotByCode(code)
      .then((record) => {
        if (!live) return;
        unresolved.current = null;
        settled.current = true;
        setActive(record);

        setReading(true);
      })
      .catch((err) => {
        if (!live) return;

        if ((err as { status?: number })?.status !== 404) {
          console.warn('[spots] could not resolve the code', code, err);
          return;
        }
        settled.current = true;
        if (user) {
          unresolved.current = null;
          removeUrlParameter('lok');
          setLinkFailed(true);

          window.setTimeout(() => setLinkFailed(false), LINK_FAILED_MS);
          console.warn('[spots] no spot for code', code);
          return;
        }

        setAuthPrompt('spotLink');
        setAuthDialogOpen(true);
      });

    return () => {
      live = false;
    };
  }, [
    user,
    setActive,
    setReading,
    setAuthDialogOpen,
    setAuthPrompt,
    setLinkFailed,
  ]);

  const reading = useAtomValue(spotReadingAtom);
  const readingNow = useRef(reading);
  useEffect(() => {
    readingNow.current = reading;
  }, [reading]);

  const activeId = active?.id ?? null;
  const activePoint = active?.point;
  const activeFitsItself = active?.footprint != null;
  useEffect(() => {
    if (!activeId || !activePoint || (readingNow.current && activeFitsItself))
      return;
    const view = map.getView();
    view.animate({
      center: transform(
        activePoint,
        'EPSG:4326',
        view.getProjection().getCode(),
      ),
      zoom: Math.max(view.getZoom() ?? 0, LINK_ZOOM),
      duration: 400,
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, activeId]);

  const activeCode = active?.code ?? null;
  useEffect(() => {
    if (!settled.current) return;
    if (activeCode) setUrlParameter('lok', activeCode);
    else removeUrlParameter('lok');
  }, [activeCode]);
};

export const copyShareLink = async (
  spot: SpotRecord | null,
): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(
      spot ? shareUrlOf(spot.code) : window.location.href,
    );
    return true;
  } catch {
    return false;
  }
};
