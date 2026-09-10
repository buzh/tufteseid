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
import {
  Badge,
  BadgePalette,
  Icon,
  IconButton,
  Input,
  Segmented,
  Spinner,
} from '../ui';
import { activeLocalityAtom } from './atoms';
import { formatBboxArea, formatDate } from './format';
import styles from './LocalitiesPanel.module.css';
import { setLocalityHighlight } from './localityLayer';

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
    <div
      className={styles.row}
      onClick={() => onOpen(locality)}
      // Pointing at a row lights up its rectangle in the map, so you can
      // tell two similarly named areas apart without opening either.
      onMouseEnter={() => setLocalityHighlight(locality.id)}
      onMouseLeave={() => setLocalityHighlight(null)}
      title={t('localities.panel.openHint')}
    >
      <div className={styles.rowHead}>
        <span className={styles.name}>{locality.name}</span>
        <Badge palette={VISIBILITY_PALETTE[locality.visibility]}>
          {t(`localities.visibility.${locality.visibility}`)}
        </Badge>
      </div>
      {locality.description && (
        <div className={styles.description}>{locality.description}</div>
      )}
      <div className={styles.meta}>
        {meta.join(' · ')}
        {!isMine && locality.expand?.owner
          ? ` · ${t('localities.byOwner', { name: locality.expand.owner.name })}`
          : ''}
      </div>
    </div>
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
      <p className={styles.signInPrompt}>{t('localities.panel.signInPrompt')}</p>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div className={styles.search}>
          <Icon icon="search" size={16} className={styles.searchIcon} />
          <Input
            className={styles.searchInput}
            value={query}
            placeholder={t('localities.panel.searchPlaceholder')}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <IconButton
              className={styles.clear}
              icon="close"
              size="xs"
              palette="gray"
              aria-label={t('localities.panel.clearSearch')}
              onClick={() => setQuery('')}
            />
          )}
        </div>
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
      </div>

      {filtered == null && (
        <div className={styles.status}>
          <Spinner size={14} />
          {t('localities.panel.loading')}
        </div>
      )}
      {filtered && filtered.length === 0 && (
        <p className={styles.empty}>
          {query.trim()
            ? t('localities.panel.noMatch', { query: query.trim() })
            : t('localities.panel.empty')}
        </p>
      )}
      <div className={styles.list}>
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
      </div>
    </div>
  );
};
