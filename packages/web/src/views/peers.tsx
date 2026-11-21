// The other side of a port, a tunnel or a BGP session, from the map of the client (#15):
// a click opens the other device.

import { Anchor, Badge, Group, Stack, Text } from '@mantine/core';
import { shortInterfaceName } from '@ncv/core';
import { useTranslation } from 'react-i18next';
import type { Peer } from '../state/infra';
import { useDeviceView } from './source';

/** Port, tunnel or address of the other side. */
function where(peer: Peer): string {
  const t = peer.there;
  const name = t.tunnel ?? t.interface;
  return [name ? shortInterfaceName(name) : '', !name ? (t.ip ?? '') : '']
    .filter(Boolean)
    .join(' ');
}

export function PeerLinks({ match }: { match(peer: Peer): boolean }) {
  const { t } = useTranslation();
  const { peers, openFile } = useDeviceView();
  const found = peers.filter(match);
  if (found.length === 0) return null;
  return (
    <Stack gap={2} data-testid="peer-links">
      {found.map((p) => (
        <Group key={`${p.link.id}-${p.there.node}`} gap={6} wrap="nowrap" data-testid="peer-link">
          {p.file ? (
            <Anchor
              component="button"
              type="button"
              size="sm"
              onClick={() => openFile(p.file!)}
              data-testid="peer-open"
              data-device={p.name}
            >
              {p.name}
            </Anchor>
          ) : (
            <Text span size="sm">
              {p.name}
            </Text>
          )}
          {where(p) && (
            <Text span size="sm" ff="monospace">
              {where(p)}
            </Text>
          )}
          <Badge size="xs" variant="light" color={p.link.verified ? 'teal' : 'gray'} tt="none">
            {p.link.verified ? t('map.verified') : t('map.inferred')}
          </Badge>
        </Group>
      ))}
    </Stack>
  );
}
