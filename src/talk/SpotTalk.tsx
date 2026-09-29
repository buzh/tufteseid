// The thread on a spot, served by the remark42 sidecar under /remark42.
//
// The widget is fetched from our own origin at runtime rather than bundled, so
// it costs no dependency and the app's `script-src 'self'` covers it. Its own
// chrome is English: remark42 ships no Norwegian locale, and the strings around
// it here are the only nb in the box.

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
      // The canonical short link, not the current address: `/?lok=…` carries
      // the map's own parameters, and the thread key has to survive both those
      // and a rename.
      url: shareUrlOf(spot.code),
      theme: 'dark',
      locale: 'en',
      components: ['embed'],
      page_title: spot.name,
    };
    // The widget reads remark42's session once, when it is created, so the
    // silent sign-in has to have finished by then — mounting first and
    // priming after would show the reader a sign-in button they do not need.
    // `primeRemarkSession` gives up rather than hangs, and a reader who is a
    // guest here is a guest there too.
    const session = signedIn ? primeRemarkSession() : Promise.resolve(false);

    // Hence the ordering: the embed script creates an instance out of
    // `window.remark_config` the moment it evaluates, and throws if there is
    // none, so the config is set first and the script appended only once the
    // session is primed. Loading the two in parallel raced the widget against
    // the round trip, and a widget already created is one `createInstance`
    // reuses rather than re-reads the session for.
    session
      .then(() => {
        // A box closed mid-trip has taken the mount node with it, and the
        // script would evaluate against nothing.
        if (!live) return;
        window.remark_config = config;
        return loadEmbed();
      })
      .then(() => {
        if (!live) return;
        instance = window.REMARK42?.createInstance(config);
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
