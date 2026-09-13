import { decodeArp } from "./arp.js";
import { toHex } from "./bytes.js";
import { decodeEthernet, ETHERTYPE_ARP, ETHERTYPE_IPV4 } from "./ethernet.js";
import { decodeIcmp } from "./icmp.js";
import { decodeIpv4, PROTO_ICMP } from "./ipv4.js";

/** Decoded once by the engine so the UI never parses bytes. Keys follow the design doc. */
export interface FrameSummary {
  eth: { src: string; dst: string; type: "arp" | "ipv4" | string };
  arp?: {
    op: "request" | "reply";
    sender_mac: string;
    sender_ip: string;
    target_mac: string;
    target_ip: string;
  };
  ip?: { src: string; dst: string; ttl: number; id: number; protocol: "icmp" | string };
  icmp?:
    | { type: "echo-request" | "echo-reply"; id: number; seq: number; payload: string }
    | {
        type: "time-exceeded";
        original: { src: string; dst: string; id: number; icmp_id: number; icmp_seq: number };
      };
}

export function summarizeFrame(frame: Uint8Array): FrameSummary {
  const { header, payload } = decodeEthernet(frame);
  if (header.type === ETHERTYPE_ARP) {
    const a = decodeArp(payload);
    return {
      eth: { src: header.src, dst: header.dst, type: "arp" },
      arp: {
        op: a.op,
        sender_mac: a.senderMac,
        sender_ip: a.senderIp,
        target_mac: a.targetMac,
        target_ip: a.targetIp,
      },
    };
  }
  if (header.type !== ETHERTYPE_IPV4) {
    return { eth: { src: header.src, dst: header.dst, type: `0x${header.type.toString(16)}` } };
  }
  const ip = decodeIpv4(payload);
  const summary: FrameSummary = {
    eth: { src: header.src, dst: header.dst, type: "ipv4" },
    ip: {
      src: ip.header.src,
      dst: ip.header.dst,
      ttl: ip.header.ttl,
      id: ip.header.id,
      protocol: ip.header.protocol === PROTO_ICMP ? "icmp" : String(ip.header.protocol),
    },
  };
  if (ip.header.protocol !== PROTO_ICMP) return summary;
  const { message } = decodeIcmp(ip.payload);
  if (message.type === "time-exceeded") {
    const quoted = decodeIpv4(message.original);
    const quotedIcmp = decodeIcmp(quoted.payload).message;
    summary.icmp = {
      type: "time-exceeded",
      original: {
        src: quoted.header.src,
        dst: quoted.header.dst,
        id: quoted.header.id,
        icmp_id: quotedIcmp.type === "time-exceeded" ? 0 : quotedIcmp.id,
        icmp_seq: quotedIcmp.type === "time-exceeded" ? 0 : quotedIcmp.seq,
      },
    };
  } else {
    summary.icmp = {
      type: message.type,
      id: message.id,
      seq: message.seq,
      payload: toHex(message.payload),
    };
  }
  return summary;
}
