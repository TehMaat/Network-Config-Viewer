import {
  ActionIcon,
  Badge,
  Burger,
  Button,
  Group,
  SegmentedControl,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconNetwork, IconPlus } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES } from '../i18n';
import { ColorSchemeSwitch } from './ColorSchemeSwitch';

interface Props {
  navOpened: boolean;
  onToggleNav(): void;
  onAddFiles(): void;
  hasFiles: boolean;
}

export function AppHeader({ navOpened, onToggleNav, onAddFiles, hasFiles }: Props) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage === 'it' ? 'it' : 'en';
  return (
    <Group h="100%" px="md" justify="space-between" wrap="nowrap">
      <Group gap="sm" wrap="nowrap">
        {hasFiles && (
          <Burger
            opened={navOpened}
            onClick={onToggleNav}
            hiddenFrom="sm"
            size="sm"
            aria-label={t('app.openNavigation')}
          />
        )}
        <IconNetwork size={26} color="var(--mantine-primary-color-filled)" aria-hidden />
        <Text fw={700} size="lg" visibleFrom="sm">
          {t('app.title')}
        </Text>
        <Tooltip label={t('app.version', { version: __APP_VERSION__ })}>
          <Badge variant="light" tt="none" data-testid="app-version">
            {t('app.versionShort', { version: __APP_VERSION__ })}
          </Badge>
        </Tooltip>
      </Group>
      <Group gap="sm" wrap="nowrap">
        {hasFiles && (
          <>
            <Button
              size="xs"
              leftSection={<IconPlus size={14} />}
              onClick={onAddFiles}
              visibleFrom="xs"
              data-testid="btn-add"
            >
              {t('drop.add')}
            </Button>
            <Tooltip label={t('drop.add')}>
              <ActionIcon
                onClick={onAddFiles}
                hiddenFrom="xs"
                aria-label={t('drop.add')}
                data-testid="btn-add-compact"
              >
                <IconPlus size={16} />
              </ActionIcon>
            </Tooltip>
          </>
        )}
        <ColorSchemeSwitch />
        <SegmentedControl
          size="xs"
          value={language}
          onChange={(value) => void i18n.changeLanguage(value)}
          aria-label={t('language.label')}
          data-testid="language-switch"
          data={LANGUAGES.map((lng) => ({
            value: lng,
            label: (
              <Tooltip label={t(`language.${lng}`)}>
                <span>{lng.toUpperCase()}</span>
              </Tooltip>
            ),
          }))}
        />
      </Group>
    </Group>
  );
}
