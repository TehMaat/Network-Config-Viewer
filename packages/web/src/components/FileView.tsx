import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Select,
  Stack,
  Switch,
  Tabs,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconCopy,
  IconDownload,
  IconFileSpreadsheet,
  IconFold,
  IconFoldDown,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLock,
  IconSearch,
} from '@tabler/icons-react';
import {
  hostKey,
  vlanGateways,
  type AssignReason,
  type DeviceModel,
  type DeviceState,
  type Infrastructure,
  type Src,
} from '@ncv/core';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { saveBlob, safeFileName } from '../export/download';
import { baseName, formatBytes, formatOrigin, formatPath } from '../format';
import { contentStore, type FileContent } from '../state/content';
import { effectiveDetection } from '../state/effective';
import type { LinkedShow } from '../state/devices';
import { managedViewId, peersOf, type MapFocus } from '../state/infra';
import type { FileEntry, Overrides, TextEntry } from '../state/files';
import { AclsView } from '../views/AclsView';
import { FortiSwitchView, WifiView } from '../views/ManagedViews';
import { FirewallVlansView, InterfacesView } from '../views/InterfacesView';
import { ObjectsView } from '../views/ObjectsView';
import { PoliciesView } from '../views/PoliciesView';
import { SdwanView } from '../views/SdwanView';
import { VpnView } from '../views/VpnView';
import { PortsView } from '../views/PortsView';
import { RoutingView } from '../views/RoutingView';
import { DeviceViewContext, sourceRange, type DeviceViewApi } from '../views/source';
import { SummaryView } from '../views/SummaryView';
import { VlansView } from '../views/VlansView';
import { ConfigEditor, type EditorHandle } from './ConfigEditor';
import { DetectionPanel } from './DetectionPanel';
import { OutlinePanel } from './OutlinePanel';
import { ShowPanel } from './ShowPanel';

interface Props {
  entry: FileEntry;
  /** The devices of the client put together, for the other side of every link (#15). */
  infra: Infrastructure;
  /** The model of a device of the client, by its key. */
  modelOf(key: string): DeviceModel | null;
  /** Opens the map of the client on a link or a device (#15, part 2). */
  onOpenMap(focus: MapFocus): void;
  onOverride(id: string, overrides: Overrides): void;
  /** Files of shows of this device. */
  shows: LinkedShow[];
  /** Real state from those shows. */
  state: DeviceState | null;
  /** For a file of shows: the device it belongs to. */
  device: { device: TextEntry; reason: AssignReason } | null;
  onOpenFile(id: string, line?: number): void;
  fileName(id: string): string;
  /** A line to show as soon as the file is open. */
  goTo: number | null;
  onGoToDone(): void;
}

