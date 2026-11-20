import { ActionIcon, Badge, Text, Tooltip } from '@mantine/core';
import { IconCode } from '@tabler/icons-react';
import type { Element, Src } from '@ncv/core';
import { createContext, useContext, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** What every view can ask the device page: show some lines of the original config. */
export interface DeviceViewApi {
  showSource(src: Src): void;
}

export const DeviceViewContext = createContext<DeviceViewApi>({ showSource: () => undefined });

export const useDeviceView = () => useContext(DeviceViewContext);

/** First and last line of a source, or null when the element is not written in the file. */
export function sourceRange(src: Src): [number, number] | null {
  if (src.length === 0) return null;
  let first = Infinity;
  let last = 0;
  for (const [a, b] of src) {
    first = Math.min(first, a);
    last = Math.max(last, b);
  }
  return [first, last];
}

/** Button that opens the config at the lines an element comes from. */
export function SourceButton({ src, testId }: { src: Src; testId?: string }) {
  const { t } = useTranslation();
  const { showSource } = useDeviceView();
  const range = sourceRange(src);
  if (!range) {
    return (
      <Tooltip label={t('source.notWritten')}>
        <Text span size="xs" c="dimmed" data-testid={testId}>
          —
        </Text>
      </Tooltip>
    );
  }
  const label =
    range[0] === range[1]
      ? t('source.line', { line: range[0] })
      : t('source.lines', { first: range[0], last: range[1] });
  return (
    <Tooltip label={label}>
      <ActionIcon
        variant="subtle"
        size="sm"
        aria-label={label}
        onClick={(event) => {
          event.stopPropagation();
          showSource(src);
        }}
        data-testid={testId ?? 'btn-source'}
      >
        <IconCode size={16} />
      </ActionIcon>
    </Tooltip>
  );
}

/**
 * A value that may come from the vendor default instead of the file: shown in italics with a
 * note, and with a "to be checked" badge when the default is not confirmed yet.
 */
export function Value({
  element,
  field,
  children,
}: {
  element: Element;
  field: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const isDefault = element.defaults?.includes(field) ?? false;
  const unverified = element.unverified?.includes(field) ?? false;
  if (!isDefault) return <>{children}</>;
  return (
    <Tooltip
      label={unverified ? t('source.defaultUnverified') : t('source.default')}
      multiline
      maw={320}
    >
      <Text span inherit fs="italic" c="dimmed" data-default={unverified ? 'unverified' : 'yes'}>
        {children}
        {unverified && (
          <Badge size="xs" color="orange" variant="light" ml={4} tt="none" fs="normal">
            {t('source.toCheck')}
          </Badge>
        )}
      </Text>
    </Tooltip>
  );
}
