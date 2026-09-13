/** RFC 1071 internet checksum: one's complement of the one's complement sum of 16-bit words. */
export function internetChecksum(bytes: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i + 1 < bytes.length; i += 2) sum += ((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0);
  if (bytes.length % 2 === 1) sum += (bytes[bytes.length - 1] ?? 0) << 8;
  while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
  return ~sum & 0xffff;
}
