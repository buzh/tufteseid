import { Button, Group, Popover, Stack, Text } from '@mantine/core';
import { useAtomValue } from 'jotai';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ControlChip } from '../ui/ControlChip';
import { Icon } from '../ui/Icon';
import {
  probeNow,
  upstreamHealthAtom,
  type OriginStatus,
} from '../upstream/health';
import { ORIGIN_IDS, type OriginId } from '../upstream/origins';
import styles from './Ribbon.module.css';

// Inside the dropdown, which Mantine mounts on open and unmounts on close, so
// the one-second tick does not run behind a closed popover.
const RetryCountdown = ({ at }: { at: number }) => {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <>
      {t('upstream.retryIn', {
        seconds: Math.max(0, Math.ceil((at - now) / 1000)),
      })}
    </>
  );
};

// Mounted only while something is down, so `opened` cannot survive one outage
// and spring the popover open at the next.
const OutagePopover = ({
  down,
  health,
}: {
  down: OriginId[];
  health: Record<OriginId, OriginStatus>;
}) => {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(false);

  const waiting = (status: OriginStatus) =>
    status.probing || status.nextProbeAt == null ? (
      t('upstream.probing')
    ) : (
      <RetryCountdown at={status.nextProbeAt} />
    );

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      width={320}
      position="bottom-end"
      shadow="md"
      withinPortal
    >
      <Popover.Target>
        <ControlChip
          warn
          icon="cloud_off"
          label={
            down.length === 1
              ? t(`upstream.origin.${down[0]}`)
              : t('upstream.severalDown', { count: down.length })
          }
          hint={t('upstream.notAnswering')}
          onClick={() => setOpened((o) => !o)}
        />
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Text size="xs" c="dimmed">
            {t('upstream.explain')}
          </Text>
          {down.map((id) => (
            <div key={id} className={styles.outage}>
              <Text size="sm" fw={600}>
                {t(`upstream.origin.${id}`)}
              </Text>
              <Text size="xs" c="dimmed">
                {t(`upstream.affects.${id}`)}
              </Text>
              <Group gap="xs" justify="space-between" wrap="nowrap" mt={4}>
                <Text size="xs" c="dimmed">
                  {waiting(health[id])}
                </Text>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  leftSection={<Icon icon="refresh" size={14} />}
                  disabled={health[id].probing}
                  onClick={() => probeNow(id)}
                >
                  {t('upstream.retryNow')}
                </Button>
              </Group>
            </div>
          ))}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
};

export const UpstreamStatus = () => {
  const health = useAtomValue(upstreamHealthAtom);
  const down = ORIGIN_IDS.filter((id) => health[id].down);
  if (down.length === 0) return null;
  return <OutagePopover down={down} health={health} />;
};
