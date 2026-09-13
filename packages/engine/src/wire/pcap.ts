import { concat, Writer } from "./bytes.js";

const MAGIC_MICROSECONDS = 0xa1b2c3d4;
const VERSION_MAJOR = 2;
const VERSION_MINOR = 4;
const SNAPLEN = 0xffff;
const LINKTYPE_ETHERNET = 1;
const GLOBAL_HEADER_LEN = 24;
const RECORD_HEADER_LEN = 16;

export interface PcapRecord {
  t_us: number;
  bytes: Uint8Array;
}

/** Legacy pcap, big-endian, link type Ethernet. Takes `(time, bytes)` pairs and nothing else. */
export function writePcap(records: PcapRecord[]): Uint8Array {
  const global = new Writer(GLOBAL_HEADER_LEN)
    .u32(MAGIC_MICROSECONDS)
    .u16(VERSION_MAJOR)
    .u16(VERSION_MINOR)
    .u32(0)
    .u32(0)
    .u32(SNAPLEN)
    .u32(LINKTYPE_ETHERNET).bytes;
  const body = records.map(
    ({ t_us, bytes }) =>
      new Writer(RECORD_HEADER_LEN + bytes.length)
        .u32(Math.floor(t_us / 1_000_000))
        .u32(t_us % 1_000_000)
        .u32(bytes.length)
        .u32(bytes.length)
        .raw(bytes).bytes,
  );
  return concat(global, ...body);
}
