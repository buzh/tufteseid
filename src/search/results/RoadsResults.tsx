import { useAtomValue } from 'jotai';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SearchResult } from '../../types/searchTypes';
import { Section } from '../../ui';
import { roadResultsAtom } from '../atoms';
import { getAddresses } from '../searchApi';
import { SearchResultLine } from './SearchResultLine';
import styles from './SearchResults.module.css';

interface RoadsResultsProps {
  handleSearchClick: (res: SearchResult) => void;
  handleHover: (res: SearchResult) => void;
  setHoveredResult: (res: SearchResult | null) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const RoadsResults = ({
  handleSearchClick,
  handleHover,
  setHoveredResult,
  open,
  onOpenChange,
}: RoadsResultsProps) => {
  const { t } = useTranslation();
  const roads = useAtomValue(roadResultsAtom).filter(
    (road) =>
      Number.isFinite(Number(road.LATITUDE)) &&
      Number.isFinite(Number(road.LONGITUDE)),
  );

  const [openRoads, setOpenRoads] = useState<string[]>([]);

  const toggleRoad = (roadId: string) => {
    setOpenRoads((prev) =>
      prev.includes(roadId)
        ? prev.filter((id) => id !== roadId)
        : [...prev, roadId],
    );
  };

  const handleHouseNumberClick = async (
    roadName: string,
    houseNumber: string,
    municipality: string,
  ) => {
    try {
      const query = `${roadName} ${houseNumber} ${municipality}`;
      const response = await getAddresses(query);

      const address = response.adresser?.[0];

      if (!address) return;

      handleSearchClick({
        type: 'Address',
        name: address.adressenavn,
        lat: address.representasjonspunkt.lat,
        lon: address.representasjonspunkt.lon,
        address,
      });
    } catch (e) {
      console.error('Failed to fetch address', e);
    }
  };

  if (roads.length === 0) {
    return null;
  }

  return (
    <Section
      title={t('search.roads')}
      count={roads.length}
      open={open}
      onOpenChange={onOpenChange}
      className={styles.section}
    >
      <ul className={styles.list}>
        {roads.map((road, i) => (
          <Fragment key={`road-${i}`}>
            <SearchResultLine
              heading={road.NAVN}
              locationType={road.KOMMUNENAVN}
              showButton={true}
              onButtonClick={() => toggleRoad(road.ID)}
              onClick={() =>
                handleSearchClick({
                  type: 'Road',
                  name: road.NAVN,
                  lat: parseFloat(road.LATITUDE),
                  lon: parseFloat(road.LONGITUDE),
                  road,
                })
              }
              onMouseEnter={() =>
                handleHover({
                  type: 'Road',
                  name: road.NAVN,
                  lat: parseFloat(road.LATITUDE),
                  lon: parseFloat(road.LONGITUDE),
                  road,
                })
              }
              onMouseLeave={() => setHoveredResult(null)}
            />
            {/* Numbers as chips rather than a labelled row each: a long
                street runs to a hundred of them, and the toggle that opened
                the list already said "Husnr". */}
            {openRoads.includes(road.ID) && road.HUSNUMMER && (
              <li className={styles.houseNumbers}>
                {road.HUSNUMMER.map((houseNumber, j) => (
                  <button
                    key={`houseNumber-${j}`}
                    type="button"
                    className={styles.houseNumber}
                    onClick={() =>
                      handleHouseNumberClick(
                        road.NAVN,
                        houseNumber,
                        road.KOMMUNENAVN,
                      )
                    }
                  >
                    {houseNumber}
                  </button>
                ))}
              </li>
            )}
          </Fragment>
        ))}
      </ul>
    </Section>
  );
};
