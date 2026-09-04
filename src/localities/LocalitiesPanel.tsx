import {
  Badge,
  Box,
  Flex,
  Icon,
  IconButton,
  Input,
  Spinner,
  Stack,
  Text,
} from '@kvib/react';
import { useAtomValue, useSetAtom } from 'jotai';
import { transformExtent } from 'ol/proj';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { countAttachmentsByLocality } from '../api/attachments';
import {
  listLocalities,
  listMyLocalities,
  LocalityRecord,
  subscribeLocalities,
} from '../api/localities';
import { countFindsByLocality } from '../api/localityFinds';
import { currentUserAtom, isAdminAtom } from '../auth/atoms';
import { mapAtom } from '../map/atoms';
import { mapToolAtom } from '../map/overlay/atoms';
import { activeLocalityAtom } from './atoms';
import { formatBboxArea, formatDate } from './format';
import { setLocalityHighlight } from './localityLayer';
import { BadgePalette, Segmented } from './ui';

const VISIBILITY_PALETTE: Record<
  LocalityRecord['visibility'],
  BadgePalette
> = {
  private: 'gray',
  limited: 'yellow',
  public: 'green',
};

type Scope = 'mine' | 'all';

const LocalityRow = ({
  locality,
  isMine,
  funnCount,
  bilderCount,
  onOpen,
}: {
  locality: LocalityRecord;
  isMine: boolean;
  funnCount: number | null;
  bilderCount: number | null;
  onOpen: (l: LocalityRecord) => void;
}) => {
  const { t, i18n } = useTranslation();

  // What the list is for: deciding which of these to reopen. So the row
  // carries the numbers that distinguish them — how much work is in it,
  // how big it is, when it last moved.
  const meta = [
    funnCount ? t('localities.summary.funn', { count: funnCount }) : null,
    bilderCount ? t('localities.summary.bilder', { count: bilderCount }) : null,
    formatBboxArea(locality.bbox, i18n.language),
    formatDate(locality.updated, i18n.language),
  ].filter((s): s is string => !!s);

  return (
    <Box
      borderWidth="1px"
      borderColor="gray.200"
      borderRadius="md"
      px={2}
      py={1.5}
      cursor="pointer"
      _hover={{ bg: 'gray.50', borderColor: 'green.400' }}
      onClick={() => onOpen(locality)}
      // Pointing at a row lights up its rectangle in the map, so you can
      // tell two similarly named areas apart without opening either.
      onMouseEnter={() => setLocalityHighlight(locality.id)}
      onMouseLeave={() => setLocalityHighlight(null)}
      title={t('localities.panel.openHint')}
    >
      <Flex align="center" gap={2}>
        <Text fontWeight="semibold" fontSize="sm" lineClamp={1} flex="1">
          {locality.name}
        </Text>
        <Badge colorPalette={VISIBILITY_PALETTE[locality.visibility]} size="sm">
          {t(`localities.visibility.${locality.visibility}`)}
        </Badge>
      </Flex>
      {locality.description && (
        <Text fontSize="xs" color="gray.600" lineClamp={1}>
          {locality.description}
        </Text>
      )}
      <Text fontSize="10px" color="gray.500" lineClamp={1}>
        {meta.join(' · ')}
        {!isMine && locality.expand?.owner
          ? ` · ${t('localities.byOwner', { name: locality.expand.owner.name })}`
          : ''}
      </Text>
    </Box>
  );
};

