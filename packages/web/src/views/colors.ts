// Colours of the VLANs on the port panel. The same VLAN keeps its colour on a device; the
// palette uses Mantine shades that read well with white text in both themes.
const PALETTE = [
  'var(--mantine-color-blue-6)',
  'var(--mantine-color-teal-7)',
  'var(--mantine-color-grape-6)',
  'var(--mantine-color-orange-7)',
  'var(--mantine-color-cyan-7)',
  'var(--mantine-color-lime-8)',
  'var(--mantine-color-pink-6)',
  'var(--mantine-color-violet-6)',
  'var(--mantine-color-green-7)',
  'var(--mantine-color-yellow-8)',
  'var(--mantine-color-red-7)',
  'var(--mantine-color-indigo-7)',
];

export const NEUTRAL = 'var(--mantine-color-gray-6)';

/** VLAN ID → colour, in the order of the VLANs of the device. VLAN 1 is neutral. */
export function vlanColors(ids: readonly number[]): Map<number, string> {
  const out = new Map<number, string>();
  let next = 0;
  for (const id of [...ids].sort((a, b) => a - b)) {
    if (id === 1) out.set(id, NEUTRAL);
    else out.set(id, PALETTE[next++ % PALETTE.length]!);
  }
  return out;
}
