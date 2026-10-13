import {
  Alert,
  Menu,
  Popover,
  ScrollArea,
  SegmentedControl,
  Slider,
  Text,
  Tooltip,
} from '@mantine/core';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { EvidenceRecord } from '../api/evidence';
import type { SpotRecord } from '../api/spots';
import { evidenceTitle, KIND_ICON } from '../evidence/labels';
import { mayRetry } from '../evidence/queue';
import {
  AUTO_SOURCE,
  evidenceMatches,
  rendersOnServer,
  rvtSpec,
  RVT_BLENDS,
  sunLoopSpec,
  SUN_LOOP_DEFAULTS,
  type EvidenceSpec,
  type SunLoopSettings,
} from '../evidence/spec';
import type { SpotEvidence } from '../evidence/useSpotEvidence';
import { bboxToMetric, type Bbox } from '../map/bbox';
import { mosaicTiles } from '../map/grid';
import {
  demProjectFacts,
  fetchDemProjects,
  type DemProject,
} from '../terrain/demProjects';
import { ControlButton } from '../ui/ControlButton';
import { ControlChip } from '../ui/ControlChip';
import { ControlUnit } from '../ui/ControlUnit';
import { Icon } from '../ui/Icon';
import { useConfirm } from '../ui/useConfirm';
import styles from './SpotBox.module.css';

const STEP_CHOICES = [5, 10, 15] as const;

type Catalogue = {
  projects: DemProject[];
  loading: boolean;
  failed: boolean;
};

const EMPTY: Catalogue = { projects: [], loading: false, failed: false };

