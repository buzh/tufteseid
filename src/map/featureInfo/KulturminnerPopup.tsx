import { useAtomValue, useSetAtom } from 'jotai';
import { Overlay } from 'ol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { selectedResultAtom } from '../../search/atoms';
import {
  Badge,
  Button,
  Icon,
  IconButton,
  Tooltip,
  cx,
  useMediaQuery,
  type MaterialSymbol,
} from '../../ui';
import { mapAtom } from '../atoms';
import { ProjectionIdentifier } from '../projections/types';
import { kulturminnerPopupAtom } from './atoms';
import {
  VERN_ICONS,
  kategoriIcon,
  vernBucket,
  type VernBucket,
} from './heritageVocabulary';
import styles from './KulturminnerPopup.module.css';
import { useKulturminnesokStatus } from './kulturminnesok';
import type { LayerFeatureInfo } from './types';
import { buildCoordinateResult } from './useFeatureInfo';

type FeatureKind =
  | 'lokalitet'
  | 'enkeltminne'
  | 'sikringssone'
  | 'sefrak'
  | 'kulturmiljo'
  | 'brukerminne'
  | 'other';

interface HeritageFeature {
  kind: FeatureKind;
  layerTitle: string;
  properties: Record<string, string | number | boolean | null>;
}

interface HeritageGroup {
  key: string;
  parentId: string;
  navn: string;
  lokalitet?: HeritageFeature;
  enkeltminner: HeritageFeature[];
  sikringssoner: HeritageFeature[];
  others: HeritageFeature[];
}

const classifyLayerId = (layerId: string): FeatureKind => {
  if (layerId === 'theme.heritageSites') return 'lokalitet';
  if (layerId === 'theme.culturalEnvironments') return 'kulturmiljo';
  if (layerId === 'theme.sefrakBuildings') return 'sefrak';
  if (layerId === 'theme.protectedBuildings') return 'lokalitet';
  if (layerId === 'theme.userReportedHeritage') return 'brukerminne';
  return 'other';
};

// `parseXmlFeatureInfo` loses the sublayer element name the WMS returns each
// feature under, so re-derive it from the property fingerprint.
const refineHeritageSitesKind = (
  properties: Record<string, unknown>,
): FeatureKind => {
  if ('enkeltminneart' in properties || 'lokalitetid' in properties)
    return 'enkeltminne';
  if ('lokalitetsart' in properties || 'antallenkeltminner' in properties)
    return 'lokalitet';
  // Sikringssoner carry a kulturminneid and almost nothing else.
  if (
    'kulturminneid' in properties &&
    !('navn' in properties) &&
    !('lokalitetsart' in properties) &&
    !('enkeltminneart' in properties)
  )
    return 'sikringssone';
  return 'lokalitet';
};

const stringify = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '';
  return String(v);
};

const firstOf = (
  properties: Record<string, unknown>,
  keys: readonly string[],
): string => {
  for (const key of keys) {
    const value = stringify(properties[key]);
    if (value) return value;
  }
  return '';
};

// The five registers say the same things under different field names, read off
// live GetFeatureInfo: sefrak objektnavn/bygningstypetekst/tidsangivelsetekst/
// askeladdenid, brukerminner tittel/beskrivelse/opprettet_av/opprettet with no
// id at all, the rest navn/informasjon/datering.
const NAME_FIELDS = ['navn', 'objektnavn', 'tittel'] as const;
const DESCRIPTION_FIELDS = ['informasjon', 'beskrivelse'] as const;
const ART_FIELDS = [
  'lokalitetsart',
  'enkeltminneart',
  'kulturmiljokategori',
  'bygningstypetekst',
  'sefrakstatustekst',
] as const;
const DATERING_FIELDS = ['datering', 'tidsangivelsetekst'] as const;
/** Ids the register owns and a user can quote back at it. */
const ID_FIELDS = ['lokalid', 'kulturminneid', 'askeladdenid'] as const;

// Brukerminner serve no id, so the kulturminnesøk link is the only thing on the
// wire separating two of them.
const identityOf = (properties: Record<string, unknown>): string =>
  firstOf(properties, ID_FIELDS) || stringify(properties['linkkulturminnesok']);

const KIND_ICONS: Partial<Record<FeatureKind, MaterialSymbol>> = {
  sefrak: 'house',
  kulturmiljo: 'landscape',
  brukerminne: 'person_pin_circle',
};

