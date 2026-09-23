// What the armed `+` says out loud: click the ground the spot is on.
//
// The pin riding the cursor is the real answer and this is the caption under
// it. It is here for the two readers the cursor cannot reach — the one who
// pressed `+` without watching the pointer, and the one on a touch screen,
// where there is no cursor to put a pin on at all — and it carries the way out
// as well, because `Esc` is otherwise a key nobody was told about.
//
// Top centre, which is the one edge of the map that is free: the terrain box
// has the top left and the spot box the top right, and both can be up while a
// second spot is being placed.

import { useTranslation } from 'react-i18next';

import styles from './SpotBox.module.css';

export const SpotPlacePrompt = () => {
  const { t } = useTranslation();
  return (
    <div className={styles.prompt} role="status">
      {t('spots.placeHint')}
      <span className={styles.promptKey}>{t('spots.placeEscape')}</span>
    </div>
  );
};