const useDemProjects = (footprint: Bbox | null): Catalogue => {
  const key = footprint?.join(',') ?? '';
  const bbox = useMemo(
    () => footprint,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  const [state, setState] = useState<Catalogue>(EMPTY);

  useEffect(() => {
    if (!bbox) {
      setState(EMPTY);
      return;
    }
    const ac = new AbortController();
    setState({ ...EMPTY, loading: true });
    fetchDemProjects(bbox, { signal: ac.signal })
      .then((projects) => {
        if (!ac.signal.aborted) setState({ ...EMPTY, projects });
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        console.warn('[renders] acquisition list failed', err);
        setState({ ...EMPTY, failed: true });
      });
    return () => ac.abort();
  }, [bbox]);

  return state;
};

const Gutter = ({ on }: { on: boolean }) =>
  on ? <Icon icon="check" size={18} /> : <span className={styles.gutter} />;

const SourceMenu = ({
  value,
  catalogue,
  onChange,
}: {
  value: string;
  catalogue: Catalogue;
  onChange: (source: string) => void;
}) => {
  const { t } = useTranslation();
  const { projects, loading, failed } = catalogue;
  const chosen = projects.find((p) => p.name === value) ?? null;

  const short = chosen
    ? demProjectFacts(chosen) || chosen.name
    : value === AUTO_SOURCE
      ? t('renders.source.autoShort')
      : value;
  const title =
    value === AUTO_SOURCE
      ? `${t('renders.source.auto')} — ${t('renders.source.autoHint')}`
      : chosen
        ? `${chosen.name} · ${demProjectFacts(chosen)}`
        : value;

  const facts = (project: DemProject) =>
    [
      demProjectFacts(project),
      project.metresPerPx != null
        ? t('evidence.resolution', { m: project.metresPerPx.toFixed(2) })
        : null,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <Menu width={300} position="bottom-end">
      <Menu.Target>
        <ControlChip
          className={styles.renderSource}
          label={short}
          title={title}
          aria-label={title}
        />
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          onClick={() => onChange(AUTO_SOURCE)}
          leftSection={<Gutter on={value === AUTO_SOURCE} />}
        >
          <Text size="sm">{t('renders.source.auto')}</Text>
          <Text size="xs" c="dimmed">
            {t('renders.source.autoHint')}
          </Text>
        </Menu.Item>

        <ScrollArea.Autosize mah={300} type="scroll">
          {loading && (
            <Menu.Item disabled>{t('renders.source.loading')}</Menu.Item>
          )}
          {failed && (
            <Menu.Item disabled leftSection={<Icon icon="warning" size={18} />}>
              {t('renders.source.failed')}
            </Menu.Item>
          )}
          {!loading && !failed && projects.length === 0 && (
            <Menu.Item disabled>{t('renders.source.none')}</Menu.Item>
          )}
          {projects.map((project) => (
            <Menu.Item
              key={project.name}
              onClick={() => onChange(project.name)}
              leftSection={<Gutter on={value === project.name} />}
            >
              <Text size="sm">{project.name}</Text>
              <Text size="xs" c="dimmed">
                {facts(project)}
              </Text>
            </Menu.Item>
          ))}
        </ScrollArea.Autosize>
      </Menu.Dropdown>
    </Menu>
  );
};

const SliderRow = ({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) => (
  <div>
    <Text size="xs" c="dimmed">
      {label} {value}
      {suffix}
    </Text>
    <Slider
      size="xs"
      mt={6}
      min={min}
      max={max}
      step={step}
      value={value}
      thumbLabel={label}
      onChange={onChange}
    />
  </div>
);

const SunLoopMenu = ({
  value,
  onChange,
}: {
  value: SunLoopSettings;
  onChange: (next: SunLoopSettings) => void;
}) => {
  const { t } = useTranslation();
  const label = t('renders.settings');

  return (
    <Popover width={250} position="bottom-end" withArrow>
      <Popover.Target>
        <ControlButton icon="settings" title={label} aria-label={label} />
      </Popover.Target>
      <Popover.Dropdown>
        <SliderRow
          label={t('renders.sun.altitude')}
          value={value.altitude}
          min={5}
          max={85}
          step={1}
          suffix="°"
          onChange={(altitude) => onChange({ ...value, altitude })}
        />
        <SliderRow
          label={t('renders.sun.zFactor')}
          value={value.zFactor}
          min={1}
          max={8}
          step={0.5}
          suffix="×"
          onChange={(zFactor) => onChange({ ...value, zFactor })}
        />
        <Text size="xs" c="dimmed" mt="xs">
          {t('renders.sun.frames')}
        </Text>
        <SegmentedControl
          fullWidth
          size="xs"
          mt={6}
          value={String(value.stepDeg)}
          data={STEP_CHOICES.map((stepDeg) => ({
            value: String(stepDeg),
            label: String(Math.round(360 / stepDeg)),
          }))}
          onChange={(stepDeg) =>
            onChange({ ...value, stepDeg: Number(stepDeg) })
          }
        />
      </Popover.Dropdown>
    </Popover>
  );
};

const RenderLine = ({
  spec,
  about,
  note,
  state,
  source,
  catalogue,
  settings,
  onSource,
  onPlay,
}: {
  spec: EvidenceSpec;
  about: string;
  note: string;
  state: 'ready' | 'kept' | 'rendering' | 'blocked';
  source: string;
  catalogue: Catalogue;
  settings?: ReactNode;
  onSource: (source: string) => void;
  onPlay: (spec: EvidenceSpec) => void;
}) => {
  const { t } = useTranslation();
  const play = useConfirm(() => onPlay(spec));
  const label = evidenceTitle(spec);
  const title = `${label} — ${about}`;
  const pressLabel = play.armed ? t('renders.confirm') : note;

  return (
    <ControlUnit className={styles.renderLine}>
      <ControlChip
        className={styles.renderName}
        icon={KIND_ICON[spec.kind]}
        label={label}
        readout
        withChevron={false}
        title={title}
        aria-label={title}
      />
      <SourceMenu value={source} catalogue={catalogue} onChange={onSource} />
      {settings}
      <Tooltip label={pressLabel}>
        <ControlButton
          className={styles.renderPlay}
          icon={
            state === 'kept'
              ? 'check'
              : state === 'rendering'
                ? 'hourglass_top'
                : 'play_arrow'
          }
          on={play.armed}
          disabled={state !== 'ready'}
          aria-label={pressLabel}
          onClick={play.press}
        />
      </Tooltip>
    </ControlUnit>
  );
};

export const SpotRenders = ({
  spot,
  evidence,
}: {
  spot: SpotRecord;
  evidence: SpotEvidence;
}) => {
  const { t } = useTranslation();
  const [sun, setSun] = useState<SunLoopSettings>(SUN_LOOP_DEFAULTS);
  const [sources, setSources] = useState<Record<string, string>>({});
  const tiles = useMemo(
    () => (spot.footprint ? mosaicTiles(spot.footprint) : []),
    [spot.footprint],
  );
  const multiTile = tiles.length > 1;
  const renderBox = tiles[0] ?? null;
  const catalogue = useDemProjects(renderBox);

  const ordered = (evidence.items ?? []).filter((rec) =>
    rendersOnServer(rec.kind),
  );

  const onItsWay = (rec: EvidenceRecord) =>
    !rec.file && !mayRetry(evidence.stateOf(rec));

  const landed = (rec: EvidenceRecord) => rec.file !== '';

  const outstanding = ordered.some(onItsWay);

  const metric = renderBox ? bboxToMetric(renderBox) : null;
  const matching = (spec: EvidenceSpec) =>
    metric != null
      ? ordered.filter((rec) => evidenceMatches(rec, spec, metric))
      : [];

  const sourceOf = (key: string) => sources[key] ?? AUTO_SOURCE;
  const pick = (key: string, source: string) =>
    setSources((prev) => ({ ...prev, [key]: source }));

  const lines = [
    {
      key: 'sunloop',
      about: t('renders.sunLoopHint'),
      spec: sunLoopSpec(sourceOf('sunloop'), sun),
      settings: <SunLoopMenu value={sun} onChange={setSun} />,
    },
    ...RVT_BLENDS.map((vis) => ({
      key: vis,
      about: t('renders.rvtHint'),
      spec: rvtSpec(vis, sourceOf(vis)),
      settings: undefined,
    })),
  ];

  return (
    <div className={styles.renders}>
      {lines.map((line) => {
        const mine = matching(line.spec);
        const state = !spot.footprint
          ? 'blocked'
          : multiTile
            ? 'blocked'
            : mine.some(onItsWay)
              ? 'rendering'
              : mine.some(landed)
                ? 'kept'
                : outstanding
                  ? 'blocked'
                  : 'ready';
        const note = !spot.footprint
          ? t('acquire.noFootprint')
          : multiTile
            ? t('renders.largeSite')
            : state === 'rendering'
              ? t('evidence.rendering')
              : state === 'kept'
                ? t('evidence.kept')
                : state === 'blocked'
                  ? t('renders.busy')
                  : t('renders.play');

        return (
          <RenderLine
            key={line.key}
            spec={line.spec}
            about={line.about}
            note={note}
            state={state}
            source={sourceOf(line.key)}
            catalogue={catalogue}
            settings={line.settings}
            onSource={(source) => pick(line.key, source)}
            onPlay={evidence.keep}
          />
        );
      })}

      {evidence.failed && (
        <Alert color="red" p="xs">
          {t('evidence.failed')}
        </Alert>
      )}
    </div>
  );
};
