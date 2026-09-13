import type { Event, RunResult } from "@lantern/engine";

export interface Arrival {
  frame: string;
  link: string;
  from: string;
  node: string;
}

/**
 * One step of the story: every event at one node at one instant, or the same thing happening to
 * several nodes at one instant, such as a flooded frame arriving on three cables at once.
 */
export interface Turn {
  nodes: string[];
  t_us: number;
  events: Event[];
  /** Frames that arrived at the start of this turn, one per cable. */
  arrivals: Arrival[];
  /** The frame this turn put on the wire, if any. */
  sent?: string;
}

/** Events that read as one moment even when they happen at different nodes. */
const SHARED = new Set<Event["kind"]>(["frame.rx", "drop"]);

function frameOf(e: Event): string | undefined {
  return e.kind === "frame.rx" || e.kind === "frame.tx" || e.kind === "drop" ? e.frame : undefined;
}

function sameMoment(turn: Turn, e: Event): boolean {
  if (turn.t_us !== e.t_us) return false;
  if (turn.nodes.includes(e.node)) return turn.nodes.length === 1;
  const last = turn.events[turn.events.length - 1];
  return (
    last !== undefined && SHARED.has(e.kind) && last.kind === e.kind && frameOf(last) === frameOf(e)
  );
}

export function turnsOf(events: Event[]): Turn[] {
  const turns: Turn[] = [];
  const senderOf = new Map<string, string>();
  for (const e of events) {
    let turn = turns[turns.length - 1];
    if (turn && sameMoment(turn, e)) {
      turn.events.push(e);
      if (!turn.nodes.includes(e.node)) turn.nodes.push(e.node);
    } else {
      turn = { nodes: [e.node], t_us: e.t_us, events: [e], arrivals: [] };
      turns.push(turn);
    }
    if (e.kind === "frame.tx") {
      turn.sent = e.frame;
      senderOf.set(e.frame, e.node);
    }
    if (e.kind === "frame.rx") {
      turn.arrivals.push({
        frame: e.frame,
        link: e.link,
        from: senderOf.get(e.frame) ?? "",
        node: e.node,
      });
    }
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
    for (const e of turn.events) {
      if (e.kind === "arp.learn" && e.node === node)
        rows.set(e.ip, { ip: e.ip, mac: e.mac, dev: e.dev, fresh: i === index });
    }
  });
  return [...rows.values()];
}

export interface MacRow {
  mac: string;
  port: string;
  /** Written during the turn being shown. */
  fresh: boolean;
}

/** A switch's MAC table as it stands after turn `index`. */
export function macTableAt(turns: Turn[], node: string, index: number): MacRow[] {
  const rows = new Map<string, MacRow>();
  turns.slice(0, index + 1).forEach((turn, i) => {
    for (const e of turn.events) {
      if (e.kind === "switch.learn" && e.node === node)
        rows.set(e.mac, { mac: e.mac, port: e.port, fresh: i === index });
    }
  });
  return [...rows.values()];
}

/** The route a node chose during a turn, for highlighting in its routing table. */
export function routeUsedIn(
  turn: Turn | undefined,
): { dst: string; via?: string | undefined; dev: string } | undefined {
  const lookup = turn?.events.find((e) => e.kind === "route.lookup");
  return lookup?.kind === "route.lookup" && lookup.route ? lookup.route : undefined;
}
