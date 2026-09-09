import { Flex } from '@kvib/react';
import { useState } from 'react';
import { ErrorBoundary } from '../shared/ErrorBoundary.tsx';
import { SearchResult } from '../types/searchTypes.ts';
import { SearchResults } from './results/SearchResults.tsx';

// Search *input* now lives in the TopBar. This component renders only
// the results panel that floats under the bar, in the shell's left slot.
export const SearchComponent = () => {
  const [hoveredResult, setHoveredResult] = useState<SearchResult | null>(null);

  return (
    <ErrorBoundary name="SearchResults">
      <Flex flexDir="column" pointerEvents="auto" maxH="100%" overflowY="auto">
        <SearchResults
          hoveredResult={hoveredResult}
          setHoveredResult={setHoveredResult}
        />
      </Flex>
    </ErrorBoundary>
  );
};
