import { concat, Reader, Writer } from "./bytes.js";
import { internetChecksum } from "./checksum.js";

const TYPE_ECHO_REPLY = 0;
const TYPE_ECHO_REQUEST = 8;
const TYPE_TIME_EXCEEDED = 11;
const HEADER_LEN = 8;
/** RFC 792: time exceeded quotes the original IP header plus the first 8 bytes of its payload. */
const QUOTE_LEN = 20 + 8;

export type IcmpMessage =
  | { type: "echo-request" | "echo-reply"; id: number; seq: number; payload: Uint8Array }
  | { type: "time-exceeded"; original: Uint8Array };

export function encodeIcmp(m: IcmpMessage): Uint8Array {
  const header = new Writer(HEADER_LEN);
  let body: Uint8Array;
  if (m.type === "time-exceeded") {
    header.u8(TYPE_TIME_EXCEEDED).u8(0).u16(0).u32(0);
    body = m.original.subarray(0, QUOTE_LEN);
  } else {
    header
      .u8(m.type === "echo-request" ? TYPE_ECHO_REQUEST : TYPE_ECHO_REPLY)
      .u8(0)
      .u16(0)
      .u16(m.id)
      .u16(m.seq);
    body = m.payload;
  }
  const packet = concat(header.bytes, body);
  const checksum = internetChecksum(packet);
  packet[2] = checksum >> 8;
  packet[3] = checksum & 0xff;
  return packet;
}

export function decodeIcmp(bytes: Uint8Array): { message: IcmpMessage; checksumOk: boolean } {
  const checksumOk = internetChecksum(bytes) === 0;
  const r = new Reader(bytes, "icmp");
  const type = r.u8();
  r.u8();
  r.u16();
  if (type === TYPE_TIME_EXCEEDED) {
    r.u32();
    return { message: { type: "time-exceeded", original: r.rest() }, checksumOk };
  }
  if (type === TYPE_ECHO_REQUEST || type === TYPE_ECHO_REPLY) {
    const id = r.u16();
    const seq = r.u16();
    const kind = type === TYPE_ECHO_REQUEST ? "echo-request" : "echo-reply";
    return { message: { type: kind, id, seq, payload: r.rest() }, checksumOk };
  }
  throw new Error(`icmp: unsupported type ${type}`);
}