const getParentId = (
  feature: HeritageFeature,
  fallbackIndex: number,
): string => {
  const p = feature.properties;
  if (feature.kind === 'enkeltminne') {
    const lokalitetid = stringify(p['lokalitetid']);
    if (lokalitetid) return lokalitetid;
    const lokalid = stringify(p['lokalid']);
    if (lokalid) return lokalid.split('-')[0];
  }
  if (feature.kind === 'lokalitet') {
    // Some ids are suffixed ("300651-0") and the lokalitetid enkeltminner name
    // is the numeric prefix.
    const raw =
      stringify(p['kulturminneid']) ||
      stringify(p['lokalid']) ||
      stringify(p['lokalitetid']);
    if (raw) return raw.split('-')[0];
    return `lok-${fallbackIndex}`;
  }
  if (feature.kind === 'sikringssone') {
    // Sikringssoner have their own id space; keep them as their own group.
    return (
      'sz-' +
      (stringify(p['lokalid']) ||
        stringify(p['kulturminneid']) ||
        fallbackIndex)
    );
  }
  return identityOf(p) || stringify(p['objid']) || `other-${fallbackIndex}`;
};

const toHeritageFeatures = (layers: LayerFeatureInfo[]): HeritageFeature[] => {
  const out: HeritageFeature[] = [];
  for (const layer of layers) {
    const baseKind = classifyLayerId(layer.layerId);
    for (const feature of layer.features) {
      const kind =
        baseKind === 'lokalitet'
          ? refineHeritageSitesKind(feature.properties)
          : baseKind;
      out.push({
        kind,
        layerTitle: layer.layerTitle,
        properties: feature.properties,
      });
    }
  }
  return out;
};

const groupFeatures = (layers: LayerFeatureInfo[]): HeritageGroup[] => {
  const features = toHeritageFeatures(layers);

  // Dedupe *ikoner twins. A record with no identity gets a key of its own.
  let anonymous = 0;
  const dedupeKey = (f: HeritageFeature) =>
    `${f.kind}::${identityOf(f.properties) || `#${anonymous++}`}`;
  const seen = new Map<string, HeritageFeature>();
  for (const f of features) {
    const k = dedupeKey(f);
    const prev = seen.get(k);
    if (
      !prev ||
      Object.keys(f.properties).length > Object.keys(prev.properties).length
    ) {
      seen.set(k, f);
    }
  }

  const groups = new Map<string, HeritageGroup>();
  let fallback = 0;
  for (const f of seen.values()) {
    const parentId = getParentId(f, fallback++);
    let g = groups.get(parentId);
    if (!g) {
      g = {
        key: parentId,
        parentId,
        navn: '',
        enkeltminner: [],
        sikringssoner: [],
        others: [],
      };
      groups.set(parentId, g);
    }
    if (f.kind === 'lokalitet') g.lokalitet = f;
    else if (f.kind === 'enkeltminne') g.enkeltminner.push(f);
    else if (f.kind === 'sikringssone') g.sikringssoner.push(f);
    else g.others.push(f);
  }

  // Left empty when genuinely unnamed, so the card falls back to its `art`.
  for (const g of groups.values()) {
    const fromLokalitet = stringify(g.lokalitet?.properties['navn']);
    const fromEnkeltminne = stringify(g.enkeltminner[0]?.properties['navn']);
    if (fromLokalitet) g.navn = fromLokalitet;
    else if (fromEnkeltminne) g.navn = fromEnkeltminne;
    else if (g.others.length > 0)
      g.navn =
        firstOf(g.others[0].properties, NAME_FIELDS) || g.others[0].layerTitle;
  }

  const all = Array.from(groups.values());

  // A sikringssone is metadata for a lokalitet, not a result of its own.
  const hasReal = all.some((g) => g.lokalitet || g.enkeltminner.length > 0);
  if (hasReal) {
    return all.filter(
      (g) => g.lokalitet || g.enkeltminner.length > 0 || g.others.length > 0,
    );
  }
  return all;
};

// Roll a field up across a lokalitet and its enkeltminner: the shared value if
// they agree, a "Flere/Ulike …" label if they do not.
const rollup = (values: string[], aggregateLabel: string): string => {
  const unique = Array.from(new Set(values.filter((v) => v.length > 0)));
  if (unique.length === 0) return '';
  if (unique.length === 1) return unique[0];
  return aggregateLabel;
};

const formatDate = (v: unknown): string => {
  const s = stringify(v);
  if (!s) return '';
  // "2014-12-17 00:00:00" → "2014-12-17"
  const m = s.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : s;
};

