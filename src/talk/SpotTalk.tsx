// The thread on a spot, served by the remark42 sidecar under /remark42. The
// widget is fetched from our own origin at runtime rather than bundled, so it
// costs no dependency and `script-src 'self'` covers it. Its own chrome is
// English — remark42 ships no Norwegian locale.

import { Alert, Loader } from '@mantine/core';
import { useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { primeRemarkSession, REMARK_SITE, remarkHost } from '../api/remark42';
import type { SpotRecord } from '../api/spots';
import { isSignedInAtom } from '../auth/atoms';
import { spotTalkingAtom } from '../spots/atoms';
import { shareUrlOf } from '../spots/shareLink';
import { VoteControl } from '../spots/VoteControl';
import { Panel } from '../ui/Panel';
import styles from './SpotTalk.module.css';

const EMBED_SRC = '/remark42/web/embed.mjs';

/** The widget looks this up by id; only ever one thread is mounted. */
const MOUNT_ID = 'remark42';

type RemarkConfig = {
  host: string;
  site_id: string;
  url: string;
  theme: 'light' | 'dark';
  locale: string;
  components: string[];
  page_title: string;
};

type RemarkInstance = { destroy?: () => void };

declare global {
  interface Window {
    remark_config?: RemarkConfig;
    REMARK42?: { createInstance: (c: RemarkConfig) => RemarkInstance };
  }
}

let embed: Promise<void> | null = null;

/** Once per session. A module script, so the browser dedupes a second append
 *  anyway — but the promise is what later mounts wait on. */
const loadEmbed = (): Promise<void> => {
  embed ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = EMBED_SRC;
    script.onload = () => resolve();
    script.onerror = () => {
      // Cleared so closing and reopening the box retries; a sidecar that was
      // down at first press is often up at the second.
      embed = null;
      reject(new Error('remark42 embed failed to load'));
    };
    document.head.append(script);
  });
  return embed;
};

export const SpotTalk = ({ spot }: { spot: SpotRecord }) => {
  const { t } = useTranslation();
  const setTalking = useSetAtom(spotTalkingAtom);
  const signedIn = useAtomValue(isSignedInAtom);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  // Re-checked here rather than trusted from the caller: an unlisted thread is
  // the only thing keeping a private spot's discussion private.
  const isPublic = spot.visibility === 'public';

  useEffect(() => {
    if (!isPublic) return;

    let live = true;
    let instance: RemarkInstance | undefined;

    const config: RemarkConfig = {
      host: remarkHost(),
      site_id: REMARK_SITE,
      // The thread key. The canonical short link rather than the current
      // address, which carries the map's own parameters.
      url: shareUrlOf(spot.code),
      theme: 'dark',
      locale: 'en',
      components: ['embed'],
      page_title: spot.name,
    };
    const session = signedIn ? primeRemarkSession() : Promise.resolve(false);

    // Strict ordering. The embed script creates an instance out of
    // `window.remark_config` the moment it evaluates and throws if there is
    // none, and the widget reads remark42's session only at creation — so the
    // config is set first and the script appended only once the silent
    // sign-in has finished. In parallel, the widget wins the race and the
    // later `createInstance` reuses it rather than re-reading the session.
    session
      .then(() => {
        // A box closed mid-trip took the mount node with it.
        if (!live) return;
        window.remark_config = config;
        return loadEmbed();
      })
      .then(() => {
        if (!live) return;
        // A script that loaded without defining this did not load.
        const remark = window.REMARK42;
        if (!remark) throw new Error('remark42 embed defined no REMARK42');
        instance = remark.createInstance(config);
        setReady(true);
      })
      .catch((err) => {
        if (!live) return;
        console.warn('[talk] embed failed', err);
        setFailed(true);
      });

    return () => {
      live = false;
      instance?.destroy?.();
    };
  }, [isPublic, signedIn, spot.code, spot.name]);

  return (
    <Panel
      className={styles.panel}
      icon="forum"
      title={spot.name}
      status={t('talk.title')}
      actions={<VoteControl spot={spot} />}
      onClose={() => setTalking(false)}
    >
      {!isPublic ? (
        <Alert color="gray" p="xs">
          {t('talk.privateSpot')}
        </Alert>
      ) : failed ? (
        <Alert color="red" p="xs">
          {t('talk.failed')}
        </Alert>
      ) : (
        <>
          {!ready && <Loader size="sm" className={styles.loader} />}
          <div id={MOUNT_ID} className={styles.thread} />
        </>
      )}
    </Panel>
  );
};
