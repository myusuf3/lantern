import { concat, Reader, Writer } from "./bytes.js";
import { internetChecksum } from "./checksum.js";

export const PROTO_ICMP = 1;
const HEADER_LEN = 20;
const VERSION_IHL = 0x45;

export interface Ipv4Header {
  id: number;
  ttl: number;
  protocol: number;
  src: string;
  dst: string;
}

export function encodeIpv4(h: Ipv4Header, payload: Uint8Array): Uint8Array {
  const header = new Writer(HEADER_LEN)
    .u8(VERSION_IHL)
    .u8(0)
    .u16(HEADER_LEN + payload.length)
    .u16(h.id)
    .u16(0)
    .u8(h.ttl)
    .u8(h.protocol)
    .u16(0)
    .ip(h.src)
    .ip(h.dst).bytes;
  const checksum = internetChecksum(header);
  header[10] = checksum >> 8;
  header[11] = checksum & 0xff;
  return concat(header, payload);
}

export function decodeIpv4(bytes: Uint8Array): {
  header: Ipv4Header;
  payload: Uint8Array;
  checksumOk: boolean;
} {
  const r = new Reader(bytes, "ipv4");
  const versionIhl = r.u8();
  if (versionIhl >> 4 !== 4) throw new Error(`ipv4: unsupported version ${versionIhl >> 4}`);
  if ((versionIhl & 0x0f) !== 5) throw new Error("ipv4: options are not supported");
  r.u8();
  const totalLength = r.u16();
  const id = r.u16();
  r.u16();
  const ttl = r.u8();
  const protocol = r.u8();
  r.u16();
  const header = { id, ttl, protocol, src: r.ip(), dst: r.ip() };
  const payload = bytes.subarray(HEADER_LEN, totalLength);
  return { header, payload, checksumOk: internetChecksum(bytes.subarray(0, HEADER_LEN)) === 0 };
}