// One fact as a glyph, with hover or focus naming the field. `withText` is for
// pointerless input; the value is in the DOM either way.
const MetaChip = ({
  icon,
  label,
  value,
  tone,
  withText,
}: {
  icon: MaterialSymbol;
  label: string;
  value: string;
  tone?: VernBucket;
  withText: boolean;
}) => (
  // On even when the text shows: "Tønsberg" alone does not say kommune.
  <Tooltip label={`${label}: ${value}`}>
    <span
      className={cx(styles.chip, tone && styles[tone])}
      tabIndex={withText ? undefined : 0}
    >
      <Icon icon={icon} size={16} />
      {withText ? (
        <span className={styles.chipText}>{value}</span>
      ) : (
        <span className={styles.srOnly}>{`${label}: ${value}`}</span>
      )}
    </span>
  </Tooltip>
);

// An observer rather than a layout effect: the overlay element is
// `display: none` until the parent positions the OL `Overlay`, after this
// effect, so a single measurement at mount reads 0 and the toggle never shows.
const Description = ({ text }: { text: string }) => {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (open || !el) return;
    const measure = () => setClipped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, open]);

  return (
    <div className={styles.descriptionBlock}>
      <div
        ref={ref}
        className={cx(styles.description, !open && styles.clamped)}
      >
        {text}
      </div>
      {clipped && (
        <button
          type="button"
          className={styles.moreButton}
          onClick={() => setOpen((v) => !v)}
        >
          {open
            ? t('kulturminner.descriptionLess')
            : t('kulturminner.descriptionMore')}
        </button>
      )}
    </div>
  );
};

