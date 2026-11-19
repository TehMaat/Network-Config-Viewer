import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconCopy,
  IconDownload,
  IconFold,
  IconFoldDown,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLock,
  IconSearch,
} from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { baseName, formatBytes, formatOrigin, formatPath } from '../format';
import { contentStore } from '../state/content';
import { effectiveDetection } from '../state/effective';
import type { FileEntry, Overrides, TextEntry } from '../state/files';
import { ConfigEditor, type EditorHandle } from './ConfigEditor';
import { DetectionPanel } from './DetectionPanel';
import { OutlinePanel } from './OutlinePanel';

interface Props {
  entry: FileEntry;
  onOverride(id: string, overrides: Overrides): void;
}

export function FileView({ entry, onOverride }: Props) {
  if (entry.type === 'issue') return <IssueView entry={entry} />;
  return <TextView key={entry.id} entry={entry} onOverride={onOverride} />;
}

function IssueView({ entry }: { entry: Extract<FileEntry, { type: 'issue' }> }) {
  const { t, i18n } = useTranslation();
  return (
    <Stack p="md" gap="md">
      <Box>
        <Title order={3} style={{ overflowWrap: 'anywhere' }} data-testid="file-title">
          {baseName(entry.path.at(-1) ?? '')}
        </Title>
        <Text size="sm" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
          {formatPath(entry.path)}
          {entry.size !== undefined && ` · ${formatBytes(entry.size, i18n.language)}`}
        </Text>
      </Box>
      <Alert
        color="orange"
        icon={<IconAlertTriangle />}
        title={t('issues.title')}
        data-testid="issue-alert"
        data-code={entry.code}
      >
        {t(`issues.${entry.code}`, { message: entry.message ?? '' })}
      </Alert>
    </Stack>
  );
}

