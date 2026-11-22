// What can be changed by hand on the map (#15, part 3): links added by hand, also towards
// nodes outside the client, inferred links confirmed, discarded or corrected, nodes added by
// hand, sites renamed and merged, devices moved to another site. Everything goes in the map of
// the client (map.json): the configurations are never touched.

import {
  Autocomplete,
  Badge,
  Button,
  Group,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { IconCheck, IconEdit, IconPlus, IconRestore, IconTrash, IconX } from '@tabler/icons-react';
import {
  hostKey,
  MANUAL_LINK_KINDS,
  type Infrastructure,
  type Link,
  type ManualEnd,
  type ManualExternal,
  type ManualLink,
  type ManualLinkKind,
  type MapEdits,
} from '@ncv/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  newId,
  withDecision,
  withDeviceSite,
  withExternal,
  withLink,
  withoutExternal,
  withoutLink,
  withPosition,
  withSiteName,
} from '../state/mapEdits';
import type { ModelOf } from './details';

export type EditMap = (change: (edits: MapEdits) => MapEdits) => void;

/** What the panels of the map need to change it; missing where the map is only shown. */
export interface MapEditing {
  edits: MapEdits;
  onEdit: EditMap;
  /** Opens the form of a link added by hand: new, to change, or to correct an inferred one. */
  openLink(link?: ManualLink): void;
  openExternal(external?: ManualExternal): void;
}

/** The manual id of a link or a node of the graph: "manual:<id>" → "<id>". */
export const manualId = (graphId: string) => graphId.replace(/^manual:/, '');

// ---- Links: confirm, discard, correct, change ------------------------------------------

/** The two sides of an inferred link as the form of a link added by hand wants them. */
function endOf(infra: Infrastructure, end: Link['a']): ManualEnd | null {
  const device = infra.devices.find((d) => d.key === end.node);
  if (device)
    return { device: device.hostname, ...(end.interface ? { interface: end.interface } : {}) };
  const external = infra.externals.find((e) => e.id === end.node && e.kind === 'manual');
  return external ? { external: manualId(external.id) } : null;
}

export function LinkActions({
  link,
  infra,
  editing,
}: {
  link: Link;
  infra: Infrastructure;
  editing: MapEditing;
}) {
  const { t } = useTranslation();
  const { edits, onEdit } = editing;
  if (link.manual) {
    const own = edits.links?.find((l) => l.id === manualId(link.id));
    return (
      <Stack gap={4} data-testid="map-link-actions">
        {link.note && (
          <Text size="xs" c="dimmed" data-testid="map-link-note">
            {link.note}
          </Text>
        )}
        <Group gap={6}>
          <Button
            size="compact-xs"
            variant="light"
            leftSection={<IconEdit size={12} />}
            onClick={() => own && editing.openLink(own)}
            data-testid="btn-link-edit"
          >
            {t('mapEdit.link.edit')}
          </Button>
          <Button
            size="compact-xs"
            variant="light"
            color="red"
            leftSection={<IconTrash size={12} />}
            onClick={() => onEdit((e) => withoutLink(e, manualId(link.id)))}
            data-testid="btn-link-delete"
          >
            {t('mapEdit.link.delete')}
          </Button>
        </Group>
      </Stack>
    );
  }
  const physical = link.kind === 'cable' || link.kind === 'lag';
  const a = endOf(infra, link.a);
  const b = endOf(infra, link.b);
  return (
    <Group gap={6} data-testid="map-link-actions">
      {link.confirmed ? (
        <Button
          size="compact-xs"
          variant="subtle"
          leftSection={<IconRestore size={12} />}
          onClick={() => onEdit((e) => withDecision(e, link.id, null))}
          data-testid="btn-link-unconfirm"
        >
          {t('mapEdit.link.unconfirm')}
        </Button>
      ) : (
        !link.verified && (
          <Button
            size="compact-xs"
            variant="light"
            color="teal"
            leftSection={<IconCheck size={12} />}
            onClick={() => onEdit((e) => withDecision(e, link.id, 'confirmed'))}
            data-testid="btn-link-confirm"
          >
            {t('mapEdit.link.confirm')}
          </Button>
        )
      )}
      <Button
        size="compact-xs"
        variant="light"
        color="red"
        leftSection={<IconX size={12} />}
        onClick={() => onEdit((e) => withDecision(e, link.id, 'discarded'))}
        data-testid="btn-link-discard"
      >
        {t('mapEdit.link.discard')}
      </Button>
      {physical && a && b && (
        <Button
          size="compact-xs"
          variant="light"
          leftSection={<IconEdit size={12} />}
          onClick={() =>
            editing.openLink({
              id: '',
              kind: link.kind === 'lag' ? 'lag' : 'cable',
              a,
              b,
              replaces: link.id,
            })
          }
          data-testid="btn-link-correct"
        >
          {t('mapEdit.link.correct')}
        </Button>
      )}
    </Group>
  );
}