const NestedEnkeltminner = ({
  features,
  defaultOpen,
  withText,
}: {
  features: HeritageFeature[];
  defaultOpen: boolean;
  withText: boolean;
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={styles.nested}>
      <button
        type="button"
        className={styles.nestedToggle}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Icon icon={open ? 'keyboard_arrow_down' : 'chevron_right'} size={16} />
        {t('kulturminner.enkeltminner', { count: features.length })}
      </button>
      {open && (
        <div className={styles.nestedList}>
          {features.map((em, i) => {
            const p = em.properties;
            const emNavn = stringify(p['navn']);
            const emArt = stringify(p['enkeltminneart']);
            const emKategori = stringify(p['enkeltminnekategori']);
            const emId = stringify(p['lokalid']);
            const emVerne = stringify(p['vernetype']);
            const emDatering = stringify(p['datering']);
            const bucket = vernBucket(emVerne);
            return (
              <div key={i} className={styles.nestedItem}>
                <div className={styles.nestedName}>
                  {emNavn ||
                    emArt ||
                    t('kulturminner.enkeltminneNumber', { id: emId })}
                </div>
                {emArt && emNavn && (
                  <div className={styles.nestedSubtitle}>{emArt}</div>
                )}
                {(emVerne || emDatering || emKategori) && (
                  <div className={styles.chips}>
                    {emKategori && (
                      <MetaChip
                        icon={kategoriIcon(emKategori)}
                        label={t('kulturminner.kategori')}
                        value={emKategori}
                        withText={withText}
                      />
                    )}
                    {emVerne && (
                      <MetaChip
                        icon={VERN_ICONS[bucket]}
                        label={t('kulturminner.vernestatus')}
                        value={emVerne}
                        tone={bucket}
                        withText={withText}
                      />
                    )}
                    {emDatering && (
                      <MetaChip
                        icon="history"
                        label={t('kulturminner.datering')}
                        value={emDatering}
                        withText={withText}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const HeritageCard = ({
  group,
  solo,
  withText,
}: {
  group: HeritageGroup;
  solo: boolean;
  withText: boolean;
}) => {
  const { t } = useTranslation();
  const primary =
    group.lokalitet ??
    group.enkeltminner[0] ??
    group.sikringssoner[0] ??
    group.others[0];
  const props = primary?.properties ?? {};

  // `art` (159 values) is the subtitle; `kategori` is the 12-value bucket.
  const art = firstOf(props, ART_FIELDS);
  const kategori =
    stringify(props['lokaliteteskategori']) ||
    stringify(props['enkeltminnekategori']);

  // kulturminner2 serves no `fylke` and brukerminner do; a kommune name alone
  // is ambiguous nationally.
  const kommune = [stringify(props['kommune']), stringify(props['fylke'])]
    .filter(Boolean)
    .join(', ');

  const members = [
    ...(group.lokalitet ? [group.lokalitet.properties] : []),
    ...group.enkeltminner.map((em) => em.properties),
  ];
  const memberProps = members.length > 0 ? members : [props];
  const vernetypes = memberProps.map((p) => stringify(p['vernetype']));
  const vernetype = rollup(vernetypes, t('kulturminner.ulikeVernestatus'));
  const datering = rollup(
    memberProps.map((p) => firstOf(p, DATERING_FIELDS)),
    t('kulturminner.flereDateringer'),
  );
  // One shared vernetype and date only, or the date would misdate the rest.
  const uniqueVerne = new Set(
    memberProps.map((p) => stringify(p['vernetype'])).filter(Boolean),
  );
  const uniqueVerneDato = new Set(
    memberProps.map((p) => formatDate(p['vernedato'])).filter(Boolean),
  );
  const vernedato =
    uniqueVerne.size === 1 && uniqueVerneDato.size === 1
      ? Array.from(uniqueVerneDato)[0]
      : '';
  const antall =
    group.lokalitet &&
    stringify(group.lokalitet.properties['antallenkeltminner']);
  const informasjon = firstOf(props, DESCRIPTION_FIELDS);
  // Only the synthesized askeladden URL needs the guard: sikringssoner have
  // their own id space, and a kid= from one 404s.
  const hasReal = !!group.lokalitet || group.enkeltminner.length > 0;
  const askeladden =
    stringify(props['linkaskeladden']) ||
    (hasReal && props['lokalid']
      ? `https://askeladden.ra.no/askeladden/?kid=${stringify(props['lokalid'])}`
      : '');
  const kulturminnesok = stringify(props['linkkulturminnesok']);
  // Kulturminnesøk does not have every record Riksantikvaren links to it. The
  // answer arrives after this render, so the link is marked, not withheld.
  const kulturminnesokMissing =
    useKulturminnesokStatus(kulturminnesok) === 'missing';

  // For brukerminner, who reported it takes vernestatus' place.
  const opprettetAv = stringify(props['opprettet_av']);
  const opprettet = formatDate(props['opprettet']);

  // Colour by bucket even when the labels disagreed; mixed buckets go neutral.
  const vernBuckets = new Set(vernetypes.filter(Boolean).map(vernBucket));
  const vernTone: VernBucket =
    vernBuckets.size === 1 ? [...vernBuckets][0] : 'ukjent';

  // With no lokalitet the first enkeltminne is the primary card itself.
  const nested = group.lokalitet
    ? group.enkeltminner
    : group.enkeltminner.slice(1);
  const isSikringssone = !group.lokalitet && group.sikringssoner.length > 0;

  // The rest name their register: "Enkeltminne" over SEFRAK is the wrong noun.
  const kind: FeatureKind = group.lokalitet
    ? 'lokalitet'
    : isSikringssone
      ? 'sikringssone'
      : group.enkeltminner.length > 0
        ? 'enkeltminne'
        : (group.others[0]?.kind ?? 'enkeltminne');
  const kindLabel = t(`kulturminner.${kind}`, {
    defaultValue: primary?.layerTitle ?? '',
  });
  const kindIcon =
    KIND_ICONS[kind] ?? (kategori ? kategoriIcon(kategori) : 'castle');

  // Ids the register owns, only: the synthetic grouping keys are ours.
  const cardId =
    hasReal || isSikringssone
      ? group.parentId.replace(/^sz-/, '')
      : firstOf(props, ID_FIELDS);

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <Tooltip label={[kindLabel, kategori].filter(Boolean).join(' · ')}>
          <span className={styles.kindIcon} tabIndex={0}>
            <Icon icon={kindIcon} size={20} />
          </span>
        </Tooltip>
        <div className={styles.cardTitles}>
          <div className={styles.cardTitle}>
            {group.navn || art || t('kulturminner.fallbackName')}
          </div>
          {group.navn && art && (
            <div className={styles.cardSubtitle}>{art}</div>
          )}
        </div>
        <span className={styles.cardId}>{cardId}</span>
      </div>

      <div className={styles.chips}>
        {isSikringssone && (
          <Badge palette="yellow">{t('kulturminner.sikringssone')}</Badge>
        )}
        {vernetype && (
          <MetaChip
            icon={VERN_ICONS[vernTone]}
            label={t('kulturminner.vernestatus')}
            value={vernedato ? `${vernetype} (${vernedato})` : vernetype}
            tone={vernTone}
            withText={withText}
          />
        )}
        {datering && (
          <MetaChip
            icon="history"
            label={t('kulturminner.datering')}
            value={datering}
            withText={withText}
          />
        )}
        {kommune && (
          <MetaChip
            icon="location_on"
            label={t('kulturminner.kommune')}
            value={kommune}
            withText={withText}
          />
        )}
        {antall && (
          <MetaChip
            icon="scatter_plot"
            label={t('kulturminner.antallEnkeltminner')}
            value={antall}
            withText
          />
        )}
        {opprettetAv && (
          <MetaChip
            icon="person"
            label={t('kulturminner.registrertAv')}
            value={opprettetAv}
            withText={withText}
          />
        )}
        {opprettet && (
          <MetaChip
            icon="event"
            label={t('kulturminner.registrert')}
            value={opprettet}
            withText={withText}
          />
        )}
      </div>

      {informasjon && <Description text={informasjon} />}

      {nested.length > 0 && (
        <NestedEnkeltminner
          features={nested}
          defaultOpen={solo}
          withText={withText}
        />
      )}

      {(askeladden || kulturminnesok) && (
        <>
          <div className={styles.links}>
            {askeladden && (
              <a
                className={styles.link}
                href={askeladden}
                target="_blank"
                rel="noopener noreferrer"
              >
                Askeladden ↗
              </a>
            )}
            {kulturminnesok &&
              (kulturminnesokMissing ? (
                <Tooltip label={t('kulturminner.kulturminnesokMangler')}>
                  <a
                    className={cx(styles.link, styles.linkMissing)}
                    href={kulturminnesok}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Kulturminnesøk ↗
                    <Icon icon="info" size={14} />
                    {/* The glyph says nothing to a screen reader. */}
                    {!withText && (
                      <span className={styles.srOnly}>
                        {t('kulturminner.kulturminnesokMangler')}
                      </span>
                    )}
                  </a>
                </Tooltip>
              ) : (
                <a
                  className={styles.link}
                  href={kulturminnesok}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Kulturminnesøk ↗
                </a>
              ))}
          </div>
          {/* Nothing to hover with, so the warning is written out. */}
          {kulturminnesokMissing && withText && (
            <div className={styles.linkNote}>
              {t('kulturminner.kulturminnesokMangler')}
            </div>
          )}
        </>
      )}
    </div>
  );
};

const PopupContent = ({
  groups,
  onClose,
  onShowMore,
}: {
  groups: HeritageGroup[];
  onClose: () => void;
  onShowMore: () => void;
}) => {
  const { t } = useTranslation();
  // A glyph nobody can hover over is a blank, so the chips carry their text.
  const withText = useMediaQuery('(hover: none)');

  return (
    <div className={styles.popup}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>
          {t('kulturminner.title', { count: groups.length })}
        </span>
        <IconButton
          onClick={onClose}
          icon="close"
          size="xs"
          palette="gray"
          aria-label={t('kulturminner.close')}
        />
      </div>
      <div className={styles.cards}>
        {groups.map((g) => (
          <HeritageCard
            key={g.key}
            group={g}
            solo={groups.length === 1}
            withText={withText}
          />
        ))}
      </div>
      <Button
        className={styles.showMore}
        onClick={onShowMore}
        variant="secondary"
        fullWidth
      >
        {t('kulturminner.showMore')}
      </Button>
    </div>
  );
};

export const KulturminnerPopup = () => {
  const popup = useAtomValue(kulturminnerPopupAtom);
  const setPopup = useSetAtom(kulturminnerPopupAtom);
  const setSelectedResult = useSetAtom(selectedResultAtom);
  const map = useAtomValue(mapAtom);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<Overlay | null>(null);

  if (!containerRef.current) {
    const el = document.createElement('div');
    el.style.pointerEvents = 'none';
    containerRef.current = el;
  }

  useEffect(() => {
    if (!map || !containerRef.current) return;
    const overlay = new Overlay({
      element: containerRef.current,
      positioning: 'bottom-center',
      offset: [0, -16],
      stopEvent: true,
      autoPan: { animation: { duration: 200 } },
    });
    overlayRef.current = overlay;
    map.addOverlay(overlay);
    return () => {
      map.removeOverlay(overlay);
      overlayRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    overlayRef.current?.setPosition(popup?.coordinate);
  }, [popup]);

  const handleShowMore = useCallback(() => {
    if (!popup) return;
    const projection = map
      .getView()
      .getProjection()
      .getCode() as ProjectionIdentifier;
    setSelectedResult(buildCoordinateResult(popup.coordinate, projection));
    setPopup(null);
  }, [popup, map, setSelectedResult, setPopup]);

  if (!popup || !containerRef.current) return null;

  const groups = groupFeatures(popup.layers);

  return createPortal(
    <PopupContent
      groups={groups}
      onClose={() => setPopup(null)}
      onShowMore={handleShowMore}
    />,
    containerRef.current,
  );
};
