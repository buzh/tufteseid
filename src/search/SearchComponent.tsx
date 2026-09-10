import { useState } from 'react';
import { ErrorBoundary } from '../shared/ErrorBoundary.tsx';
import { SearchResult } from '../types/searchTypes.ts';
import { SearchResults } from './results/SearchResults.tsx';
import styles from './SearchComponent.module.css';

// Search *input* now lives in the ribbon. This component renders only
// the results panel that floats under the bar, in the shell's left slot.
export const SearchComponent = () => {
  const [hoveredResult, setHoveredResult] = useState<SearchResult | null>(null);

  return (
    <ErrorBoundary name="SearchResults">
      <div className={styles.results} data-chrome="left">
        <SearchResults
          hoveredResult={hoveredResult}
          setHoveredResult={setHoveredResult}
        />
      </div>
    </ErrorBoundary>
  );
};
