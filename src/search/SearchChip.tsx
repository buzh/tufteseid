import { Combobox, Text, useCombobox } from '@mantine/core';
import { useAtomValue } from 'jotai';
import { transform } from 'ol/proj';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { mapAtom } from '../map/atoms';
import { cx } from '../ui/cx';
import { Icon } from '../ui/Icon';
import styles from './SearchChip.module.css';
import {
  MIN_QUERY_LENGTH,
  useSearch,
  type SearchHit,
  type SearchHitKind,
} from './useSearch';

const DROPDOWN_WIDTH = 320;
const FLY_DURATION_MS = 400;

const KINDS = [
  'coordinate',
  'place',
  'address',
] as const satisfies readonly SearchHitKind[];

const GROUP_KEY = {
  coordinate: 'search.group.coordinate',
  place: 'search.group.place',
  address: 'search.group.address',
} as const satisfies Record<SearchHitKind, string>;

export const SearchChip = () => {
  const { t } = useTranslation();
  const map = useAtomValue(mapAtom);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const { hits, busy } = useSearch(query);

  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
  });

  const ready = query.trim().length >= MIN_QUERY_LENGTH;

  const collapse = () => {
    setQuery('');
    setOpen(false);
    combobox.closeDropdown();
    field.current?.blur();
  };

  const fly = (hit: SearchHit) => {
    const view = map.getView();
    view.animate({
      center: transform(hit.at, hit.projection, view.getProjection()),
      zoom: Math.max(view.getZoom() ?? 0, hit.zoom),
      duration: FLY_DURATION_MS,
    });
  };

  const option = (hit: SearchHit) => (
    <Combobox.Option key={hit.key} value={hit.key}>
      <div className={styles.row}>
        <Icon icon={hit.icon} size={18} className={styles.rowIcon} />
        <div className={styles.rowText}>
          <Text size="sm" truncate>
            {hit.name}
          </Text>
          {hit.detail && (
            <Text size="xs" c="dimmed" truncate>
              {hit.detail}
            </Text>
          )}
        </div>
      </div>
    </Combobox.Option>
  );

  const groups = KINDS.map((kind) => {
    const found = hits.filter((hit) => hit.kind === kind);
    return found.length ? (
      <Combobox.Group key={kind} label={t(GROUP_KEY[kind])}>
        {found.map(option)}
      </Combobox.Group>
    ) : null;
  });

  return (
    <Combobox
      store={combobox}
      width={DROPDOWN_WIDTH}
      position="bottom-end"
      shadow="md"
      withinPortal
      onOptionSubmit={(value) => {
        const hit = hits.find((candidate) => candidate.key === value);
        if (hit) fly(hit);
        collapse();
      }}
    >
      <div className={styles.box}>
        <Icon icon="search" size={18} className={styles.icon} />
        {}
        <Combobox.Target withExpandedAttribute autoComplete="off">
          <input
            ref={field}
            type="text"
            className={cx(styles.field, open && styles.fieldOpen)}
            placeholder={t('search.placeholder')}
            aria-label={t('search.label')}
            title={open ? undefined : t('search.label')}
            maxLength={100}
            value={query}
            onFocus={() => {
              setOpen(true);
              if (ready) combobox.openDropdown();
            }}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              combobox.resetSelectedOption();
              if (event.currentTarget.value.trim().length >= MIN_QUERY_LENGTH) {
                combobox.openDropdown();
              } else {
                combobox.closeDropdown();
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') collapse();
            }}

            onBlur={collapse}
          />
        </Combobox.Target>
        {open && query !== '' && (
          <button
            type="button"
            className={styles.clear}
            aria-label={t('search.clear')}

            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setQuery('');
              combobox.closeDropdown();
              field.current?.focus();
            }}
          >
            <Icon icon="close" size={14} />
          </button>
        )}
      </div>

      {}
      <Combobox.Dropdown onMouseDown={(event) => event.preventDefault()}>
        <Combobox.Options className={styles.options}>
          {groups}
          {!hits.length && (
            <Combobox.Empty>
              {!ready
                ? t('search.tooShort', { least: MIN_QUERY_LENGTH })
                : busy
                  ? t('search.searching')
                  : t('search.noMatch')}
            </Combobox.Empty>
          )}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
};
