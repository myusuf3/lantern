import { cidrContains, parseCidr, parseIp, stripPrefix } from "../addr.js";
import { DEFAULT_TTL } from "../resolve.js";
import {
  type Interface,
  isL3,
  type L3Node,
  type Link,
  type Route,
  type Scenario,
  type SwitchNode,
} from "../schema.js";
import { type ArpPacket, decodeArp, encodeArp } from "../wire/arp.js";
import { hex, toHex, Writer } from "../wire/bytes.js";
import {
  BROADCAST_MAC,
  decodeEthernet,
  ETHERTYPE_ARP,
  ETHERTYPE_IPV4,
  encodeEthernet,
} from "../wire/ethernet.js";
import { summarizeFrame } from "../wire/frame.js";
import { decodeIcmp, encodeIcmp, type IcmpMessage } from "../wire/icmp.js";
import { decodeIpv4, encodeIpv4, type Ipv4Header, PROTO_ICMP } from "../wire/ipv4.js";
import { writePcap } from "../wire/pcap.js";
import type { DropReason, Event, EventBody, FrameRecord, RunResult } from "./events.js";

/** Time a node takes to handle one frame. Only affects ordering and pcap timestamps. */
export const PROCESSING_US = 10;
/** Like `ping`: one echo request per second. */
export const PING_INTERVAL_US = 1_000_000;
const ZERO_MAC = "00:00:00:00:00:00";
const ECHO_PAYLOAD_LEN = 56;

/** Run every action of a scenario to completion and return the log, the frames, and the network. */
export function simulate(scenario: Scenario): RunResult {
  const sim = new Simulation(scenario);
  sim.run();
  return { network: scenario.network, events: sim.events, frames: sim.frames };
}

/** The merged capture: every frame once, at its first transmission, in time order. */
export function captureOf(run: RunResult): Uint8Array {
  const seen = new Set<string>();
  const records = [];
  for (const e of run.events) {
    if (e.kind !== "frame.tx" || seen.has(e.frame)) continue;
    seen.add(e.frame);
    records.push({ t_us: e.t_us, bytes: hex(run.frames[e.frame]?.bytes ?? "") });
  }
  return writePcap(records);
}

interface Frame {
  id: string;
  bytes: Uint8Array;
}

interface Packet {
  header: Ipv4Header;
  payload: Uint8Array;
}

/**
 * How events name an IP packet: `src#identification`, e.g. `10.0.1.10#1`. Not on the wire; both
 * halves are real header fields that routers preserve, so the same id follows the packet across
 * hops while the frame id changes at each one. See "Packet ids" in docs/engine-design.md.
 */
function packetId(h: Ipv4Header): string {
  return `${h.src}#${h.id}`;
}

interface Timer {
  t: number;
  fn: () => void;
}

interface LinkEnd {
  link: Link;
  peer: { node: string; iface: string };
}

class Simulation {
  now = 0;
  action = 0;
  readonly events: Event[] = [];
  readonly frames: Record<string, FrameRecord> = {};
  private readonly timers: Timer[] = [];
  private readonly nodes = new Map<string, Host | Switch>();
  private readonly ends = new Map<string, LinkEnd>();
  private frameCount = 0;

  constructor(private readonly scenario: Scenario) {
    for (const n of scenario.network.nodes) {
      this.nodes.set(n.id, isL3(n) ? new Host(this, n) : new Switch(this, n));
    }
    for (const link of scenario.network.links) {
      const [a, b] = [parseRef(link.a), parseRef(link.b)];
      this.ends.set(link.a, { link, peer: b });
      this.ends.set(link.b, { link, peer: a });
    }
  }

  run(): void {
    this.scenario.actions.forEach((action, index) => {
      this.action = index;
      const from = this.hostOwning(action.from.ip);
      if (action.action === "ping")
        from.ping(action.from.ip, action.to.ip, action.ttl, action.count);
      else from.traceroute(action.from.ip, action.to.ip, action.max_ttl);
      this.drain();
    });
  }

  private drain(): void {
    for (let timer = this.timers.shift(); timer; timer = this.timers.shift()) {
      this.now = timer.t;
      timer.fn();
    }
  }

  /** Timers fire by time; ties keep insertion order, so runs are deterministic. */
  schedule(delay: number, fn: () => void): void {
    const t = this.now + delay;
    const i = this.timers.findIndex((x) => x.t > t);
    this.timers.splice(i === -1 ? this.timers.length : i, 0, { t, fn });
  }

