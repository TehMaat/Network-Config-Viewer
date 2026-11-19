import {
  Center,
  SegmentedControl,
  Tooltip,
  VisuallyHidden,
  useMantineColorScheme,
  type MantineColorScheme,
} from '@mantine/core';
import { IconDeviceDesktop, IconMoon, IconSun } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { COLOR_SCHEMES } from '../theme/colorScheme';

const ICONS = { light: IconSun, dark: IconMoon, auto: IconDeviceDesktop } as const;

export function ColorSchemeSwitch() {
  const { t } = useTranslation();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  return (
    <SegmentedControl
      size="xs"
      value={colorScheme}
      onChange={(value) => setColorScheme(value as MantineColorScheme)}
      aria-label={t('theme.label')}
      data-testid="theme-switch"
      data={COLOR_SCHEMES.map((scheme) => {
        const Icon = ICONS[scheme];
        return {
          value: scheme,
          label: (
            <Tooltip label={t(`theme.${scheme}`)}>
              <Center h={18} data-scheme={scheme}>
                <Icon size={15} stroke={1.8} aria-hidden />
                <VisuallyHidden>{t(`theme.${scheme}`)}</VisuallyHidden>
              </Center>
            </Tooltip>
          ),
        };
      })}
    />
  );
}
