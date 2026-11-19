import {
  Anchor,
  Badge,
  Box,
  Button,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconPencil, IconRestore } from '@tabler/icons-react';
import type { FileKind, OsId } from '@ncv/core';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Overrides } from '../state/files';
import type { EffectiveDetection, Field } from '../state/effective';

const OS_IDS: OsId[] = ['fortios', 'fortiswitchos', 'ios', 'ios-xe', 'nx-os', 'asa', 'cisco-sb'];
const KINDS: FileKind[] = ['config', 'show', 'unknown'];
/** Systems recognised in this version but not interpreted yet. */
const NOT_READ_YET: OsId[] = ['nx-os', 'asa'];

interface Props {
  effective: EffectiveDetection;
  overrides: Overrides;
  onOverride(overrides: Overrides): void;
  onGoToLine(line: number): void;
}

export function DetectionPanel({ effective, overrides, onOverride, onGoToLine }: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);

  const source = (field: Field<unknown>) => {
    if (field.source === 'manual') {
      return (
        <Text size="xs" c="dimmed">
          {t('detection.source', { source: t('detection.manual') })}
        </Text>
      );
    }
    const evidence = field.evidence;
    if (field.source !== 'detected' || !evidence) return null;
    const label = t(`evidence.${evidence.rule}`);
    if (!evidence.line) {
      return (
        <Text size="xs" c="dimmed">
          {t('detection.source', { source: label })}
        </Text>
      );
    }
    const line = evidence.line;
    return (
      <Tooltip label={evidence.excerpt} multiline maw={420} openDelay={300} ff="monospace" fz="xs">
        <Anchor
          component="button"
          type="button"
          size="xs"
          c="dimmed"
          ta="left"
          onClick={() => onGoToLine(line)}
          aria-label={t('detection.goToLine', { line })}
        >
          {t('detection.sourceLine', { source: label, line })}
        </Anchor>
      </Tooltip>
    );
  };

  const cell = (name: string, label: string, field: Field<unknown>, display: ReactNode) => (
    <Box
      key={name}
      data-testid={`field-${name}`}
      data-value={field.value === undefined ? '' : String(field.value)}
      data-source={field.source}
    >
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      {field.value === undefined ? (
        <Text size="sm" c="dimmed" fs="italic">
          {t('detection.notFound')}
        </Text>
      ) : (
        <Text size="sm" fw={600} style={{ overflowWrap: 'anywhere' }}>
          {display}
        </Text>
      )}
      {source(field)}
    </Box>
  );

  const e = effective;
  const version =
    e.version.value === undefined
      ? undefined
      : e.build.value
        ? `${e.version.value} (${t('detection.build', { build: e.build.value })})`
        : e.version.value;

  const cells: { name: string; label: string; field: Field<unknown>; display: ReactNode }[] = [
    {
      name: 'kind',
      label: t('detection.kind'),
      field: e.kind,
      display: e.kind.value && t(`kind.${e.kind.value}`),
    },
    {
      name: 'vendor',
      label: t('detection.vendor'),
      field: e.vendor,
      display: e.vendor.value && t(`vendor.${e.vendor.value}`),
    },
    {
      name: 'os',
      label: t('detection.os'),
      field: e.os,
      display: e.os.value && t(`os.${e.os.value}`),
    },
    { name: 'version', label: t('detection.version'), field: e.version, display: version },
    { name: 'model', label: t('detection.model'), field: e.model, display: e.model.value },
    {
      name: 'hostname',
      label: t('detection.hostname'),
      field: e.hostname,
      display: e.hostname.value,
    },
  ];
  if (e.stack.value !== undefined) {
    cells.push({
      name: 'stack',
      label: t('detection.stack'),
      field: e.stack,
      display: t('detection.stackMembers', { count: e.stack.value }),
    });
  }

  return (
    <Paper withBorder p="sm" radius="md" data-testid="detection">
      <Group justify="space-between" mb="xs" wrap="nowrap">
        <Group gap="xs">
          <Title order={4} size="h5">
            {t('detection.title')}
          </Title>
          {e.edited && (
            <Badge size="sm" variant="light" color="orange" data-testid="edited-badge">
              {t('detection.edited')}
            </Badge>
          )}
        </Group>
        {!editing && (
          <Group gap="xs">
            {e.edited && (
              <Button
                size="compact-xs"
                variant="subtle"
                leftSection={<IconRestore size={14} />}
                onClick={() => onOverride({})}
                data-testid="btn-reset"
              >
                {t('detection.reset')}
              </Button>
            )}
            <Button
              size="compact-xs"
              variant="light"
              leftSection={<IconPencil size={14} />}
              onClick={() => setEditing(true)}
              data-testid="btn-edit"
            >
              {t('detection.edit')}
            </Button>
          </Group>
        )}
      </Group>

      {editing ? (
        <EditForm
          effective={e}
          overrides={overrides}
          onCancel={() => setEditing(false)}
          onApply={(next) => {
            onOverride(next);
            setEditing(false);
          }}
        />
      ) : (
        <Stack gap="sm">
          <SimpleGrid cols={{ base: 2, md: 3, xl: 6 }} spacing="md" verticalSpacing="xs">
            {cells.map((c) => cell(c.name, c.label, c.field, c.display))}
          </SimpleGrid>
          {e.vdoms.value && (
            <Box
              data-testid="field-vdoms"
              data-value={e.vdoms.value.join(',')}
              data-source={e.vdoms.source}
            >
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                {t('detection.vdoms')}
              </Text>
              <Group gap={6} my={4}>
                {e.vdoms.value.map((vdom) => (
                  <Badge key={vdom} variant="light" tt="none">
                    {vdom}
                  </Badge>
                ))}
              </Group>
              {source(e.vdoms)}
            </Box>
          )}
          {e.commands.length > 0 && (
            <Box
              data-testid="field-commands"
              data-value={e.commands.map((c) => c.command).join('|')}
              data-source="detected"
            >
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                {t('detection.commands')}
              </Text>
              <Stack gap={2} mt={4}>
                {e.commands.map((command, index) => (
                  <Group key={`${command.command}-${index}`} gap="xs" wrap="nowrap">
                    <Text size="sm" ff="monospace" fw={600}>
                      {command.command}
                    </Text>
                    {command.line !== undefined && (
                      <Anchor
                        component="button"
                        type="button"
                        size="xs"
                        c="dimmed"
                        onClick={() => onGoToLine(command.line!)}
                      >
                        {t('detection.goToLine', { line: command.line })}
                      </Anchor>
                    )}
                    {command.inferred && (
                      <Text size="xs" c="dimmed">
                        {t('detection.inferred')}
                      </Text>
                    )}
                  </Group>
                ))}
              </Stack>
            </Box>
          )}
          {e.os.value && NOT_READ_YET.includes(e.os.value) && (
            <Text size="xs" c="dimmed">
              {t('detection.notReadYet', { os: t(`os.${e.os.value}`) })}
            </Text>
          )}
        </Stack>
      )}
    </Paper>
  );
}