function TextView({ entry, onOverride }: { entry: TextEntry; onOverride: Props['onOverride'] }) {
  const { t, i18n } = useTranslation();
  const editor = useRef<EditorHandle>(null);
  const [showOutline, setShowOutline] = useState(true);
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null);
  const effective = useMemo(
    () => effectiveDetection(entry.detection, entry.overrides),
    [entry.detection, entry.overrides],
  );
  // The heavy content lives outside React state; the structure version tells when it changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const content = useMemo(() => contentStore.get(entry.id), [entry.id, entry.structureVersion]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2500);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!content) return null;

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(content.text);
      setCopied('ok');
    } catch {
      setCopied('failed');
    }
  };

  const download = () => {
    const blob = new Blob([content.bytes as Uint8Array<ArrayBuffer>], {
      type: 'application/octet-stream',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = entry.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const goToLine = (line: number) => editor.current?.goToLine(line);
  const origin = formatOrigin(entry.path, entry.name);
  const encoding = entry.bom
    ? t('file.bom', { encoding: entry.encoding.toUpperCase() })
    : entry.encoding.toUpperCase();
  const outlineAvailable = entry.family !== 'plain';

  return (
    <Stack gap={0} className="ncv-file-view">
      <Box p="md" pb="sm" className="ncv-file-header">
        <Group justify="space-between" align="flex-start" gap="xs" mb="sm">
          <Box miw={0}>
            <Title order={3} style={{ overflowWrap: 'anywhere' }} data-testid="file-title">
              {entry.name}
            </Title>
            {origin && (
              <Text
                size="sm"
                c="dimmed"
                style={{ overflowWrap: 'anywhere' }}
                data-testid="file-origin"
              >
                {origin}
              </Text>
            )}
          </Box>
          <Group gap={6}>
            <Badge variant="default" tt="none">
              {formatBytes(entry.size, i18n.language)}
            </Badge>
            <Badge variant="default" tt="none" data-testid="badge-encoding">
              {encoding}
            </Badge>
            <Badge variant="default" tt="none" data-testid="badge-eol" data-value={entry.eol}>
              {t('file.eol')}: {t(`eol.${entry.eol}`)}
            </Badge>
            <Badge variant="default" tt="none">
              {t('file.lines', { count: entry.lineCount })}
            </Badge>
          </Group>
        </Group>
        <DetectionPanel
          effective={effective}
          overrides={entry.overrides}
          onOverride={(overrides) => onOverride(entry.id, overrides)}
          onGoToLine={goToLine}
        />
        {effective.encrypted && (
          <Alert
            color="orange"
            icon={<IconLock />}
            title={t('encrypted.title')}
            mt="sm"
            data-testid="encrypted-alert"
          >
            {t('encrypted.message')}
          </Alert>
        )}
        {entry.diagnostics.length > 0 && (
          <Alert
            color="yellow"
            variant="light"
            mt="sm"
            p="xs"
            title={t('viewer.diagnosticsTitle')}
            data-testid="diagnostics"
          >
            <Stack gap={2}>
              {entry.diagnostics.slice(0, 5).map((d) => (
                <Text
                  key={`${d.line}-${d.code}`}
                  size="xs"
                  component="button"
                  type="button"
                  className="ncv-link-button"
                  onClick={() => goToLine(d.line)}
                >
                  {t('diagnostics.atLine', { line: d.line, message: t(`diagnostics.${d.code}`) })}
                </Text>
              ))}
            </Stack>
          </Alert>
        )}
      </Box>

      <Group gap={4} px="md" py={6} className="ncv-toolbar" wrap="wrap">
        {outlineAvailable && (
          <Tooltip label={showOutline ? t('viewer.hideOutline') : t('viewer.showOutline')}>
            <ActionIcon
              variant="subtle"
              onClick={() => setShowOutline((v) => !v)}
              aria-label={showOutline ? t('viewer.hideOutline') : t('viewer.showOutline')}
              visibleFrom="sm"
            >
              {showOutline ? (
                <IconLayoutSidebarLeftCollapse size={18} />
              ) : (
                <IconLayoutSidebarLeftExpand size={18} />
              )}
            </ActionIcon>
          </Tooltip>
        )}
        <Button
          size="compact-sm"
          variant="subtle"
          leftSection={<IconSearch size={16} />}
          onClick={() => editor.current?.openSearch()}
          data-testid="btn-search"
        >
          {t('viewer.search')}
        </Button>
        {outlineAvailable && (
          <>
            <Button
              size="compact-sm"
              variant="subtle"
              leftSection={<IconFold size={16} />}
              onClick={() => editor.current?.foldAll()}
              data-testid="btn-fold-all"
            >
              {t('viewer.foldAll')}
            </Button>
            <Button
              size="compact-sm"
              variant="subtle"
              leftSection={<IconFoldDown size={16} />}
              onClick={() => editor.current?.unfoldAll()}
              data-testid="btn-unfold-all"
            >
              {t('viewer.unfoldAll')}
            </Button>
          </>
        )}
        <Box flex={1} />
        {copied && (
          <Text size="xs" c={copied === 'ok' ? 'teal' : 'red'} data-testid="copy-feedback">
            {copied === 'ok' ? t('viewer.copied') : t('viewer.copyFailed')}
          </Text>
        )}
        <Button
          size="compact-sm"
          variant="subtle"
          leftSection={<IconCopy size={16} />}
          onClick={() => void copyAll()}
          data-testid="btn-copy"
        >
          {t('viewer.copy')}
        </Button>
        <Button
          size="compact-sm"
          variant="subtle"
          leftSection={<IconDownload size={16} />}
          onClick={download}
          data-testid="btn-download"
        >
          {t('viewer.download')}
        </Button>
      </Group>

      <Group gap={0} align="stretch" wrap="nowrap" className="ncv-viewer-body">
        {outlineAvailable && showOutline && (
          <Box className="ncv-outline" visibleFrom="sm">
            <OutlinePanel outline={content.outline} onSelect={goToLine} />
          </Box>
        )}
        <Box className="ncv-editor-wrap">
          {!outlineAvailable && (
            <Text size="xs" c="dimmed" px="md" py={4} className="ncv-plain-note">
              {t('viewer.plain')}
            </Text>
          )}
          <ConfigEditor
            ref={editor}
            text={content.text}
            eol={entry.eol}
            family={entry.family}
            folds={content.folds}
          />
        </Box>
      </Group>
    </Stack>
  );
}