  emit(node: string, body: EventBody): void {
    this.events.push({
      seq: this.events.length,
      t_us: this.now,
      action: this.action,
      node,
      ...body,
    });
  }

  /** Record a frame once. A switch re-transmits the same frame; a router mints a new one. */
  newFrame(bytes: Uint8Array): Frame {
    const id = `f${this.frameCount++}`;
    this.frames[id] = { bytes: toHex(bytes), summary: summarizeFrame(bytes) };
    return { id, bytes };
  }

  /** Put a frame on the wire from one interface; it arrives at the far end after the link latency. */
  transmit(node: string, dev: string, frame: Frame): void {
    const end = this.ends.get(`${node}/${dev}`);
    if (!end) throw new Error(`${node}/${dev} is not on any link`);
    this.emit(node, { kind: "frame.tx", dev, link: end.link.id, frame: frame.id });
    this.schedule(end.link.latency_us, () =>
      this.receive(end.peer.node, end.peer.iface, frame, end.link.id),
    );
  }

  private receive(node: string, dev: string, frame: Frame, link: string): void {
    this.emit(node, { kind: "frame.rx", dev, link, frame: frame.id });
    const target = this.nodes.get(node);
    if (target) this.schedule(PROCESSING_US, () => target.handleFrame(dev, frame));
  }

  private hostOwning(ip: string): Host {
    for (const n of this.nodes.values()) if (n instanceof Host && n.ownsIp(ip)) return n;
    throw new Error(`no host owns ${ip}`);
  }
}

function parseRef(ref: string): { node: string; iface: string } {
  const [node = "", iface = ""] = ref.split("/");
  return { node, iface };
}

type EchoMessage = Extract<IcmpMessage, { id: number }>;
type Answer = "echo-reply" | "time-exceeded";

/** The echo an ICMP message answers: itself for a reply, or the one a time exceeded quotes. */
function probeOf(message: IcmpMessage): EchoMessage | undefined {
  if (message.type !== "time-exceeded") return message;
  const quoted = decodeIcmp(decodeIpv4(message.original).payload).message;
  return quoted.type === "time-exceeded" ? undefined : quoted;
}

interface Probe {
  packet: string;
  sentAt: number;
  answered?: ((type: Answer) => void) | undefined;
}

/** A host or router: an IP stack with an ARP table, a routing table, and an ICMP echo responder. */
class Host {
  private readonly ifaces: Map<string, Interface>;
  private readonly ownIps: Set<number>;
  private readonly routes: { route: Route; prefix: number; cidr: ReturnType<typeof parseCidr> }[];
  private readonly neighbors = new Map<string, { mac: string; dev: string }>();
  private readonly pending = new Map<string, Packet[]>();
  private readonly probes = new Map<string, Probe>();
  private ipId = 0;
  private echoId = 0;

  constructor(
    private readonly sim: Simulation,
    readonly config: L3Node,
  ) {
    this.ifaces = new Map(config.interfaces.map((i) => [i.name, i]));
    this.ownIps = new Set(config.interfaces.map((i) => parseCidr(i.ip).ip));
    this.routes = config.routes.map((route) => {
      const cidr = parseCidr(route.dst);
      return { route, prefix: cidr.prefix, cidr };
    });
    for (const n of config.neighbors) this.neighbors.set(n.ip, { mac: n.mac, dev: n.dev });
  }

  get id(): string {
    return this.config.id;
  }

  ownsIp(ip: string): boolean {
    return this.ownIps.has(parseIp(ip));
  }

  private iface(dev: string): Interface {
    const found = this.ifaces.get(dev);
    if (!found) throw new Error(`${this.id} has no interface ${dev}`);
    return found;
  }

  ping(src: string, dst: string, ttl: number, count: number): void {
    const id = ++this.echoId;
    for (let seq = 1; seq <= count; seq++) {
      this.sim.schedule((seq - 1) * PING_INTERVAL_US, () => this.sendEcho(src, dst, ttl, id, seq));
    }
  }

  /** Ping with TTL 1, 2, 3, ... until an echo reply comes back or the limit is reached. */
  traceroute(src: string, dst: string, maxTtl: number): void {
    const id = ++this.echoId;
    const probe = (ttl: number) =>
      this.sendEcho(src, dst, ttl, id, ttl, (answer) => {
        if (answer === "time-exceeded" && ttl < maxTtl) probe(ttl + 1);
      });
    probe(1);
  }

