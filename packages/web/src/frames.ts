import type { FrameRecord } from "@lantern/engine";

/** The token label on the cable: what the frame is, and its TTL when it carries an IP packet. */
export function cableLabel(frame: FrameRecord): string {
  const ttl = frame.summary.ip?.ttl;
  return ttl === undefined ? frameLabel(frame) : `${frameLabel(frame)} · TTL ${ttl}`;
}

/** Short label for a frame: what it is. */
export function frameLabel(frame: FrameRecord): string {
  const { arp, icmp } = frame.summary;
  if (arp) return `ARP ${arp.op}`;
  if (icmp?.type === "echo-request") return "echo request";
  if (icmp?.type === "echo-reply") return "echo reply";
  if (icmp?.type === "time-exceeded") return "time exceeded";
  return "frame";
}

export interface HeaderField {
  name: string;
  value: string;
  /** Glossary slug, when the field name is a term worth defining. */
  term?: string;
  /** A word about a special value, e.g. that ff:ff:ff:ff:ff:ff means everyone. */
  note?: string;
}

const BROADCAST_MAC = "ff:ff:ff:ff:ff:ff";
const UNKNOWN_MAC = "00:00:00:00:00:00";

export interface HeaderBlock {
  name: string;
  term: string;
  fields: HeaderField[];
}

/** The frame as a stack of headers, outermost first, for the inspector. */
export function headersOf(frame: FrameRecord): HeaderBlock[] {
  const { eth, arp, ip, icmp } = frame.summary;
  const blocks: HeaderBlock[] = [
    {
      name: "Ethernet",
      term: "ethernet",
      fields: [
        eth.dst === BROADCAST_MAC
          ? {
              name: "destination",
              value: eth.dst,
              term: "broadcast",
              note: "broadcast: everyone on the cable",
            }
          : { name: "destination", value: eth.dst, term: "mac-address" },
        { name: "source", value: eth.src, term: "mac-address" },
        { name: "type", value: eth.type.toUpperCase() },
      ],
    },
  ];
  if (arp) {
    blocks.push({
      name: "ARP",
      term: "arp",
      fields: [
        { name: "operation", value: arp.op },
        { name: "sender MAC", value: arp.sender_mac },
        { name: "sender IP", value: arp.sender_ip },
        arp.target_mac === UNKNOWN_MAC
          ? { name: "target MAC", value: arp.target_mac, note: "unknown: this is the question" }
          : { name: "target MAC", value: arp.target_mac },
        { name: "target IP", value: arp.target_ip },
      ],
    });
  }
  if (ip) {
    blocks.push({
      name: "IPv4",
      term: "packet",
      fields: [
        { name: "source", value: ip.src, term: "ip-address" },
        { name: "destination", value: ip.dst, term: "ip-address" },
        { name: "TTL", value: String(ip.ttl), term: "ttl" },
        { name: "identification", value: String(ip.id), term: "identification" },
        { name: "protocol", value: ip.protocol.toUpperCase() },
      ],
    });
  }
  if (icmp?.type === "time-exceeded") {
    blocks.push({
      name: "ICMP",
      term: "icmp",
      fields: [
        { name: "type", value: "time exceeded", term: "ttl" },
        { name: "quoted packet", value: `${icmp.original.src} → ${icmp.original.dst}` },
      ],
    });
  } else if (icmp) {
    blocks.push({
      name: "ICMP",
      term: "icmp",
      fields: [
        { name: "type", value: icmp.type.replace("-", " "), term: icmp.type },
        { name: "identifier", value: String(icmp.id) },
        { name: "sequence", value: String(icmp.seq) },
        { name: "payload", value: `${icmp.payload.length / 2} bytes` },
      ],
    });
  }
  return blocks;
}
