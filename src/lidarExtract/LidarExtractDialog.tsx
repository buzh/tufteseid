/*
 * `Hent → LiDAR-uttrekk`: which datasets, read which ways
 * (docs/lokalitet-view.md §4.3, §6).
 *
 * What is left of the old dock panel, and it is the half that was worth
 * keeping: the source-and-style grid. Everything downstream of pressing go —
 * the fetch, the progress line, the fullscreen preview, the keep and the
 * download — is the picker carousel now, so this dialog's whole output is a
 * list of proposals.
 *
 * Two things went with the demotion.
 *
 * **The drawable sub-selection.** §6's invariant is that *every image in a
 * lokalitet covers the lokalitet's rectangle*, and this was the one producer
 * that could break it. The filmstrip's value is that the ground does not move
 * as you walk it; one image over a hand-drawn sub-rectangle breaks register
 * for the whole strip. So the extent is `locality.bbox`, like everywhere else,
 * and `Tegn nytt` is gone rather than disabled.
 *
 * **`Hent alle` as an act.** Checking eight boxes used to mean eight saved
 * images. It now means eight proposals, fetched one ahead of where you are
 * standing, most of which will never be requested.
 *
 * Styles are still chosen once for the whole run and applied to every enabled
 * source that advertises them — the alternative is unchecking 'skyggerelieff'
 * on each dataset in turn.
 */

import { transformExtent } from 'ol/proj';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalityWorkspaceApi } from '../localities/useLocalityWorkspace';
import { Button, cx, Dialog, Spinner } from '../ui';
import styles from './LidarExtractDialog.module.css';
import {
  enumerateLidarSources,
  LidarSource,
  nativeResolutionMetersPerPx,
} from './sources';
import { MAX_CANVAS_PX_PER_SIDE } from './stitch';

// skyggerelieff is the default hillshade every LiDAR source advertises;
// keep it at the top of the style list so the most-common toggle is
// always in the same spot.
const STYLE_ORDER_HEAD = ['skyggerelieff'];

