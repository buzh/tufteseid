import {
  Badge,
  Box,
  Button,
  Dialog,
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  Flex,
  Heading,
  HStack,
  IconButton,
  Input,
  MaterialSymbol,
  Stack,
  Text,
  Tooltip,
} from '@kvib/react';
import type {
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LocalityRecord } from '../api/localities';
import { LidarExtractPanel } from '../lidarExtract/LidarExtractPanel';
import { TerrainPanel } from '../terrain/TerrainPanel';
import { BilderSection } from './BilderSection';
import { FunnDraft } from './FunnDraft';
import { FunnList } from './FunnList';
import { KulturminnerSection } from './KulturminnerSection';
import { LocalityDetails } from './LocalityDetails';
import { BadgePalette, ConfirmPopover, WorkspaceSection } from './ui';
import {
  FLYFOTO_BATCH_MAX,
  FLYFOTO_MOSAIC,
  useLocalityWorkspace,
} from './useLocalityWorkspace';

const VISIBILITY_PALETTE: Record<
  LocalityRecord['visibility'],
  BadgePalette
> = {
  private: 'gray',
  limited: 'yellow',
  public: 'green',
};

// One verb per button, in the sticky bar so it stays reachable however
// far the panel body is scrolled (docs/ui-architecture.md §8.1).
const ActionButton = ({
  icon,
  label,
  tooltip,
  active,
  disabled,
  onClick,
}: {
  icon: MaterialSymbol;
  label: string;
  tooltip: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) => (
  <Tooltip content={tooltip} positioning={{ placement: 'bottom' }}>
    <Button
      size="xs"
      flex="1"
      minW={0}
      px={1.5}
      leftIcon={icon}
      variant={active ? 'primary' : 'secondary'}
      colorPalette="green"
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
    >
      <Text fontSize="11px" lineClamp={1}>
        {label}
      </Text>
    </Button>
  </Tooltip>
);

export const LocalityWorkspace = ({
  locality,
}: {
  locality: LocalityRecord;
}) => {
  const { t } = useTranslation();
  const ws = useLocalityWorkspace(locality);
  const { isMine, mode, user } = ws;

  // Fresh records open straight into the rename field (creation flow:
  // frame first, name after). Both of these belong to the identity row
  // and nothing else reads them, so they stay local — but the row has to
  // be keyed on locality.id, or a swap shows the previous lokalitet's
  // half-typed name.
  const isFreshRecord = locality.name === t('localities.defaultName');
  const [renaming, setRenaming] = useState(isFreshRecord);
  const [name, setName] = useState(locality.name);

  const commitName = async () => {
    setRenaming(false);
    if (!(await ws.rename(name))) setName(locality.name);
  };

  return (
    <Stack
      width="100%"
      maxHeight="calc(100vh - 80px)"
      pointerEvents="auto"
      bg="white"
      shadow="lg"
      m={{ base: 0, md: 1 }}
      mr={{ base: 0, md: 3 }}
      borderRadius="16px"
      overflowY="auto"
      gap={0}
    >
      {/* Header */}
      <Stack gap={1} px={4} pt={3} pb={2}>
        <Flex align="center" gap={1}>
          <IconButton
            icon="arrow_back"
            variant="ghost"
            size="sm"
            aria-label={t('localities.workspace.back')}
            onClick={ws.close}
          />
          {renaming && isMine ? (
            <Input
              size="sm"
              flex="1"
              value={name}
              autoFocus
              maxLength={200}
              placeholder={t('localities.workspace.namePlaceholder')}
              onFocus={(e: ReactFocusEvent<HTMLInputElement>) =>
                e.target.select()
              }
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Enter') commitName();
                if (e.key === 'Escape') {
                  setName(locality.name);
                  setRenaming(false);
                }
              }}
            />
          ) : (
            <Heading
              size="sm"
              flex="1"
              lineClamp={1}
              cursor={isMine ? 'text' : undefined}
              title={isMine ? t('localities.workspace.renameHint') : undefined}
              onClick={() => isMine && setRenaming(true)}
            >
              {locality.name}
            </Heading>
          )}
          <Tooltip content={t('localities.workspace.zoom')}>
            <IconButton
              icon="zoom_in_map"
              variant="ghost"
              size="sm"
              aria-label={t('localities.workspace.zoom')}
              onClick={ws.zoomToLocality}
            />
          </Tooltip>
          {isMine && (
            <ConfirmPopover
              title={t('localities.workspace.confirmDelete', {
                name: locality.name,
              })}
              confirmLabel={t('localities.workspace.deleteLocality')}
              onConfirm={ws.removeLocality}
              trigger={
                <IconButton
                  icon="delete"
                  variant="ghost"
                  colorPalette="red"
                  size="sm"
                  aria-label={t('localities.workspace.deleteLocality')}
                />
              }
            />
          )}
        </Flex>

        {/* At-a-glance: what's in here and how big it is, without
            unfolding a section or scrolling. */}
        <Flex align="center" gap={1.5} wrap="wrap" pl={1}>
          <Badge
            colorPalette={VISIBILITY_PALETTE[locality.visibility]}
            size="sm"
          >
            {t(`localities.visibility.${locality.visibility}`)}
          </Badge>
          {ws.summary.length > 0 && (
            <Text fontSize="xs" color="gray.600">
              {ws.summary.join(' · ')}
            </Text>
          )}
        </Flex>
      </Stack>

      {/* Action bar — sticky so the verbs stay reachable at any scroll
          depth. */}
      <Box
        position="sticky"
        top={0}
        zIndex={1}
        bg="white"
        px={4}
        py={2}
        borderTopWidth="1px"
        borderBottomWidth="1px"
        borderColor="gray.100"
      >
        <HStack gap={1}>
          {isMine && (
            <ActionButton
              icon="add"
              label={t('localities.funn.new')}
              tooltip={`${t('localities.funn.new')} (N)`}
              active={mode === 'draft'}
              onClick={() =>
                ws.draftActive ? ws.cancelDraft() : ws.startDraft()
              }
            />
          )}
          <ActionButton
            icon="crop_free"
            label={t('localities.tools.lidarExtractShort')}
            tooltip={`${t('localities.tools.lidarExtract')} (U)`}
            active={mode === 'lidar'}
            onClick={ws.toggleLidar}
          />
          <ActionButton
            icon="elevation"
            label={t('localities.terrain.short')}
            tooltip={t('localities.terrain.tooltip')}
            active={mode === 'terrain'}
            onClick={ws.toggleTerrain}
          />
          {isMine && (
            <ActionButton
              icon="photo_camera"
              label={t('localities.tools.screenshotShort')}
              tooltip={`${t('localities.tools.screenshot')} (B)`}
              disabled={ws.shooting}
              onClick={ws.takeScreenshot}
            />
          )}
          {isMine && (
            <ActionButton
              icon="satellite_alt"
              label={t('localities.tools.flyfotoShort')}
              tooltip={t('localities.tools.flyfoto')}
              disabled={ws.fetchingFlyfoto}
              onClick={ws.openFlyfotoNotice}
            />
          )}
          {isMine && (
            <ActionButton
              icon="transform"
              label={t('localities.workspace.adjustShort')}
              tooltip={t('localities.workspace.adjust')}
              active={ws.adjusting}
              onClick={ws.toggleAdjusting}
            />
          )}
        </HStack>
      </Box>

      {/* Body. Drawing a funn and running an extract each take over the
          panel: both are multi-step and neither wants the section list
          shifting underneath it. */}
      <Box px={4} pt={3} pb={4}>
        {mode === 'draft' && (
          <FunnDraft
            editing={ws.editingFunnId != null}
            title={ws.funnTitle}
            note={ws.funnNote}
            saving={ws.savingFunn}
            error={ws.funnError}
            onTitle={ws.setFunnTitle}
            onNote={ws.setFunnNote}
            onSave={ws.saveDraft}
            onCancel={ws.cancelDraft}
          />
        )}

        {mode === 'lidar' && (
          <Stack gap={2}>
            <Flex justify="space-between" align="center">
              <Text fontSize="sm" fontWeight="bold">
                {t('localities.tools.lidarExtract')}
              </Text>
              <IconButton
                icon="close"
                size="xs"
                variant="ghost"
                aria-label={t('localities.tools.closeLidar')}
                onClick={ws.closeLidar}
              />
            </Flex>
            <LidarExtractPanel />
          </Stack>
        )}

        {mode === 'terrain' && (
          <Stack gap={2}>
            <Flex justify="space-between" align="center">
              <Text fontSize="sm" fontWeight="bold">
                {t('localities.terrain.heading')}
              </Text>
              <IconButton
                icon="close"
                size="xs"
                variant="ghost"
                aria-label={t('localities.terrain.close')}
                onClick={ws.toggleTerrain}
              />
            </Flex>
            <TerrainPanel />
          </Stack>
        )}

        {mode === 'browse' && (
          <Stack gap={3}>
            <WorkspaceSection
              id="funn"
              title={t('localities.funn.heading')}
              count={ws.funnCount}
              countPalette="green"
            >
              <FunnList
                items={ws.findItems}
                editable={isMine}
                selectedId={ws.selectedFunnId}
                onSelect={ws.selectFunn}
                onStatus={ws.changeStatus}
                onSaveMeta={ws.saveFunnMeta}
                onEditGeometry={ws.startGeometryEdit}
                onDelete={ws.removeFunn}
              />
            </WorkspaceSection>

            <WorkspaceSection
              id="bilder"
              title={t('localities.bilder.heading')}
              count={ws.bilderCount}
            >
              {user && (
                <BilderSection
                  locality={locality}
                  userId={user.id}
                  isMine={isMine}
                  items={ws.attachmentItems}
                  setItems={ws.setAttachmentItems}
                />
              )}
            </WorkspaceSection>

            <WorkspaceSection
              id="kulturminner"
              title={t('localities.kulturminner.heading')}
              count={ws.kmCount}
              countPalette="yellow"
            >
              <KulturminnerSection
                result={ws.kulturminner.result}
                error={ws.kulturminner.error}
              />
            </WorkspaceSection>

            <WorkspaceSection
              id="detaljer"
              title={t('localities.workspace.details')}
            >
              <LocalityDetails
                locality={locality}
                isMine={isMine}
                onPatch={ws.patchLocality}
              />
            </WorkspaceSection>
          </Stack>
        )}
      </Box>

      {/* Grow-to-fit: the bbox is authored, so a funn that escapes it
          prompts rather than silently resizing. */}
      <Dialog
        open={ws.growPrompt != null}
        placement="center"
        onOpenChange={(e) => !e.open && ws.cancelGrow()}
      >
        <DialogContent>
          <DialogBody p={5}>
            <Stack gap={4}>
              <Text fontSize="sm">{t('localities.funn.growConfirm')}</Text>
              <HStack justify="flex-end">
                <Button size="sm" variant="tertiary" onClick={ws.cancelGrow}>
                  {t('localities.funn.draft.cancel')}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  colorPalette="green"
                  onClick={ws.confirmGrow}
                >
                  {t('localities.funn.growConfirmAction')}
                </Button>
              </HStack>
            </Stack>
          </DialogBody>
          <DialogCloseTrigger />
        </DialogContent>
      </Dialog>

      {/* Licensing notice shown before every flyfoto grab: NiB imagery is
          free for private use, but publishing or commercial use is the
          user's own responsibility. Confirm runs the fetch. */}
      <Dialog
        open={ws.flyfotoNotice}
        placement="center"
        onOpenChange={(e) => !e.open && ws.closeFlyfotoNotice()}
      >
        <DialogContent>
          <DialogBody p={5}>
            <Stack gap={4}>
              <Heading size="sm">
                {t('localities.tools.flyfotoNoticeTitle')}
              </Heading>
              <Text fontSize="sm">{t('localities.tools.flyfotoNotice')}</Text>
              <HStack justify="flex-end">
                <Button
                  size="sm"
                  variant="tertiary"
                  onClick={ws.closeFlyfotoNotice}
                >
                  {t('localities.funn.draft.cancel')}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  colorPalette="green"
                  onClick={ws.openFlyfotoPicker}
                >
                  {t('localities.tools.flyfotoConfirm')}
                </Button>
              </HStack>
            </Stack>
          </DialogBody>
          <DialogCloseTrigger />
        </DialogContent>
      </Dialog>

      {/* Acquisition picker. NiB keeps every ortofoto project flown over
          an area back to the 1930s, so the same ground can be kept as a
          temporal stack rather than only as today's best mosaic. */}
      <Dialog
        open={ws.flyfotoPicker}
        placement="center"
        onOpenChange={(e) => !e.open && ws.closeFlyfotoPicker()}
      >
        <DialogContent>
          <DialogBody p={5}>
            <Stack gap={4}>
              <Heading size="sm">
                {t('localities.tools.flyfotoPickerTitle')}
              </Heading>

              <HStack justify="space-between" gap={3}>
                <Stack gap={0}>
                  <Text fontSize="sm" fontWeight="medium">
                    {t('localities.tools.flyfotoMosaic')}
                  </Text>
                  <Text fontSize="xs" color="fg.muted">
                    {t('localities.tools.flyfotoMosaicHint')}
                  </Text>
                </Stack>
                <Button
                  size="xs"
                  variant="primary"
                  colorPalette="green"
                  disabled={ws.fetchingFlyfoto}
                  onClick={() => ws.runFlyfoto()}
                >
                  {ws.flyfotoBusy === FLYFOTO_MOSAIC
                    ? t('localities.tools.flyfotoFetching')
                    : t('localities.tools.flyfotoGrab')}
                </Button>
              </HStack>

              {ws.flyfotoProjects === null && (
                <Text fontSize="sm" color="fg.muted">
                  {t('localities.tools.flyfotoProjectsLoading')}
                </Text>
              )}

              {ws.flyfotoProjectsError && (
                <Text fontSize="sm" color="red.600">
                  {t('localities.tools.flyfotoProjectsFailed')}
                </Text>
              )}

              {ws.flyfotoProjects !== null &&
                !ws.flyfotoProjectsError &&
                ws.flyfotoProjects.length === 0 && (
                  <Text fontSize="sm" color="fg.muted">
                    {t('localities.tools.flyfotoProjectsNone')}
                  </Text>
                )}

              {ws.flyfotoProjects !== null && ws.flyfotoProjects.length > 0 && (
                <Stack gap={2}>
                  <HStack justify="space-between">
                    <Text fontSize="sm" fontWeight="medium">
                      {t('localities.tools.flyfotoProjectsHeading', {
                        count: ws.flyfotoProjects.length,
                      })}
                    </Text>
                    <Button
                      size="xs"
                      variant="secondary"
                      disabled={ws.fetchingFlyfoto}
                      onClick={ws.runFlyfotoAll}
                    >
                      {t('localities.tools.flyfotoGrabAll', {
                        count: Math.min(
                          ws.flyfotoProjects.length,
                          FLYFOTO_BATCH_MAX,
                        ),
                      })}
                    </Button>
                  </HStack>

                  {ws.flyfotoProjects.length > FLYFOTO_BATCH_MAX && (
                    <Text fontSize="xs" color="fg.muted">
                      {t('localities.tools.flyfotoGrabAllHint', {
                        count: FLYFOTO_BATCH_MAX,
                      })}
                    </Text>
                  )}

                  <Stack gap={1} maxH="40vh" overflowY="auto">
                    {ws.flyfotoProjects.map((project) => (
                      <HStack
                        key={project.id}
                        justify="space-between"
                        gap={3}
                        py={1}
                      >
                        <Stack gap={0} minW={0}>
                          <Text fontSize="sm">
                            {project.year ?? project.projectName}
                          </Text>
                          <Text
                            fontSize="xs"
                            color="fg.muted"
                            whiteSpace="nowrap"
                            textOverflow="ellipsis"
                            overflow="hidden"
                          >
                            {project.photoDate
                              ? `${project.photoDate} · ${project.projectName}`
                              : project.projectName}
                          </Text>
                        </Stack>
                        <Button
                          size="xs"
                          variant="tertiary"
                          flexShrink={0}
                          disabled={ws.fetchingFlyfoto}
                          onClick={() => ws.runFlyfoto(project)}
                        >
                          {ws.flyfotoBusy === project.id
                            ? t('localities.tools.flyfotoFetching')
                            : t('localities.tools.flyfotoGrab')}
                        </Button>
                      </HStack>
                    ))}
                  </Stack>
                </Stack>
              )}

              <HStack justify="flex-end">
                <Button
                  size="sm"
                  variant="tertiary"
                  disabled={ws.fetchingFlyfoto}
                  onClick={ws.closeFlyfotoPicker}
                >
                  {t('localities.tools.flyfotoClose')}
                </Button>
              </HStack>
            </Stack>
          </DialogBody>
          <DialogCloseTrigger />
        </DialogContent>
      </Dialog>
    </Stack>
  );
};
