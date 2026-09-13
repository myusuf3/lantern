import type { Event, RunResult } from "@lantern/engine";

/** One node's turn: every event at the same node at the same instant. */
export interface Turn {
  node: string;
  t_us: number;
  events: Event[];
  /** Set when this turn begins with a frame arriving. */
  arriving?: { frame: string; link: string; from: string };
  /** The frame this turn put on the wire, if any. */
  sent?: string;
}

export function turnsOf(events: Event[]): Turn[] {
  const turns: Turn[] = [];
  const senderOf = new Map<string, string>();
  for (const e of events) {
    const last = turns[turns.length - 1];
    if (last && last.node === e.node && last.t_us === e.t_us) last.events.push(e);
    else turns.push({ node: e.node, t_us: e.t_us, events: [e] });
    const turn = turns[turns.length - 1];
    if (!turn) continue;
    if (e.kind === "frame.tx") {
      turn.sent = e.frame;
      senderOf.set(e.frame, e.node);
    }
    if (e.kind === "frame.rx")
      turn.arriving = { frame: e.frame, link: e.link, from: senderOf.get(e.frame) ?? "" };
  }
  return turns;
}

export interface ArpRow {
  ip: string;
  mac: string;
  dev: string;
  /** Written during the turn being shown. */
  fresh: boolean;
}

/** A node's ARP table as it stands after turn `index`: configured neighbors plus everything learned. */
export function arpTableAt(run: RunResult, turns: Turn[], node: string, index: number): ArpRow[] {
  const config = run.network.nodes.find((n) => n.id === node);
  const rows = new Map<string, ArpRow>();
  if (config && config.kind !== "switch") {
    for (const n of config.neighbors) rows.set(n.ip, { ...n, fresh: false });
  }
  turns.slice(0, index + 1).forEach((turn, i) => {
    if (turn.node !== node) return;
    for (const e of turn.events) {
      if (e.kind === "arp.learn")
        rows.set(e.ip, { ip: e.ip, mac: e.mac, dev: e.dev, fresh: i === index });
    }
  });
  return [...rows.values()];
}
