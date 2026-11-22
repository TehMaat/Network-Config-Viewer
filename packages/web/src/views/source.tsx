import { ActionIcon, Badge, Text, Tooltip } from '@mantine/core';
import { IconCode, IconTerminal2 } from '@tabler/icons-react';
import type { DeviceState, Element, Src, StateItem } from '@ncv/core';
import { createContext, useContext, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Peer } from '../state/infra';

/** What every view can ask the device page: show some lines of the original config. */
export interface DeviceViewApi {
  showSource(src: Src): void;
  /** Real state from the shows of the device, or null when none is loaded. */
  state: DeviceState | null;
  /** Opens another file (a file of shows) at a line. */
  openFile(id: string, line?: number): void;
  fileName(id: string): string;
  /** Base of the names of the files exported from the views: the hostname of the device. */
  exportName: string;
  /** The other side of the links of the device, from the map of the client (#15). */
  peers: Peer[];
}

export const DeviceViewContext = createContext<DeviceViewApi>({
  showSource: () => undefined,
  state: null,
  openFile: () => undefined,
  fileName: (id) => id,
  exportName: 'export',
  peers: [],
});

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

/** Button that opens the file of shows at the lines a value of the real state comes from. */
export function ShowSourceButton({ item }: { item: StateItem }) {
  const { t } = useTranslation();
  const { openFile, fileName } = useDeviceView();
  const range = sourceRange(item.src);
  if (!range || !item.file) return null;
  const label = t('source.showLine', { file: fileName(item.file), line: range[0] });
  return (
    <Tooltip label={label}>
      <ActionIcon
        variant="subtle"
        size="sm"
        color="teal"
        aria-label={label}
        onClick={(event) => {
          event.stopPropagation();
          openFile(item.file!, range[0]);
        }}
        data-testid="btn-show-source"
      >
        <IconTerminal2 size={16} />
      </ActionIcon>
    </Tooltip>
  );
}
