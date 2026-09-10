import { t } from 'i18next';
import { useAtomValue } from 'jotai';
import { useCallback, useState } from 'react';
import { ProjectionIdentifier } from '../../map/projections/types';
import { getInputCRS } from '../../shared/utils/crsUtils';
import { Section } from '../../ui';
import { placesNearbyAtom, selectedResultAtom } from '../atoms';
import { CoordinateInfo } from './coordinates/CoordinateSection';
import { FeatureInfoSection } from './FeatureInfoSection';
import styles from './InfoBox.module.css';
import { PlaceInfo } from './PlaceInfo';
import { PropertyInfo } from './PropertyInfo';

/*
 * The stack of disclosures under the preamble. All independent, all closed to
 * begin with, so the open set lives here and each section is a controlled
 * `Section` — the same shape as the search results panel. `FeatureInfoSection`
 * opens itself when there is exactly one hit, which the controlled pair
 * already allows; it used to reach into the accordion's context for that.
 */
export const InfoBoxSections = () => {
  const placesNearby = useAtomValue(placesNearbyAtom);
  const selectedResult = useAtomValue(selectedResultAtom);
  const [openSections, setOpenSections] = useState<string[]>([]);

  const setOpen = useCallback((id: string, open: boolean) => {
    setOpenSections((prev) =>
      open ? [...new Set([...prev, id])] : prev.filter((it) => it !== id),
    );
  }, []);

  const sectionProps = (id: string) => ({
    open: openSections.includes(id),
    onOpenChange: (open: boolean) => setOpen(id, open),
    className: styles.section,
  });

  if (!selectedResult) {
    return null;
  }
  const inputCRS = getInputCRS(selectedResult);

  return (
    <>
      {['Property', 'Coordinate', 'Address'].includes(selectedResult.type) && (
        <PropertyInfo
          lon={selectedResult.lon}
          lat={selectedResult.lat}
          inputCRS={inputCRS}
          {...sectionProps('propertyInfo')}
        />
      )}

      {selectedResult.type === 'Place' && (
        <Section title={t('infoBox.placeinfo')} {...sectionProps('placeInfo')}>
          <PlaceInfo place={selectedResult.place} />
        </Section>
      )}
      {placesNearby.length > 0 && (
        <Section
          title={t('infoBox.placesNearby')}
          count={placesNearby.length}
          {...sectionProps('placesNearby')}
        >
          <div className={styles.nearby}>
            {placesNearby.map((place) => (
              <PlaceInfo key={place.placeNumber} place={place} />
            ))}
          </div>
        </Section>
      )}
      <Section
        title={t('infoBox.coordinateInfo')}
        {...sectionProps('coordinateInfo')}
      >
        <CoordinateInfo
          lon={selectedResult.lon}
          lat={selectedResult.lat}
          inputCRS={inputCRS as ProjectionIdentifier}
        />
      </Section>
      <FeatureInfoSection {...sectionProps('featureInfo')} />
    </>
  );
};