/** The inferred links discarded by hand, to put them back on the map. */
export function DiscardedLinks({
  infra,
  title,
  onEdit,
}: {
  infra: Infrastructure;
  title(link: Link): string;
  onEdit: EditMap;
}) {
  const { t } = useTranslation();
  if (infra.discarded.length === 0) return null;
  return (
    <Stack gap={4} data-testid="map-discarded">
      <Text size="sm" fw={600}>
        {t('mapEdit.discarded.title', { count: infra.discarded.length })}
      </Text>
      {infra.discarded.map((l) => (
        <Group key={l.id} gap="xs" data-testid="discarded-link" data-link={l.id} wrap="nowrap">
          <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
            {title(l)}
          </Text>
          <Button
            size="compact-xs"
            variant="subtle"
            leftSection={<IconRestore size={12} />}
            onClick={() => onEdit((e) => withDecision(e, l.id, null))}
            data-testid="btn-link-restore"
          >
            {t('mapEdit.discarded.restore')}
          </Button>
        </Group>
      ))}
    </Stack>
  );
}

// ---- Devices and nodes added by hand --------------------------------------------------

export function DeviceSite({
  hostname,
  infra,
  editing,
}: {
  hostname: string;
  infra: Infrastructure;
  editing: MapEditing;
}) {
  const { t } = useTranslation();
  const [site, setSite] = useState('');
  const chosen = Object.keys(editing.edits.deviceSites ?? {}).some(
    (h) => h.toLowerCase() === hostname.toLowerCase(),
  );
  const moved = Object.keys(editing.edits.positions?.devices ?? {}).some(
    (h) => h.toLowerCase() === hostname.toLowerCase(),
  );
  const names = [...new Set(infra.sites.map((s) => s.name).filter(Boolean))].sort();
  return (
    <Stack gap={6} data-testid="device-site-editor">
      <Group gap={6} align="flex-end" wrap="nowrap">
        <Autocomplete
          size="xs"
          label={t('mapEdit.device.site')}
          placeholder={t('mapEdit.device.sitePlaceholder')}
          data={names}
          value={site}
          onChange={setSite}
          style={{ flex: 1 }}
          data-testid="input-device-site"
        />
        <Button
          size="xs"
          variant="light"
          disabled={!site.trim()}
          onClick={() => {
            editing.onEdit((e) => withDeviceSite(e, hostname, site));
            setSite('');
          }}
          data-testid="btn-device-site"
        >
          {t('mapEdit.device.move')}
        </Button>
      </Group>
      <Group gap={6}>
        {chosen && (
          <Button
            size="compact-xs"
            variant="subtle"
            leftSection={<IconRestore size={12} />}
            onClick={() => editing.onEdit((e) => withDeviceSite(e, hostname, null))}
            data-testid="btn-device-site-reset"
          >
            {t('mapEdit.device.siteReset')}
          </Button>
        )}
        {moved && (
          <Button
            size="compact-xs"
            variant="subtle"
            leftSection={<IconRestore size={12} />}
            onClick={() => editing.onEdit((e) => withPosition(e, 'devices', hostname, null))}
            data-testid="btn-node-position-reset"
          >
            {t('mapEdit.device.positionReset')}
          </Button>
        )}
        <Button
          size="compact-xs"
          variant="subtle"
          leftSection={<IconPlus size={12} />}
          onClick={() =>
            editing.openLink({
              id: '',
              kind: 'cable',
              a: { device: hostname },
              b: { device: '' },
            })
          }
          data-testid="btn-node-add-link"
        >
          {t('mapEdit.device.addLink')}
        </Button>
      </Group>
    </Stack>
  );
}

export function ExternalActions({
  externalId,
  editing,
}: {
  /** Id in the graph: "manual:nas". */
  externalId: string;
  editing: MapEditing;
}) {
  const { t } = useTranslation();
  const own = editing.edits.externals?.find((e) => e.id === manualId(externalId));
  const moved = Object.keys(editing.edits.positions?.externals ?? {}).includes(externalId);
  return (
    <Group gap={6} data-testid="external-actions">
      {own && (
        <>
          <Button
            size="compact-xs"
            variant="light"
            leftSection={<IconEdit size={12} />}
            onClick={() => editing.openExternal(own)}
            data-testid="btn-external-edit"
          >
            {t('mapEdit.external.edit')}
          </Button>
          <Button
            size="compact-xs"
            variant="light"
            color="red"
            leftSection={<IconTrash size={12} />}
            onClick={() => editing.onEdit((e) => withoutExternal(e, own.id))}
            data-testid="btn-external-delete"
          >
            {t('mapEdit.external.delete')}
          </Button>
        </>
      )}
      {moved && (
        <Button
          size="compact-xs"
          variant="subtle"
          leftSection={<IconRestore size={12} />}
          onClick={() => editing.onEdit((e) => withPosition(e, 'externals', externalId, null))}
          data-testid="btn-node-position-reset"
        >
          {t('mapEdit.device.positionReset')}
        </Button>
      )}
    </Group>
  );
}

