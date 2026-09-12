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

// The Kulturminner WMS returns each feature under a sublayer element name
// (Lokaliteter_layer / Enkeltminner_layer / Sikringssoner_layer, plus their
// *ikoner duplicates). parseXmlFeatureInfo loses that element name, so we
// re-derive the sublayer kind from the property fingerprint.
const refineHeritageSitesKind = (
  properties: Record<string, unknown>,
): FeatureKind => {
  if ('enkeltminneart' in properties || 'lokalitetid' in properties)
    return 'enkeltminne';
  if ('lokalitetsart' in properties || 'antallenkeltminner' in properties)
    return 'lokalitet';
  // Sikringssoner have very few fields — a kulturminneid but no navn,
  // no vernetype, no lokalitetsart, no enkeltminneart.
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

const getParentId = (feature: HeritageFeature, fallbackIndex: number): string => {
  const p = feature.properties;
  if (feature.kind === 'enkeltminne') {
    // lokalitetid preferred; fallback to lokalid split on "-"
    const lokalitetid = stringify(p['lokalitetid']);
    if (lokalitetid) return lokalitetid;
    const lokalid = stringify(p['lokalid']);
    if (lokalid) return lokalid.split('-')[0];
  }
  if (feature.kind === 'lokalitet') {
    // Some records have a suffixed id like "300651-0"; the parent lokalitetid
    // used by enkeltminner is the numeric prefix. Strip it so the enkeltminner
    // land in the same group.
    const raw =
      stringify(p['kulturminneid']) ||
      stringify(p['lokalid']) ||
      stringify(p['lokalitetid']);
    if (raw) return raw.split('-')[0];
    return `lok-${fallbackIndex}`;
  }
  if (feature.kind === 'sikringssone') {
    // Sikringssoner have their own id space; keep them as their own group.
    return 'sz-' + (stringify(p['lokalid']) || stringify(p['kulturminneid']) || fallbackIndex);
  }
  return (
    stringify(p['lokalid']) ||
    stringify(p['kulturminneid']) ||
    stringify(p['objid']) ||
    `other-${fallbackIndex}`
  );
};

const toHeritageFeatures = (
  layers: LayerFeatureInfo[],
): HeritageFeature[] => {
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

  // Dedupe *ikoner duplicates: same kind + same identifying id.
  const dedupeKey = (f: HeritageFeature) =>
    `${f.kind}::${stringify(f.properties['lokalid']) || stringify(f.properties['kulturminneid'])}`;
  const seen = new Map<string, HeritageFeature>();
  for (const f of features) {
    const k = dedupeKey(f);
    const prev = seen.get(k);
    if (!prev || Object.keys(f.properties).length > Object.keys(prev.properties).length) {
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

  // Fill navn: lokalitet.navn → first enkeltminne.navn → the layer's own
  // title for the four registers that aren't kulturminner2. Left **empty**
  // when the record is genuinely unnamed — a great many are — so the card can
  // fall back to its `art`, which is both more informative and not the word
  // "Kulturminne" repeated down the popup.
  for (const g of groups.values()) {
    const fromLokalitet = stringify(g.lokalitet?.properties['navn']);
    const fromEnkeltminne = stringify(g.enkeltminner[0]?.properties['navn']);
    if (fromLokalitet) g.navn = fromLokalitet;
    else if (fromEnkeltminne) g.navn = fromEnkeltminne;
    else if (g.others.length > 0) g.navn = g.others[0].layerTitle;
  }

  const all = Array.from(groups.values());

  // Kulturminnesøk doesn't surface sikringssoner as first-class results —
  // they're implicit protection metadata for a lokalitet. Drop pure
  // sikringssone groups when there's any real POI in the click; otherwise
  // keep them so a lone sikringssone click still shows something.
  const hasReal = all.some((g) => g.lokalitet || g.enkeltminner.length > 0);
  if (hasReal) {
    return all.filter((g) => g.lokalitet || g.enkeltminner.length > 0 || g.others.length > 0);
  }
  return all;
};

// Roll up a field across a lokalitet + its enkeltminner, following the
// Kulturminnesøk pattern: if the values agree, show the shared value;
// if they disagree, show a "Flere/Ulike …" aggregate label.
const rollup = (
  values: string[],
  aggregateLabel: string,
): string => {
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

/*
 * One fact, as a glyph. The label:value list this replaced spent a line and a
 * 100 px label column on each of five fields — for values that are mostly one
 * word out of a closed vocabulary ("Tønsberg", "Automatisk fredet") — which
 * left a three-hit click needing a scroll before the first `informasjon` was
 * in view.
 *
 * Hover or focus names the field and spells the value out. On a device with
 * no hover there is nothing to hover *with*, so the chip carries its text
 * instead: `(hover: none)` is the one case where the density is not worth it.
 * The value is in the DOM either way, for a screen reader.
 */
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
  // The tooltip stays on even when the text is showing: the chip's *value* is
  // then visible but its field name never is, and "Tønsberg" alone does not
  // say kommune.
  <Tooltip label={`${label}: ${value}`}>
    <span
      className={cx(styles.chip, tone && styles[tone])}
      // Icon-only, focus is the only keyboard route to the value, so it needs
      // a tab stop. With the text out it would only be a tab stop.
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

/*
 * `informasjon` runs from empty to several paragraphs and is the field most
 * worth reading, so it is open by default and clamped rather than hidden
 * behind a button. The toggle appears only when the clamp actually bit, which
 * has to be measured: a character count and a line clamp disagree at the
 * popup's narrow width, and a "Mer" that expands nothing is worse than none.
 *
 * Two reasons that measurement is an observer rather than one layout effect.
 * The overlay's element is `display: none` until the OL `Overlay` is given a
 * position, which happens in an effect of the *parent* — i.e. after this
 * one — so a single measurement at mount reads 0 for both heights and the
 * toggle never appears. And the popup can be resized under an open card.
 * Nothing observes while expanded: with the clamp off the two heights agree by
 * construction, and measuring then would retract the button that undoes it.
 */
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
        <Icon
          icon={open ? 'keyboard_arrow_down' : 'chevron_right'}
          size={16}
        />
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
  const primary = group.lokalitet ?? group.enkeltminner[0] ?? group.sikringssoner[0] ?? group.others[0];
  const props = primary?.properties ?? {};

  // `art` is the informative one — 159 values, from "Gravfelt" to
  // "Tjærebrenningsanlegg" — so it stays text and becomes the card's subtitle,
  // or its title when the record is unnamed. `kategori` is the 12-value bucket
  // above it and is the leading glyph; printing both was printing the second
  // one twice.
  const art =
    stringify(props['lokalitetsart']) || stringify(props['enkeltminneart']);
  const kategori =
    stringify(props['lokaliteteskategori']) ||
    stringify(props['enkeltminnekategori']);

  // The WMS serves no `fylke` — beliggenhet is the kommune and nothing else.
  const kommune = stringify(props['kommune']);

  // Roll up vernetype + datering across the lokalitet's own field AND all
  // its nested enkeltminner. If they agree, show the value; if not, show
  // the "Ulike vernestatus" / "Flere dateringer" aggregate label the way
  // Kulturminnesøk does.
  const memberProps = [
    ...(group.lokalitet ? [group.lokalitet.properties] : []),
    ...group.enkeltminner.map((em) => em.properties),
  ];
  const vernetypes = memberProps.map((p) => stringify(p['vernetype']));
  const vernetype = rollup(vernetypes, t('kulturminner.ulikeVernestatus'));
  const datering = rollup(
    memberProps.map((p) => stringify(p['datering'])),
    t('kulturminner.flereDateringer'),
  );
  // vernedato only if there's a single shared vernetype AND a single shared
  // date across all members; otherwise a single date next to "Ulike
  // vernestatus" would misrepresent when the mixed statuses were assigned.
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
    group.lokalitet && stringify(group.lokalitet.properties['antallenkeltminner']);
  const informasjon = stringify(props['informasjon']);
  // Links only apply to real POIs — sikringssoner have their own id space
  // and a synthesized askeladden URL for a sikringssone id doesn't resolve.
  const hasReal = !!group.lokalitet || group.enkeltminner.length > 0;
  const askeladden = hasReal
    ? stringify(props['linkaskeladden']) ||
      (props['lokalid']
        ? `https://askeladden.ra.no/askeladden/?kid=${stringify(props['lokalid'])}`
        : '')
    : '';
  const kulturminnesok = hasReal ? stringify(props['linkkulturminnesok']) : '';

  // Colour the vernestatus chip by bucket even when the labels disagreed: two
  // members reading "Automatisk fredet" and "Vedtaksfredet" are both fredet,
  // so "Ulike vernestatus" in red is the true statement. Only a genuine
  // disagreement about *how protected* it is falls back to neutral.
  const vernBuckets = new Set(vernetypes.filter(Boolean).map(vernBucket));
  const vernTone: VernBucket =
    vernBuckets.size === 1 ? [...vernBuckets][0] : 'ukjent';

  // If we have a lokalitet, all enkeltminner nest below it. Otherwise the
  // first enkeltminne IS the primary card, so nest the remaining.
  const nested = group.lokalitet
    ? group.enkeltminner
    : group.enkeltminner.slice(1);
  const isSikringssone = !group.lokalitet && group.sikringssoner.length > 0;

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <Tooltip
          label={[
            group.lokalitet
              ? t('kulturminner.lokalitet')
              : isSikringssone
                ? t('kulturminner.sikringssone')
                : t('kulturminner.enkeltminne'),
            kategori,
          ]
            .filter(Boolean)
            .join(' · ')}
        >
          <span className={styles.kindIcon} tabIndex={0}>
            <Icon icon={kategori ? kategoriIcon(kategori) : 'castle'} size={20} />
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
        <span className={styles.cardId}>
          {group.parentId.replace(/^sz-/, '')}
        </span>
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
          {kulturminnesok && (
            <a
              className={styles.link}
              href={kulturminnesok}
              target="_blank"
              rel="noopener noreferrer"
            >
              Kulturminnesøk ↗
            </a>
          )}
        </div>
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
  // A glyph nobody can hover over is a blank. Coarse pointers get the value
  // spelled out on the chip instead — see MetaChip.
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