export const LocalitiesPanel = () => {
  const { t } = useTranslation();
  const user = useAtomValue(currentUserAtom);
  const isAdmin = useAtomValue(isAdminAtom);
  const map = useAtomValue(mapAtom);
  const setMapTool = useSetAtom(mapToolAtom);
  const setActiveLocality = useSetAtom(activeLocalityAtom);

  const [items, setItems] = useState<LocalityRecord[] | null>(null);
  const [scope, setScope] = useState<Scope>('mine');
  const [query, setQuery] = useState('');
  const [funnCounts, setFunnCounts] = useState<Map<string, number> | null>(null);
  const [bilderCounts, setBilderCounts] = useState<Map<string, number> | null>(
    null,
  );

  const load = useCallback(async () => {
    if (!user) return;
    setItems(null);
    try {
      const data =
        isAdmin && scope === 'all'
          ? await listLocalities()
          : await listMyLocalities(user.id);
      setItems(data);
    } catch (e) {
      console.warn('[LocalitiesPanel] load failed', e);
      setItems([]);
    }
    // Counts are a nice-to-have on top of the list; a failure here leaves
    // the rows without numbers rather than empty.
    try {
      const [finds, attachments] = await Promise.all([
        countFindsByLocality(),
        countAttachmentsByLocality(),
      ]);
      setFunnCounts(finds);
      setBilderCounts(attachments);
    } catch (e) {
      console.warn('[LocalitiesPanel] counts failed', e);
    }
  }, [user, isAdmin, scope]);

  useEffect(() => {
    load();
    const unsub = subscribeLocalities(() => load());
    return unsub;
  }, [load]);

  // A stale highlight would otherwise outlive the panel.
  useEffect(() => () => setLocalityHighlight(null), []);

  const open = useCallback(
    (l: LocalityRecord) => {
      setLocalityHighlight(null);
      const projection = map.getView().getProjection().getCode();
      const extent = transformExtent(l.bbox, 'EPSG:4326', projection);
      map
        .getView()
        .fit(extent, { padding: [80, 80, 80, 80], maxZoom: 18, duration: 400 });
      setActiveLocality(l);
      setMapTool(null);
    },
    [map, setActiveLocality, setMapTool],
  );

  const filtered = useMemo(() => {
    if (!items) return null;
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        (l.description ?? '').toLowerCase().includes(q),
    );
  }, [items, query]);

  if (!user) {
    return (
      <Text fontSize="sm" color="gray.600">
        {t('localities.panel.signInPrompt')}
      </Text>
    );
  }

  return (
    <Stack gap={2}>
      <Flex gap={2} align="center">
        <Flex flex="1" align="center" position="relative">
          <Box position="absolute" left={2} color="gray.400" display="flex">
            <Icon icon="search" size={16} />
          </Box>
          <Input
            size="sm"
            pl={8}
            pr={query ? 8 : 2}
            value={query}
            placeholder={t('localities.panel.searchPlaceholder')}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <Box position="absolute" right={1}>
              <IconButton
                icon="close"
                size="xs"
                variant="ghost"
                aria-label={t('localities.panel.clearSearch')}
                onClick={() => setQuery('')}
              />
            </Box>
          )}
        </Flex>
        {isAdmin && (
          <Segmented<Scope>
            value={scope}
            onChange={setScope}
            options={[
              { value: 'mine', label: t('localities.panel.filter.mine') },
              { value: 'all', label: t('localities.panel.filter.all') },
            ]}
          />
        )}
      </Flex>

      {filtered == null && (
        <Flex align="center" gap={2}>
          <Spinner size="xs" />
          <Text fontSize="xs" color="gray.500">
            {t('localities.panel.loading')}
          </Text>
        </Flex>
      )}
      {filtered && filtered.length === 0 && (
        <Text fontSize="sm" color="gray.600">
          {query.trim()
            ? t('localities.panel.noMatch', { query: query.trim() })
            : t('localities.panel.empty')}
        </Text>
      )}
      <Stack gap={1.5} maxH="50vh" overflowY="auto">
        {filtered?.map((l) => (
          <LocalityRow
            key={l.id}
            locality={l}
            isMine={l.owner === user.id}
            funnCount={funnCounts?.get(l.id) ?? null}
            bilderCount={bilderCounts?.get(l.id) ?? null}
            onOpen={open}
          />
        ))}
      </Stack>
    </Stack>
  );
};