  private sendEcho(
    src: string,
    dst: string,
    ttl: number,
    id: number,
    seq: number,
    answered?: Probe["answered"],
  ): void {
    // Like Linux ping: a timestamp, then an incrementing byte pattern.
    const payload = new Writer(ECHO_PAYLOAD_LEN).u32(0).u32(this.sim.now).bytes;
    for (let i = 8; i < ECHO_PAYLOAD_LEN; i++) payload[i] = 0x10 + (i - 8);
    const packet = this.icmpPacket(
      src,
      dst,
      ttl,
      encodeIcmp({ type: "echo-request", id, seq, payload }),
    );
    this.probes.set(`${id}:${seq}`, {
      packet: packetId(packet.header),
      sentAt: this.sim.now,
      answered,
    });
    this.sendIp(packet);
  }

  private icmpPacket(src: string, dst: string, ttl: number, icmp: Uint8Array): Packet {
    return { header: { id: ++this.ipId, ttl, protocol: PROTO_ICMP, src, dst }, payload: icmp };
  }

  /** Longest prefix wins, then lowest metric, then declaration order. */
  private lookupRoute(dst: string): Route | undefined {
    const target = parseIp(dst);
    let best: (typeof this.routes)[number] | undefined;
    for (const r of this.routes) {
      if (!cidrContains(r.cidr, target)) continue;
      if (
        !best ||
        r.prefix > best.prefix ||
        (r.prefix === best.prefix && r.route.metric < best.route.metric)
      ) {
        best = r;
      }
    }
    return best?.route;
  }

  private sendIp(packet: Packet): void {
    const { dst } = packet.header;
    const route = this.lookupRoute(dst);
    if (!route) {
      this.sim.emit(this.id, { kind: "route.lookup", dst, route: null });
      this.drop({ packet: packetId(packet.header) }, "no-route");
      return;
    }
    const nextHop = route.via ?? dst;
    this.sim.emit(this.id, { kind: "route.lookup", dst, route, dev: route.dev, next_hop: nextHop });

    const neighbor = this.neighbors.get(nextHop);
    if (neighbor) {
      this.sim.emit(this.id, {
        kind: "arp.hit",
        ip: nextHop,
        mac: neighbor.mac,
        dev: neighbor.dev,
      });
      this.transmitIp(packet, neighbor.dev, neighbor.mac);
      return;
    }
    this.sim.emit(this.id, {
      kind: "arp.miss",
      ip: nextHop,
      dev: route.dev,
      parked: packetId(packet.header),
    });
    const parked = this.pending.get(nextHop);
    if (parked) {
      parked.push(packet);
      return;
    }
    this.pending.set(nextHop, [packet]);
    this.sim.transmit(
      this.id,
      route.dev,
      this.arpFrame("request", route.dev, BROADCAST_MAC, ZERO_MAC, nextHop),
    );
  }

  private transmitIp(packet: Packet, dev: string, dstMac: string): void {
    this.sim.transmit(
      this.id,
      dev,
      this.frame(dev, dstMac, ETHERTYPE_IPV4, encodeIpv4(packet.header, packet.payload)),
    );
  }

  private frame(dev: string, dstMac: string, type: number, payload: Uint8Array): Frame {
    return this.sim.newFrame(
      encodeEthernet({ dst: dstMac, src: this.iface(dev).mac, type }, payload),
    );
  }

  private arpFrame(
    op: ArpPacket["op"],
    dev: string,
    dstMac: string,
    targetMac: string,
    targetIp: string,
  ): Frame {
    const iface = this.iface(dev);
    const arp = encodeArp({
      op,
      senderMac: iface.mac,
      senderIp: stripPrefix(iface.ip),
      targetMac,
      targetIp,
    });
    return this.frame(dev, dstMac, ETHERTYPE_ARP, arp);
  }

  handleFrame(dev: string, frame: Frame): void {
    const { header, payload } = decodeEthernet(frame.bytes);
    if (header.dst !== this.iface(dev).mac && header.dst !== BROADCAST_MAC) {
      this.drop({ frame: frame.id }, "not-our-mac");
      return;
    }
    if (header.type === ETHERTYPE_ARP) this.handleArp(dev, frame, decodeArp(payload));
    else if (header.type === ETHERTYPE_IPV4) this.handleIp(frame, decodeIpv4(payload));
  }