export const LidarExtractDialog = ({ ws }: { ws: LocalityWorkspaceApi }) => {
  const { t } = useTranslation();
  const open = ws.tool === 'lidar';
  const bbox = ws.locality.bbox;
  const [sources, setSources] = useState<LidarSource[] | null>(null);
  const [enabledStyles, setEnabledStyles] = useState<Set<string>>(new Set());
  const [disabledSources, setDisabledSources] = useState<Set<string>>(
    new Set(),
  );
  const [enumerating, setEnumerating] = useState(false);

  // Keyed on the values rather than the array, which is a fresh identity on
  // every record update — "Juster området" should re-enumerate, a rename
  // should not.
  const bboxKey = bbox.join(',');

  // Enumerate while the dialog is up, and seed "everything checked" so the
  // common case is one press. Local state rather than an atom since the
  // panel stopped being a dock resident: nothing outside this dialog has
  // ever read the list.
  useEffect(() => {
    if (!open) {
      setSources(null);
      setEnabledStyles(new Set());
      setDisabledSources(new Set());
      return;
    }
    let cancelled = false;
    setEnumerating(true);
    // DTM: this dialog is the multi-source grid, and it has never offered a
    // model. `Behold` is the entrance that follows the ground on screen.
    enumerateLidarSources(bbox, 'dtm')
      .then((list) => {
        if (cancelled) return;
        setSources(list);
        const allStyles = new Set<string>();
        for (const s of list) s.styles.forEach((st) => allStyles.add(st));
        setEnabledStyles(allStyles);
        setDisabledSources(new Set());
      })
      .catch(() => {
        if (!cancelled) setSources([]);
      })
      .finally(() => {
        if (!cancelled) setEnumerating(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bboxKey]);

  const allStyles = useMemo(() => sortedStyles(sources ?? []), [sources]);

  const spanM = useMemo(() => {
    const b = transformExtent(bbox, 'EPSG:4326', 'EPSG:25833');
    return { w: Math.round(b[2] - b[0]), h: Math.round(b[3] - b[1]) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bboxKey]);

  // What pressing `Hent` would propose — also the button's own count, so the
  // number on it is the number of cards you are about to be shown.
  const plans = useMemo(() => {
    const out: { source: LidarSource; styles: string[] }[] = [];
    for (const source of sources ?? []) {
      if (disabledSources.has(source.key)) continue;
      const active = source.styles.filter((st) => enabledStyles.has(st));
      if (active.length > 0) out.push({ source, styles: active });
    }
    return out;
  }, [sources, enabledStyles, disabledSources]);

  const count = plans.reduce((n, p) => n + p.styles.length, 0);

  const toggleStyle = (style: string) => {
    setEnabledStyles((prev) => {
      const next = new Set(prev);
      if (next.has(style)) next.delete(style);
      else next.add(style);
      return next;
    });
  };

  const toggleSource = (sourceKey: string) => {
    setDisabledSources((prev) => {
      const next = new Set(prev);
      if (next.has(sourceKey)) next.delete(sourceKey);
      else next.add(sourceKey);
      return next;
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && ws.closeLidar()}
      title={t('localities.tools.lidarExtract')}
      closeLabel={t('shared.close')}
      footer={
        <>
          <Button size="sm" palette="gray" onClick={ws.closeLidar}>
            {t('shared.cancel')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={count === 0}
            onClick={() => ws.startLidarPicker(plans)}
          >
            {t('localities.tools.lidarRun', { count })}
          </Button>
        </>
      }
    >
      <div className={styles.root}>
        <p className={styles.hint}>
          {t('localities.tools.lidarExtent', {
            width: formatMeters(spanM.w),
            height: formatMeters(spanM.h),
          })}
        </p>

        {enumerating && (
          <div className={styles.busy}>
            <Spinner size={14} />
            {t('lidarExtract.sources.loading')}
          </div>
        )}

        {!enumerating && sources && sources.length === 0 && (
          <p className={styles.hint}>{t('lidarExtract.sources.none')}</p>
        )}

        {!enumerating && sources && sources.length > 0 && (
          <>
            <div className={styles.field}>
              <span className={styles.label}>
                {t('lidarExtract.styles.label')}
              </span>
              <div className={styles.checks}>
                {allStyles.map((style) => (
                  <label key={style} className={styles.check}>
                    <input
                      type="checkbox"
                      checked={enabledStyles.has(style)}
                      onChange={() => toggleStyle(style)}
                    />
                    <span>{style}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.label}>
                {t('lidarExtract.sources.label')}
              </span>
              <div className={styles.sources}>
                {sources.map((source) => (
                  <SourceCard
                    key={source.key}
                    source={source}
                    spanM={spanM}
                    enabled={!disabledSources.has(source.key)}
                    onToggle={() => toggleSource(source.key)}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
};

const SourceCard = ({
  source,
  spanM,
  enabled,
  onToggle,
}: {
  source: LidarSource;
  spanM: { w: number; h: number };
  enabled: boolean;
  onToggle: () => void;
}) => {
  const { t } = useTranslation();
  const mpp = nativeResolutionMetersPerPx(source);
  const rawW = Math.max(1, Math.round(spanM.w / mpp));
  const rawH = Math.max(1, Math.round(spanM.h / mpp));
  const scale = Math.min(1, MAX_CANVAS_PX_PER_SIDE / Math.max(rawW, rawH));
  const outW = Math.round(rawW * scale);
  const outH = Math.round(rawH * scale);
  const capped = scale < 1;
  const effectiveMpp = spanM.w / outW;
  const resLabel = capped
    ? `~${effectiveMpp.toFixed(2)} m/px (${t('lidarExtract.sources.capped')})`
    : `~${mpp} m/px`;
  const badges = [
    source.year != null ? String(source.year) : null,
    source.pointDensity,
    resLabel,
    `${outW}×${outH} px`,
  ].filter((x): x is string => x != null);

  return (
    // The whole card is the label, so the click target is the card rather
    // than a 13 px box in its corner.
    <label className={cx(styles.card, !enabled && styles.cardOff)}>
      <span className={styles.cardHead}>
        <input type="checkbox" checked={enabled} onChange={onToggle} />
        <span className={styles.cardTitle}>{source.label}</span>
      </span>
      <span className={styles.badges}>
        {badges.map((b) => (
          <span key={b} className={styles.badge}>
            {b}
          </span>
        ))}
      </span>
    </label>
  );
};

function sortedStyles(sources: LidarSource[]): string[] {
  const all = new Set<string>();
  for (const s of sources) s.styles.forEach((st) => all.add(st));
  const head = STYLE_ORDER_HEAD.filter((s) => all.has(s));
  const rest = Array.from(all)
    .filter((s) => !STYLE_ORDER_HEAD.includes(s))
    .sort();
  return [...head, ...rest];
}

function formatMeters(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km`;
  return `${m} m`;
}
