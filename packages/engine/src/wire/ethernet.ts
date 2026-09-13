import { concat, Reader, Writer } from "./bytes.js";

export const ETHERTYPE_IPV4 = 0x0800;
export const ETHERTYPE_ARP = 0x0806;
export const BROADCAST_MAC = "ff:ff:ff:ff:ff:ff";
const HEADER_LEN = 14;

export interface EthernetHeader {
  dst: string;
  src: string;
  type: number;
}

export function encodeEthernet(h: EthernetHeader, payload: Uint8Array): Uint8Array {
  const header = new Writer(HEADER_LEN).mac(h.dst).mac(h.src).u16(h.type).bytes;
  return concat(header, payload);
}

export function decodeEthernet(frame: Uint8Array): { header: EthernetHeader; payload: Uint8Array } {
  const r = new Reader(frame, "ethernet");
  const header = { dst: r.mac(), src: r.mac(), type: r.u16() };
  return { header, payload: r.rest() };
}
