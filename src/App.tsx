import './i18n';
import { useAtom } from 'jotai';
import styles from './App.module.css';
import { AuthDialog, pbAuthSyncEffect, ProfileDialog } from './auth';
import { InvitesDialog } from './invites/InvitesDialog.tsx';
import { MapComponent } from './map/MapComponent.tsx';
import { Ribbon } from './ribbon/Ribbon.tsx';

export const App = () => {
  useAtom(pbAuthSyncEffect);

  return (
    <div className={styles.shell}>
      <Ribbon />
      <div className={styles.map}>
        <MapComponent />
      </div>
      <AuthDialog />
      <ProfileDialog />
      <InvitesDialog />
    </div>
  );
};
