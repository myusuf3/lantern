/** IPv4 address as an unsigned 32-bit integer. */
export type Ip = number;

export interface Cidr {
  ip: Ip;
  prefix: number;
  network: Ip;
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function parseIp(text: string): Ip {
  const m = IPV4.exec(text);
  if (!m) throw new Error(`invalid IPv4 address: ${text}`);
  let ip = 0;
  for (const octet of m.slice(1, 5)) {
    const n = Number(octet);
    if (n > 255) throw new Error(`invalid IPv4 address: ${text}`);
    ip = ip * 256 + n;
  }
  return ip;
}

export function formatIp(ip: Ip): string {
  return [ip >>> 24, (ip >>> 16) & 0xff, (ip >>> 8) & 0xff, ip & 0xff].join(".");
}

export function prefixMask(prefix: number): Ip {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

export function parseCidr(text: string): Cidr {
  const slash = text.indexOf("/");
  if (slash === -1) throw new Error(`expected address/prefix: ${text}`);
  const prefix = Number(text.slice(slash + 1));
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`invalid prefix length: ${text}`);
  }
  const ip = parseIp(text.slice(0, slash));
  return { ip, prefix, network: (ip & prefixMask(prefix)) >>> 0 };
}

export function formatCidr(ip: Ip, prefix: number): string {
  return `${formatIp(ip)}/${prefix}`;
}

/** The canonical subnet string of a CIDR, e.g. `10.0.1.10/24` becomes `10.0.1.0/24`. */
export function formatNetwork(c: Cidr): string {
  return formatCidr(c.network, c.prefix);
}

export function cidrContains(cidr: Cidr, ip: Ip): boolean {
  return (ip & prefixMask(cidr.prefix)) >>> 0 === cidr.network;
}

export function formatMac(n: number): string {
  const hex = n.toString(16).padStart(12, "0");
  return hex.match(/.{2}/g)?.join(":") ?? hex;
}
