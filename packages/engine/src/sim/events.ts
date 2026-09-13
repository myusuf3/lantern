import type { Network, Route } from "../schema.js";
import type { FrameSummary } from "../wire/frame.js";

export type DropReason = "not-our-mac" | "not-our-ip" | "no-route" | "ttl";

interface EventBase {
  seq: number;
  t_us: number;
  /** Index of the action in the scenario that produced this event. */
  action: number;
  node: string;
}

export type EventBody =
  | { kind: "route.lookup"; dst: string; route: Route | null; dev?: string; next_hop?: string }
  | { kind: "arp.miss"; ip: string; dev: string; parked: string }
  | { kind: "arp.hit"; ip: string; mac: string; dev: string }
  | { kind: "arp.learn"; ip: string; mac: string; dev: string }
  | { kind: "arp.reply"; ip: string; dev: string; reply_frame: string }
  | { kind: "frame.tx"; dev: string; link: string; frame: string }
  | { kind: "frame.rx"; dev: string; link: string; frame: string }
  | { kind: "switch.learn"; mac: string; port: string }
  | { kind: "switch.forward"; frame: string; in: string; out: string }
  | { kind: "switch.flood"; frame: string; in: string; out: string[] }
  | { kind: "ttl.decrement"; packet: string; before: number; after: number }
  | { kind: "ttl.expired"; packet: string; reply_packet: string }
  | { kind: "icmp.reply"; packet: string; reply_packet: string }
  | {
      kind: "icmp.recv";
      packet: string;
      type: "echo-reply" | "time-exceeded";
      from: string;
      rtt_us: number;
    }
  | { kind: "drop"; frame?: string; packet?: string; reason: DropReason };

export type Event = EventBase & EventBody;
export type EventKind = Event["kind"];

export interface FrameRecord {
  /** Exact bytes on the wire, as hex. The pcap writer copies them verbatim. */
  bytes: string;
  summary: FrameSummary;
}

export interface RunResult {
  network: Network;
  events: Event[];
  frames: Record<string, FrameRecord>;
}
