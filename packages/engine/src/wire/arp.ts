import { Reader, Writer } from "./bytes.js";
import { ETHERTYPE_IPV4 } from "./ethernet.js";

const HTYPE_ETHERNET = 1;
const OP_REQUEST = 1;
const OP_REPLY = 2;
const PACKET_LEN = 28;

export interface ArpPacket {
  op: "request" | "reply";
  senderMac: string;
  senderIp: string;
  targetMac: string;
  targetIp: string;
}

export function encodeArp(p: ArpPacket): Uint8Array {
  return new Writer(PACKET_LEN)
    .u16(HTYPE_ETHERNET)
    .u16(ETHERTYPE_IPV4)
    .u8(6)
    .u8(4)
    .u16(p.op === "request" ? OP_REQUEST : OP_REPLY)
    .mac(p.senderMac)
    .ip(p.senderIp)
    .mac(p.targetMac)
    .ip(p.targetIp).bytes;
}

export function decodeArp(bytes: Uint8Array): ArpPacket {
  const r = new Reader(bytes, "arp");
  const htype = r.u16();
  const ptype = r.u16();
  const hlen = r.u8();
  const plen = r.u8();
  if (htype !== HTYPE_ETHERNET || hlen !== 6)
    throw new Error(`arp: unsupported hardware type ${htype}/${hlen}`);
  if (ptype !== ETHERTYPE_IPV4 || plen !== 4)
    throw new Error(`arp: unsupported protocol type ${ptype}/${plen}`);
  const opcode = r.u16();
  if (opcode !== OP_REQUEST && opcode !== OP_REPLY)
    throw new Error(`arp: unsupported opcode ${opcode}`);
  return {
    op: opcode === OP_REQUEST ? "request" : "reply",
    senderMac: r.mac(),
    senderIp: r.ip(),
    targetMac: r.mac(),
    targetIp: r.ip(),
  };
}
