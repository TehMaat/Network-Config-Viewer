import { CloseButton, ScrollArea, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import type { Outline } from '@ncv/core';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const MAX_SHOWN = 2000;

interface Props {
  outline: Outline;
  onSelect(line: number): void;
}

/** The main blocks of the file: a click jumps to the block in the viewer. */
export function OutlinePanel({ outline, onSelect }: Props) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const [debounced] = useDebouncedValue(filter, 150);

  const matches = useMemo(() => {
    const needle = debounced.trim().toLowerCase();
    if (!needle) return outline.entries;
    return outline.entries.filter((e) => e.label.toLowerCase().includes(needle));
  }, [outline, debounced]);
  const shown = matches.slice(0, MAX_SHOWN);

  return (
    <Stack gap={0} h="100%" data-testid="outline">
      <TextInput
        size="xs"
        m="xs"
        placeholder={t('viewer.outlineFilter')}
        aria-label={t('viewer.outlineFilter')}
        leftSection={<IconSearch size={14} />}
        value={filter}
        onChange={(event) => setFilter(event.currentTarget.value)}
        rightSection={
          filter ? (
            <CloseButton
              size="sm"
              aria-label={t('viewer.clearFilter')}
              onClick={() => setFilter('')}
            />
          ) : null
        }
      />
      <ScrollArea flex={1} type="auto" scrollbars="y" offsetScrollbars>
        <Stack gap={0} pb="sm">
          {outline.entries.length === 0 && (
            <Text size="sm" c="dimmed" px="sm">
              {t('viewer.outlineEmpty')}
            </Text>
          )}
          {outline.entries.length > 0 && matches.length === 0 && (
            <Text size="sm" c="dimmed" px="sm">
              {t('viewer.outlineNoMatch')}
            </Text>
          )}
          {shown.map((entry) => (
            <UnstyledButton
              key={entry.line}
              className="ncv-outline-entry"
              data-testid="outline-entry"
              data-line={entry.line}
              style={{ paddingLeft: 10 + entry.depth * 14 }}
              title={entry.label}
              onClick={() => onSelect(entry.line)}
            >
              <Text size="xs" ff="monospace" truncate="end" span display="block">
                {entry.label}
              </Text>
            </UnstyledButton>
          ))}
          {matches.length > MAX_SHOWN && (
            <Text size="xs" c="dimmed" px="sm" pt="xs">
              {t('viewer.outlineLimited', { count: MAX_SHOWN })}
            </Text>
          )}
          {outline.truncated && (
            <Text size="xs" c="dimmed" px="sm" pt="xs">
              {t('viewer.outlineTruncated', { count: outline.entries.length })}
            </Text>
          )}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