interface FormProps {
  effective: EffectiveDetection;
  overrides: Overrides;
  onApply(overrides: Overrides): void;
  onCancel(): void;
}

function EditForm({ effective, overrides, onApply, onCancel }: FormProps) {
  const { t } = useTranslation();
  const initial = {
    kind: effective.kind.value ?? 'unknown',
    os: effective.os.value ?? 'none',
    version: effective.version.value ?? '',
    model: effective.model.value ?? '',
    hostname: effective.hostname.value ?? '',
  };
  const [values, setValues] = useState(initial);

  const apply = () => {
    const next: Overrides = { ...overrides };
    if (values.kind !== initial.kind) next.kind = values.kind as FileKind;
    if (values.os !== initial.os) next.os = values.os === 'none' ? '' : (values.os as OsId);
    if (values.version !== initial.version) next.version = values.version;
    if (values.model !== initial.model) next.model = values.model;
    if (values.hostname !== initial.hostname) next.hostname = values.hostname;
    onApply(next);
  };

  return (
    <Stack gap="sm" data-testid="detection-form">
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 5 }} spacing="sm">
        <Select
          label={t('detection.kind')}
          data={KINDS.map((kind) => ({ value: kind, label: t(`kind.${kind}`) }))}
          value={values.kind}
          onChange={(value) => value && setValues({ ...values, kind: value as FileKind })}
          allowDeselect={false}
          data-testid="input-kind"
        />
        <Select
          label={t('detection.os')}
          data={[
            { value: 'none', label: t('os.none') },
            ...OS_IDS.map((os) => ({ value: os, label: t(`os.${os}`) })),
          ]}
          value={values.os}
          onChange={(value) => value && setValues({ ...values, os: value as OsId | 'none' })}
          allowDeselect={false}
          data-testid="input-os"
        />
        <TextInput
          label={t('detection.version')}
          value={values.version}
          onChange={(event) => setValues({ ...values, version: event.currentTarget.value })}
          data-testid="input-version"
        />
        <TextInput
          label={t('detection.model')}
          value={values.model}
          onChange={(event) => setValues({ ...values, model: event.currentTarget.value })}
          data-testid="input-model"
        />
        <TextInput
          label={t('detection.hostname')}
          value={values.hostname}
          onChange={(event) => setValues({ ...values, hostname: event.currentTarget.value })}
          data-testid="input-hostname"
        />
      </SimpleGrid>
      <Group justify="flex-end" gap="xs">
        <Button variant="default" size="xs" onClick={onCancel}>
          {t('detection.cancel')}
        </Button>
        <Button size="xs" onClick={apply} data-testid="btn-apply">
          {t('detection.apply')}
        </Button>
      </Group>
    </Stack>
  );
}
