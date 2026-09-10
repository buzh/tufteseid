// The ribbon's `lidar` tool surface (docs/ui-architecture.md §10):
// pick styles + sources → fetch + stitch → preview and download.
//
// Each source renders at its native ground resolution — no per-run
// resolution picker. Styles are chosen once for the whole run and applied
// to every enabled source that advertises them, which avoids unchecking
// 'skyggerelieff' on every dataset in turn.
//
// Laid out for a wide row: the run controls sit on one line with the
// selection size, and the sources are a wrapping grid of cards. As a
// full-width `space-between` list they degenerated into long thin lines with
// the name at one end and the badges at the other.

import { useAtom, useSetAtom } from 'jotai';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, cx, Spinner } from '../ui';
import {
  lidarExtractRunAtom,
  lidarExtractSelectionAtom,
  lidarExtractSourcesAtom,
  lidarExtractViewerOpenAtom,
} from './atoms';
import styles from './LidarExtractPanel.module.css';
import { cancelExtraction, startExtraction, StylesBySource } from './run';
import {
  enumerateLidarSources,
  LidarSource,
  nativeResolutionMetersPerPx,
} from './sources';
import { MAX_CANVAS_PX_PER_SIDE } from './stitch';
import { useDrawSelection } from './useDrawSelection';

// skyggerelieff is the default hillshade every LiDAR source advertises;
// keep it at the top of the style list so the most-common toggle is
// always in the same spot.
const STYLE_ORDER_HEAD = ['skyggerelieff'];

export const LidarExtractPanel = () => {
  const { t } = useTranslation();
  useDrawSelection();
  const [selection, setSelection] = useAtom(lidarExtractSelectionAtom);
  const [sources, setSources] = useAtom(lidarExtractSourcesAtom);
  const [, setRun] = useAtom(lidarExtractRunAtom);
  const setViewerOpen = useSetAtom(lidarExtractViewerOpenAtom);
  const [enabledStyles, setEnabledStyles] = useState<Set<string>>(new Set());
  const [disabledSources, setDisabledSources] = useState<Set<string>>(
    new Set(),
  );
  const [enumerating, setEnumerating] = useState(false);

  // Enumerate sources whenever the selection changes. Seeds "all styles
  // enabled, all sources enabled" so the user can Run immediately.
  useEffect(() => {
    if (!selection) {
      setSources(null);
      setEnabledStyles(new Set());
      setDisabledSources(new Set());
      return;
    }
    let cancelled = false;
    setEnumerating(true);
    enumerateLidarSources(selection.bboxLonLat)
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
  }, [selection, setSources]);

  const allStyles = useMemo(() => sortedStyles(sources ?? []), [sources]);

  const drawAgain = () => {
    cancelExtraction();
    setRun(null);
    setViewerOpen(false);
    setSelection(null);
  };

  const canRun = useMemo(() => {
    if (!selection || !sources || sources.length === 0) return false;
    return sources.some(
      (s) =>
        !disabledSources.has(s.key) &&
        s.styles.some((st) => enabledStyles.has(st)),
    );
  }, [selection, sources, enabledStyles, disabledSources]);

  const handleRun = () => {
    if (!selection || !sources) return;
    const stylesBySource: StylesBySource = {};
    const active: LidarSource[] = [];
    for (const s of sources) {
      if (disabledSources.has(s.key)) continue;
      const activeStyles = s.styles.filter((st) => enabledStyles.has(st));
      if (activeStyles.length === 0) continue;
      stylesBySource[s.key] = activeStyles;
      active.push(s);
    }
    startExtraction(selection.bbox25833, active, stylesBySource);
    setViewerOpen(true);
  };

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

  const spanM = selection
    ? {
        w: Math.round(selection.bbox25833[2] - selection.bbox25833[0]),
        h: Math.round(selection.bbox25833[3] - selection.bbox25833[1]),
      }
    : null;

  if (!selection) {
    return (
      <div className={styles.empty}>
        <p className={styles.lead}>{t('lidarExtract.instructions.drawBox')}</p>
        <p className={styles.hint}>{t('lidarExtract.instructions.drawHint')}</p>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.bar}>
        <span className={styles.selection}>
          <span className={styles.label}>
            {t('lidarExtract.selection.label')}
          </span>
          {spanM && `${formatMeters(spanM.w)} × ${formatMeters(spanM.h)}`}
        </span>

        {/* Kept together and to the right: "Tegn nytt" throws the selection
            away, so it should never sit under the pointer on its way to
            "Hent". */}
        <div className={styles.actions}>
          <Button
            variant="ghost"
            size="sm"
            leftIcon="crop_free"
            onClick={drawAgain}
          >
            {t('lidarExtract.actions.redraw')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!canRun}
            onClick={handleRun}
          >
            {t('lidarExtract.actions.run')}
          </Button>
        </div>
      </div>

      {enumerating && (
        <div className={styles.busy}>
          <Spinner size={14} />
          {t('lidarExtract.sources.loading')}
        </div>
      )}

      {!enumerating && sources && sources.length === 0 && (
        <p className={styles.hint}>{t('lidarExtract.sources.none')}</p>
      )}

      {!enumerating && sources && sources.length > 0 && spanM && (
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