export function FileView(props: Props) {
  const { entry } = props;
  if (entry.type === 'issue') return <IssueView entry={entry} />;
  return <TextView key={entry.id} {...props} entry={entry} />;
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

type Tab =
  | 'summary'
  | 'ports'
  | 'interfaces'
  | 'vlans'
  | 'policies'
  | 'objects'
  | 'acls'
  | 'routing'
  | 'vpn'
  | 'sdwan'
  | 'fortiswitch'
  | 'wifi'
  | 'config';

/** Views that show one logical context (VDOM) at a time. */
const PER_CONTEXT: Tab[] = [
  'interfaces',
  'vlans',
  'policies',
  'objects',
  'routing',
  'vpn',
  'sdwan',
];

/** The views of a device, after the summary; the config is always the last one. */
function tabsFor(model: DeviceModel): Tab[] {
  if (model.vendor === 'fortinet') {
    const tabs: Tab[] = ['summary', 'interfaces', 'vlans', 'policies', 'objects', 'routing'];
    if (model.contexts.some((c) => c.ipsec.length > 0)) tabs.push('vpn');
    if (model.contexts.some((c) => c.sdwan)) tabs.push('sdwan');
    // What the FortiGate manages (#15, part 4).
    if (model.managedSwitches?.length) tabs.push('fortiswitch');
    if (model.wireless) tabs.push('wifi');
    tabs.push('config');
    return tabs;
  }
  const tabs: Tab[] = ['summary', 'ports', 'vlans'];
  if (model.contexts.some((c) => c.acls.length > 0)) tabs.push('acls');
  tabs.push('routing', 'config');
  return tabs;
}

/** The VDOM shown first: the one with the most policies. */
function mainContext(model: DeviceModel): string {
  return (
    [...model.contexts].sort((a, b) => b.policies.length - a.policies.length)[0]?.name ?? 'root'
  );
}

function TextView({
  entry,
  infra,
  modelOf,
  onOpenMap,
  onOverride,
  shows,
  state,
  device,
  onOpenFile,
  fileName,
  goTo,
  onGoToDone,
}: Props & { entry: TextEntry }) {
  const { t, i18n } = useTranslation();
  const editor = useRef<EditorHandle>(null);
  const effective = useMemo(
    () => effectiveDetection(entry.detection, entry.overrides),
    [entry.detection, entry.overrides],
  );
  // The heavy content lives outside React state; the structure version tells when it changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const content = useMemo(() => contentStore.get(entry.id), [entry.id, entry.structureVersion]);
  const model = content?.model ?? null;
  const [tab, setTab] = useState<Tab>('summary');
  const [contextName, setContextName] = useState<string | null>(null);
  // Lines to show once the config tab is visible: the editor cannot scroll while hidden.
  const [pending, setPending] = useState<[number, number] | null>(null);

  const showLines = useCallback(
    (first: number, last = first) => {
      if (model) {
        setTab('config');
        setPending([first, last]);
      } else {
        editor.current?.showLines(first, last);
      }
    },
    [model],
  );

  useEffect(() => {
    if (tab !== 'config' || !pending) return;
    const frame = requestAnimationFrame(() => {
      editor.current?.showLines(pending[0], pending[1]);
      setPending(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [tab, pending]);

  // The exported files are named after the device, or after the file without its extension.
  const exportName = safeFileName(model?.hostname ?? entry.name.replace(/\.[^.]+$/, ''));
  const hostname = effective.hostname.value ?? model?.hostname;
  const peers = useMemo(() => (model ? peersOf(infra, hostname) : []), [infra, hostname, model]);
  // Problems and remote gateways come from the current configuration of the device only.
  const deviceKey =
    hostname && infra.devices.some((d) => d.key === hostKey(hostname) && d.file === entry.id)
      ? hostKey(hostname)
      : undefined;
  const api = useMemo<DeviceViewApi>(
    () => ({
      showSource: (src: Src) => {
        const range = sourceRange(src);
        if (range) showLines(range[0], range[1]);
      },
      state,
      openFile: onOpenFile,
      fileName,
      exportName,
      peers,
      infra,
      ...(deviceKey ? { deviceKey } : {}),
      gatewaysOf: (vlan: number) =>
        deviceKey ? vlanGateways(infra, modelOf, deviceKey, vlan) : [],
      openMap: onOpenMap,
    }),
    [
      showLines,
      state,
      onOpenFile,
      fileName,
      exportName,
      peers,
      infra,
      deviceKey,
      modelOf,
      onOpenMap,
    ],
  );
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  /** The Excel file of the device: one sheet for every view (#10). */
  const exportDevice = async () => {
    if (!model) return;
    setExporting(true);
    setExportFailed(false);
    try {
      const [{ deviceSheets }, { workbookBlob }] = await Promise.all([
        import('../export/device'),
        import('../export/xlsx'),
      ]);
      saveBlob(await workbookBlob(deviceSheets(model, state, t)), `${exportName}.xlsx`);
    } catch {
      setExportFailed(true);
    } finally {
      setExporting(false);
    }
  };

  // A line asked by another file (for example a value of the real state of a device).
  useEffect(() => {
    if (goTo === null) return;
    const frame = requestAnimationFrame(() => {
      showLines(goTo);
      onGoToDone();
    });
    return () => cancelAnimationFrame(frame);
  }, [goTo, showLines, onGoToDone]);

  if (!content) return null;

  const origin = formatOrigin(entry.path, entry.name);
  const encoding = entry.bom
    ? t('file.bom', { encoding: entry.encoding.toUpperCase() })
    : entry.encoding.toUpperCase();

  const detection = (
    <DetectionPanel
      effective={effective}
      overrides={entry.overrides}
      onOverride={(overrides) => onOverride(entry.id, overrides)}
      onGoToLine={(line) => showLines(line)}
    />
  );

  const header = (
    <Box
      p="md"
      pb="sm"
      className={model ? 'ncv-file-header ncv-file-header-compact' : 'ncv-file-header'}
    >
      <Group justify="space-between" align="flex-start" gap="xs" mb={model ? 0 : 'sm'}>
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
      {!model && detection}
      {content.show && (
        <ShowPanel
          show={content.show}
          device={device}
          onOpenFile={onOpenFile}
          onGoToLine={(line) => showLines(line)}
        />
      )}
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
                onClick={() => showLines(d.line)}
              >
                {t('diagnostics.atLine', { line: d.line, message: t(`diagnostics.${d.code}`) })}
              </Text>
            ))}
          </Stack>
        </Alert>
      )}
    </Box>
  );

  const config = (
    <ConfigPane
      entry={entry}
      content={content}
      editor={editor}
      onGoToLine={(line) => editor.current?.goToLine(line)}
    />
  );

  if (!model) {
    return (
      <Stack gap={0} className="ncv-file-view">
        {header}
        {config}
      </Stack>
    );
  }

  const tabs = tabsFor(model);
  const context =
    model.contexts.find((c) => c.name === (contextName ?? mainContext(model))) ??
    model.contexts[0]!;
  const firewall = model.vendor === 'fortinet';
  const view = (name: Tab): ReactNode => {
    switch (name) {
      case 'summary':
        return <SummaryView model={model} detection={detection} shows={shows} />;
      case 'ports':
        return <PortsView model={model} />;
      case 'interfaces':
        return <InterfacesView model={model} context={context} />;
      case 'vlans':
        return firewall ? (
          <FirewallVlansView model={model} context={context} />
        ) : (
          <VlansView model={model} />
        );
      case 'policies':
        return <PoliciesView model={model} context={context} />;
      case 'objects':
        return <ObjectsView context={context} />;
      case 'acls':
        return <AclsView model={model} />;
      case 'routing':
        return <RoutingView model={model} context={context} />;
      case 'vpn':
        return <VpnView context={context} />;
      case 'sdwan':
        return <SdwanView context={context} />;
      case 'fortiswitch':
        return (
          <FortiSwitchView
            model={model}
            onOpenSwitch={(serial) => onOpenFile(managedViewId(entry.id, serial))}
          />
        );
      case 'wifi':
        return <WifiView model={model} />;
      default:
        return null;
    }
  };
  const vdomSelector =
    model.contexts.length > 1 && PER_CONTEXT.includes(tab) ? (
      <Select
        size="xs"
        w={180}
        ml="auto"
        my={4}
        aria-label={t('device.vdom')}
        leftSection={<Text size="xs">{t('device.vdom')}</Text>}
        leftSectionWidth={52}
        data={model.contexts.map((c) => c.name)}
        value={context.name}
        onChange={(v) => v && setContextName(v)}
        allowDeselect={false}
        data-testid="vdom-select"
      />
    ) : null;

  return (
    <DeviceViewContext.Provider value={api}>
      <Stack gap={0} className="ncv-file-view">
        {header}
        <Tabs
          value={tab}
          onChange={(value) => value && setTab(value as Tab)}
          keepMounted={false}
          className={tab === 'config' ? 'ncv-tabs' : 'ncv-tabs ncv-tabs-grow'}
        >
          <Tabs.List className="ncv-tab-list">
            {tabs.map((name) => (
              <Tabs.Tab key={name} value={name} data-testid={`tab-${name}`}>
                {t(`tabs.${name}`)}
              </Tabs.Tab>
            ))}
            {vdomSelector}
            <Tooltip label={exportFailed ? t('export.failed') : t('export.deviceHelp')}>
              <Button
                size="compact-xs"
                variant="light"
                color={exportFailed ? 'red' : undefined}
                my="auto"
                ml={vdomSelector ? 'xs' : 'auto'}
                mr="xs"
                leftSection={<IconFileSpreadsheet size={14} />}
                loading={exporting}
                onClick={() => void exportDevice()}
                data-testid="btn-export-device"
              >
                {t('export.device')}
              </Button>
            </Tooltip>
          </Tabs.List>
          {tabs
            .filter((name) => name !== 'config')
            .map((name) => (
              <Tabs.Panel key={name} value={name} className="ncv-tab-panel">
                {view(name)}
              </Tabs.Panel>
            ))}
        </Tabs>
        {/* The config stays mounted: position, folds and search survive a change of tab. */}
        <Box className="ncv-config-panel" hidden={tab !== 'config'} data-testid="config-panel">
          {config}
        </Box>
      </Stack>
    </DeviceViewContext.Provider>
  );
}