  private handleArp(dev: string, frame: Frame, arp: ArpPacket): void {
    if (parseIp(arp.targetIp) !== parseCidr(this.iface(dev).ip).ip) {
      this.drop({ frame: frame.id }, "not-our-ip");
      return;
    }
    this.learn(arp.senderIp, arp.senderMac, dev);
    if (arp.op === "request") {
      const reply = this.arpFrame("reply", dev, arp.senderMac, arp.senderMac, arp.senderIp);
      this.sim.emit(this.id, { kind: "arp.reply", ip: arp.targetIp, dev, reply_frame: reply.id });
      this.sim.transmit(this.id, dev, reply);
      return;
    }
    const parked = this.pending.get(arp.senderIp) ?? [];
    this.pending.delete(arp.senderIp);
    for (const packet of parked) this.transmitIp(packet, dev, arp.senderMac);
  }

  private learn(ip: string, mac: string, dev: string): void {
    this.neighbors.set(ip, { mac, dev });
    this.sim.emit(this.id, { kind: "arp.learn", ip, mac, dev });
  }

  private handleIp(frame: Frame, packet: Packet): void {
    if (!this.ownsIp(packet.header.dst)) {
      if (this.config.kind === "router") this.forward(packet);
      else this.drop({ frame: frame.id, packet: packetId(packet.header) }, "not-our-ip");
      return;
    }
    if (packet.header.protocol !== PROTO_ICMP) return;
    const { message } = decodeIcmp(packet.payload);
    if (message.type === "echo-request") this.answerEcho(packet, message);
    else this.receiveIcmp(packet, message);
  }

  /** What makes a router a router: lower the TTL and send the packet on with its own lookup. */
  private forward(packet: Packet): void {
    const id = packetId(packet.header);
    const after = packet.header.ttl - 1;
    this.sim.emit(this.id, { kind: "ttl.decrement", packet: id, before: packet.header.ttl, after });
    if (after <= 0) {
      this.drop({ packet: id }, "ttl");
      return;
    }
    this.sendIp({ header: { ...packet.header, ttl: after }, payload: packet.payload });
  }

  private answerEcho(request: Packet, echo: EchoMessage): void {
    const { src, dst } = request.header;
    const icmp = encodeIcmp({
      type: "echo-reply",
      id: echo.id,
      seq: echo.seq,
      payload: echo.payload,
    });
    const reply = this.icmpPacket(dst, src, DEFAULT_TTL, icmp);
    this.sim.emit(this.id, {
      kind: "icmp.reply",
      packet: packetId(request.header),
      reply_packet: packetId(reply.header),
    });
    this.sendIp(reply);
  }

  private receiveIcmp(packet: Packet, message: IcmpMessage): void {
    const echo = probeOf(message);
    const key = echo ? `${echo.id}:${echo.seq}` : "";
    const probe = this.probes.get(key);
    // Nothing is waiting for it; a real stack discards it silently.
    if (!probe) return;
    this.probes.delete(key);
    const type: Answer = message.type === "time-exceeded" ? "time-exceeded" : "echo-reply";
    this.sim.emit(this.id, {
      kind: "icmp.recv",
      packet: probe.packet,
      type,
      from: packet.header.src,
      rtt_us: this.sim.now - probe.sentAt,
    });
    probe.answered?.(type);
  }

  private drop(what: { frame?: string; packet?: string }, reason: DropReason): void {
    this.sim.emit(this.id, { kind: "drop", ...what, reason });
  }
}

/** A learning switch: remembers which port each source MAC arrived on, forwards or floods by destination. */
class Switch {
  private readonly table = new Map<string, string>();
  private readonly ports: string[];

  constructor(
    private readonly sim: Simulation,
    readonly config: SwitchNode,
  ) {
    this.ports = config.interfaces.map((p) => p.name);
  }

  get id(): string {
    return this.config.id;
  }

  handleFrame(dev: string, frame: Frame): void {
    const { header } = decodeEthernet(frame.bytes);
    if (this.table.get(header.src) !== dev) {
      this.table.set(header.src, dev);
      this.sim.emit(this.id, { kind: "switch.learn", mac: header.src, port: dev });
    }
    const known = header.dst === BROADCAST_MAC ? undefined : this.table.get(header.dst);
    const out = known ? [known] : this.ports.filter((p) => p !== dev);
    if (known)
      this.sim.emit(this.id, { kind: "switch.forward", frame: frame.id, in: dev, out: known });
    else this.sim.emit(this.id, { kind: "switch.flood", frame: frame.id, in: dev, out });
    for (const port of out) this.sim.transmit(this.id, port, frame);
  }
}
