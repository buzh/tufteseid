import { Box, Flex } from '@kvib/react';
import { useAtom, useAtomValue } from 'jotai';
import { AuthDialog } from './auth/AuthDialog';
import { pbAuthSyncEffect } from './auth/atoms';
import { BottomDrawToolSelector } from './draw/BottomDrawToolSelector';
import { activeLocalityAtom, funnDraftActiveAtom } from './localities/atoms';
import { useFunnHighlightLayer } from './localities/funnHighlightLayer';
import { useFunnLayer } from './localities/funnLayer';
import {
  useLocalitiesLayer,
  useLocalityClick,
} from './localities/localityLayer';
import { LocalityWorkspace } from './localities/LocalityWorkspace';
import { useLocalityCreate } from './localities/useLocalityCreate';
import { KulturminnerPopup } from './map/featureInfo/KulturminnerPopup';
import { useFeatureInfoClick } from './map/featureInfo/useFeatureInfo';
import { useLidarFootprintsLayer } from './map/lidarFootprintsLayer';
import { MapComponent } from './map/MapComponent';
import { MapToolCards } from './map/overlay/MapToolCards';
import { useLidarCyclingKeys } from './map/useLidarCyclingKeys';
import { useSearchEffects } from './search/atoms';
import { useMapClickSearch } from './search/hooks';
import { InfoBox } from './search/infobox/InfoBox';
import { SearchComponent } from './search/SearchComponent';
import { ErrorBoundary } from './shared/ErrorBoundary';
import { useIsMobileScreen } from './shared/hooks';
import { TopBar } from './TopBar';

// Drawing, LiDAR extract and the lokalitet workspace are deliberately NOT
// MapTools. See docs/ui-architecture.md §1.
export type MapTool = 'layers' | 'measure' | 'localities' | null;

export const Layout = () => {
  const isMobile = useIsMobileScreen();
  const activeLocality = useAtomValue(activeLocalityAtom);
  const funnDraftActive = useAtomValue(funnDraftActiveAtom);

  useFeatureInfoClick();
  useSearchEffects();
  useMapClickSearch();
  // Lokaliteter: rectangle layer (all visible records), funn layer (open
  // lokalitet only), click-to-open, and the "Ny lokalitet" box drag.
  useLocalitiesLayer();
  useFunnLayer();
  useFunnHighlightLayer();
  useLocalityClick();
  useLocalityCreate();
  useLidarFootprintsLayer();
  // A/D/W/S/E background cycling. Mounted here rather than in the TopBar
  // so the document listener outlives whatever renders the controls.
  useLidarCyclingKeys();
  // Subscribe to PB authStore changes → currentUserAtom.
  useAtom(pbAuthSyncEffect);

  return (
    <ErrorBoundary fallback={undefined}>
      <Flex
        flexDir="column"
        h="100dvh"
        w="100dvw"
        bg="gray.200"
        overflow="hidden"
      >
        <ErrorBoundary fallback={undefined} name="TopBar">
          <TopBar />
        </ErrorBoundary>

        <Box flex="1" position="relative" overflow="hidden">
          <ErrorBoundary fallback={undefined} name="MapComponent">
            <MapComponent />
          </ErrorBoundary>

          {/* Left column. pointerEvents=none here, auto on the cards
              inside — the column spans the map height and must stay
              transparent to panning. docs/ui-architecture.md §3.1. */}
          <Box
            position="absolute"
            top={0}
            left={0}
            bottom={0}
            w={
              activeLocality
                ? { base: '100%', md: '400px', lg: '440px' }
                : { base: '100%', md: '360px', lg: '400px' }
            }
            maxW="100%"
            pt={3}
            pl={3}
            pb={3}
            pointerEvents="none"
            zIndex={2}
            overflowY="auto"
          >
            {activeLocality ? (
              <ErrorBoundary fallback={undefined} name="LocalityWorkspace">
                {/* Keyed so swapping lokalitet remounts with fresh form
                    state (and autoFocus re-applies for new records). */}
                <LocalityWorkspace
                  key={activeLocality.id}
                  locality={activeLocality}
                />
              </ErrorBoundary>
            ) : (
              <>
                <ErrorBoundary fallback={undefined} name="SearchComponent">
                  <SearchComponent />
                </ErrorBoundary>
                <ErrorBoundary fallback={undefined} name="MapToolCards">
                  <MapToolCards />
                </ErrorBoundary>
              </>
            )}
          </Box>

          {/* Right column: coordinate-info / search-result infobox */}
          <Box
            position="absolute"
            top={0}
            right={0}
            pt={3}
            pr={3}
            pointerEvents="none"
            zIndex={2}
          >
            <Flex justifyContent="flex-end">
              <ErrorBoundary fallback={undefined} name="InfoBox">
                <InfoBox />
              </ErrorBoundary>
            </Flex>
          </Box>
        </Box>
      </Flex>

      {isMobile && funnDraftActive && (
        <ErrorBoundary fallback={undefined} name="BottomDrawToolSelector">
          <BottomDrawToolSelector />
        </ErrorBoundary>
      )}
      <ErrorBoundary fallback={undefined} name="KulturminnerPopup">
        <KulturminnerPopup />
      </ErrorBoundary>
      <ErrorBoundary fallback={undefined} name="AuthDialog">
        <AuthDialog />
      </ErrorBoundary>
    </ErrorBoundary>
  );
};