interface ConfigPaneProps {
  entry: TextEntry;
  content: FileContent;
  editor: React.RefObject<EditorHandle | null>;
  onGoToLine(line: number): void;
}

/** The original text with its toolbar and the outline of the blocks. */
function ConfigPane({ entry, content, editor, onGoToLine }: ConfigPaneProps) {
  const { t } = useTranslation();
  const [showOutline, setShowOutline] = useState(true);
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null);
  const [highlightUnknown, setHighlightUnknown] = useState(true);
  const [backDepth, setBackDepth] = useState(0);
  const model = content.model;

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2500);
    return () => clearTimeout(timer);
  }, [copied]);

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
    saveBlob(blob, entry.name);
  };

  const outlineAvailable = entry.family !== 'plain';

  return (
    <>
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
        {backDepth > 0 && (
          <Button
            size="compact-sm"
            variant="light"
            leftSection={<IconArrowBackUp size={16} />}
            onClick={() => editor.current?.back()}
            data-testid="btn-back"
          >
            {t('config.back')}
          </Button>
        )}
        {model && (
          <Switch
            size="xs"
            ml="xs"
            checked={highlightUnknown}
            onChange={(e) => setHighlightUnknown(e.currentTarget.checked)}
            label={t('config.highlightUnknown', { count: model.coverage.unknown })}
            data-testid="switch-unknown"
          />
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
            <OutlinePanel outline={content.outline} onSelect={onGoToLine} />
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
            {...(model
              ? {
                  unknownLines: model.coverage.unknownLines,
                  references: model.references,
                  highlightUnknown,
                  onHistoryChange: setBackDepth,
                }
              : {})}
          />
        </Box>
      </Group>
    </>
  );
}
