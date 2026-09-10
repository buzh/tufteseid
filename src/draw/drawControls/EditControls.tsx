import { useAtom, useAtomValue } from 'jotai';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { snapEnabledAtom } from '../../settings/draw/atoms';
import {
  canRedoAtom,
  canUndoAtom,
  DrawAction,
} from '../../settings/draw/drawActions/atoms';
import {
  useDrawActions,
  useDrawActionsState,
} from '../../settings/draw/drawActions/drawActionsHooks';
import { IconButton, Switch, Tooltip } from '../../ui';
import styles from '../Draw.module.css';
import { StyleChangeDetail } from './hooks/drawEventHandlers';
import { DrawType, useDrawSettings } from './hooks/drawSettings';

type EditControlsProps = {
  drawType: DrawType | null;
};

export const EditControls = ({ drawType }: EditControlsProps) => {
  const { deleteSelected } = useDrawSettings();
  const { addDrawAction } = useDrawActionsState();
  const { undoLast, redoLastUndone } = useDrawActions();
  const canUndoDrawAction = useAtomValue(canUndoAtom);
  const canRedoDrawAction = useAtomValue(canRedoAtom);
  const [snapEnabled, setSnapEnabled] = useAtom(snapEnabledAtom);
  const { t } = useTranslation();

  const featureMovedListener = useCallback(
    (e: Event) => {
      if (e instanceof CustomEvent) {
        const action: DrawAction = {
          type: 'MOVE',
          details: {
            featuresMoved: e.detail,
          },
        };
        addDrawAction(action);
      }
    },
    [addDrawAction],
  );

  const featureStyleChangedListener = useCallback(
    (e: Event) => {
      if (e instanceof CustomEvent) {
        const action: DrawAction = {
          type: 'EDIT_STYLE',
          details: e.detail as StyleChangeDetail[],
        };
        addDrawAction(action);
      }
    },
    [addDrawAction],
  );

  useEffect(() => {
    document.addEventListener('featureMoved', featureMovedListener);
    return () =>
      document.removeEventListener('featureMoved', featureMovedListener);
  }, [featureMovedListener]);

  useEffect(() => {
    document.addEventListener(
      'featureStyleChanged',
      featureStyleChangedListener,
    );
    return () =>
      document.removeEventListener(
        'featureStyleChanged',
        featureStyleChangedListener,
      );
  }, [featureStyleChangedListener]);

  const showSnapControl = drawType === 'LineString' || drawType === 'Polygon';
  const showDeleteControl = drawType === 'Move';

  return (
    <div className={styles.editRow}>
      <div className={styles.editButtons}>
        <Tooltip label={t('draw.controls.tool.tooltip.undo')}>
          <IconButton
            icon="undo"
            aria-label={t('draw.controls.tool.tooltip.undo')}
            disabled={!canUndoDrawAction}
            onClick={undoLast}
          />
        </Tooltip>

        <Tooltip label={t('draw.controls.tool.tooltip.redo')}>
          <IconButton
            icon="redo"
            aria-label={t('draw.controls.tool.tooltip.redo')}
            disabled={!canRedoDrawAction}
            onClick={redoLastUndone}
          />
        </Tooltip>
      </div>
      {showDeleteControl && (
        <Tooltip label={t('draw.controls.tool.tooltip.deleteselected')}>
          <IconButton
            icon="delete"
            aria-label={t('draw.controls.tool.tooltip.deleteselected')}
            palette="red"
            onClick={deleteSelected}
          />
        </Tooltip>
      )}
      {showSnapControl && (
        <Switch
          checked={snapEnabled}
          onChange={setSnapEnabled}
          label={t('draw.controls.snap')}
        />
      )}
    </div>
  );
};