// ---- Forms ----------------------------------------------------------------------------

/** The two sides of a link, for the test ids of the form. */
const SIDE_A = 'a';
const SIDE_B = 'b';

/** "d:FGT-HQ" for a device, "e:nas" for a node added by hand. */
const endValue = (end: ManualEnd | undefined) =>
  !end ? null : 'external' in end ? `e:${end.external}` : end.device ? `d:${end.device}` : null;

export function LinkForm({
  link,
  infra,
  modelOf,
  onClose,
  onEdit,
}: {
  /** The link to change, or to start from; with an empty id, a new link. */
  link: ManualLink;
  infra: Infrastructure;
  modelOf: ModelOf;
  onClose(): void;
  onEdit: EditMap;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<ManualLinkKind>(link.kind);
  const [a, setA] = useState(endValue(link.a));
  const [b, setB] = useState(endValue(link.b));
  const [portA, setPortA] = useState('device' in link.a ? (link.a.interface ?? '') : '');
  const [portB, setPortB] = useState('device' in link.b ? (link.b.interface ?? '') : '');
  const [note, setNote] = useState(link.note ?? '');
  const options = [
    {
      group: t('mapEdit.form.devices'),
      items: infra.devices.map((d) => ({ value: `d:${d.hostname}`, label: d.hostname })),
    },
    {
      group: t('mapEdit.form.nodes'),
      items: infra.externals
        .filter((e) => e.kind === 'manual')
        .map((e) => ({ value: `e:${manualId(e.id)}`, label: e.label })),
    },
  ].filter((g) => g.items.length > 0);
  const ports = (value: string | null) => {
    if (!value?.startsWith('d:')) return [];
    const model = modelOf(hostKey(value.slice(2)));
    return (model?.interfaces ?? []).map((i) => i.name);
  };
  const end = (value: string | null, port: string): ManualEnd | null =>
    !value
      ? null
      : value.startsWith('e:')
        ? { external: value.slice(2) }
        : { device: value.slice(2), ...(port.trim() ? { interface: port.trim() } : {}) };
  const sideA = end(a, portA);
  const sideB = end(b, portB);
  const same = !!a && a === b && portA.trim().toLowerCase() === portB.trim().toLowerCase();
  const save = () => {
    if (!sideA || !sideB || same) return;
    onEdit((e) => {
      const id =
        link.id ||
        newId(
          `link-${(e.links ?? []).length + 1}`,
          (e.links ?? []).map((l) => l.id),
        );
      // A correction replaces the inferred link: deleted, the inferred link is back.
      return withLink(e, {
        id,
        kind,
        a: sideA,
        b: sideB,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(link.replaces ? { replaces: link.replaces } : {}),
      });
    });
    onClose();
  };
  const side = (
    label: string,
    value: string | null,
    setValue: (v: string | null) => void,
    port: string,
    setPort: (v: string) => void,
    testId: string,
  ) => (
    <Group gap="xs" align="flex-end" grow>
      <Select
        label={label}
        data={options}
        value={value}
        onChange={(v) => {
          setValue(v);
          setPort('');
        }}
        searchable
        allowDeselect={false}
        comboboxProps={{ withinPortal: true }}
        data-testid={`select-link-${testId}`}
      />
      <Autocomplete
        label={t('mapEdit.form.interface')}
        data={ports(value)}
        value={port}
        onChange={setPort}
        disabled={!value || value.startsWith('e:')}
        limit={50}
        data-testid={`input-link-${testId}-interface`}
      />
    </Group>
  );
  return (
    <Modal
      opened
      onClose={onClose}
      title={
        link.replaces
          ? t('mapEdit.form.correctTitle')
          : link.id
            ? t('mapEdit.form.editTitle')
            : t('mapEdit.form.addTitle')
      }
      size="lg"
    >
      <Stack data-testid="link-form">
        {link.replaces && (
          <Text size="sm" c="dimmed">
            {t('mapEdit.form.correctIntro')}
          </Text>
        )}
        <SegmentedControl
          value={kind}
          onChange={(v) => setKind(v as ManualLinkKind)}
          data={MANUAL_LINK_KINDS.map((k) => ({ value: k, label: t(`map.kind.${k}`) }))}
          data-testid="select-link-kind"
        />
        {side(t('map.col.a'), a, setA, portA, setPortA, SIDE_A)}
        {side(t('map.col.b'), b, setB, portB, setPortB, SIDE_B)}
        <TextInput
          label={t('mapEdit.form.note')}
          placeholder={t('mapEdit.form.notePlaceholder')}
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          maxLength={500}
          data-testid="input-link-note"
        />
        {same && (
          <Text size="sm" c="red">
            {t('mapEdit.form.same')}
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('detection.cancel')}
          </Button>
          <Button onClick={save} disabled={!sideA || !sideB || same} data-testid="btn-link-save">
            {t('mapEdit.form.save')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export function ExternalForm({
  external,
  infra,
  onClose,
  onEdit,
}: {
  external?: ManualExternal;
  infra: Infrastructure;
  onClose(): void;
  onEdit: EditMap;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = useState(external?.label ?? '');
  const [detail, setDetail] = useState(external?.detail ?? '');
  const [site, setSite] = useState(external?.site ?? '');
  const names = [...new Set(infra.sites.map((s) => s.name).filter(Boolean))].sort();
  const save = () => {
    if (!label.trim()) return;
    onEdit((e) =>
      withExternal(e, {
        id:
          external?.id ??
          newId(
            label,
            (e.externals ?? []).map((x) => x.id),
          ),
        label: label.trim(),
        ...(detail.trim() ? { detail: detail.trim() } : {}),
        ...(site.trim() ? { site: site.trim() } : {}),
      }),
    );
    onClose();
  };
  return (
    <Modal
      opened
      onClose={onClose}
      title={external ? t('mapEdit.external.editTitle') : t('mapEdit.external.addTitle')}
    >
      <Stack data-testid="external-form">
        <Text size="sm" c="dimmed">
          {t('mapEdit.external.intro')}
        </Text>
        <TextInput
          label={t('mapEdit.external.label')}
          placeholder={t('mapEdit.external.labelPlaceholder')}
          value={label}
          onChange={(e) => setLabel(e.currentTarget.value)}
          maxLength={100}
          data-autofocus
          data-testid="input-external-label"
        />
        <TextInput
          label={t('mapEdit.external.detail')}
          placeholder={t('mapEdit.external.detailPlaceholder')}
          value={detail}
          onChange={(e) => setDetail(e.currentTarget.value)}
          maxLength={500}
          data-testid="input-external-detail"
        />
        <Autocomplete
          label={t('mapEdit.external.site')}
          data={names}
          value={site}
          onChange={setSite}
          data-testid="input-external-site"
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('detection.cancel')}
          </Button>
          <Button onClick={save} disabled={!label.trim()} data-testid="btn-external-save">
            {t('mapEdit.form.save')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** The sites renamed together: two sites with the same name become one. */
export function SitesForm({
  infra,
  onClose,
  onEdit,
}: {
  infra: Infrastructure;
  onClose(): void;
  onEdit: EditMap;
}) {
  const { t } = useTranslation();
  const named = infra.sites.filter((s) => s.name);
  const [names, setNames] = useState(() => new Map(named.map((s) => [s.id, s.name])));
  const save = () => {
    onEdit((e) => {
      let next = e;
      for (const site of named) {
        const name = names.get(site.id)?.trim() ?? '';
        if (name && name !== site.name) next = withSiteName(next, site, name);
      }
      return next;
    });
    onClose();
  };
  return (
    <Modal opened onClose={onClose} title={t('mapEdit.sites.title')} size="lg">
      <Stack data-testid="sites-form">
        <Text size="sm" c="dimmed">
          {t('mapEdit.sites.intro')}
        </Text>
        <Table withTableBorder fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('mapEdit.sites.name')}</Table.Th>
              <Table.Th>{t('mapEdit.sites.devices')}</Table.Th>
              <Table.Th>{t('mapEdit.sites.source')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {named.map((s) => (
              <Table.Tr key={s.id}>
                <Table.Td>
                  <TextInput
                    size="xs"
                    value={names.get(s.id) ?? ''}
                    onChange={(e) => setNames(new Map(names).set(s.id, e.currentTarget.value))}
                    maxLength={100}
                    aria-label={t('mapEdit.sites.name')}
                    data-testid="input-site-name"
                    data-site={s.name}
                  />
                </Table.Td>
                <Table.Td>{s.devices.length}</Table.Td>
                <Table.Td>
                  <Badge
                    size="sm"
                    variant="light"
                    color={s.source === 'manual' ? 'grape' : 'gray'}
                    tt="none"
                  >
                    {t(`mapEdit.sites.from.${s.source}`)}
                  </Badge>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('detection.cancel')}
          </Button>
          <Button onClick={save} data-testid="btn-sites-save">
            {t('mapEdit.form.save')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
