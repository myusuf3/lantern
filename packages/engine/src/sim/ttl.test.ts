import { describe, expect, it } from "vitest";
import { cable, host, router, scenario } from "../fixtures/helpers.js";
import { loadScenario } from "../load.js";
import type { ScenarioSpec } from "../schema.js";
import { dissect } from "../testing/tshark.js";
import type { Event } from "./events.js";
import { captureOf, simulate } from "./simulate.js";

/** laptop - r1 - r2 - r3 - server across 10.0.1 .. 10.0.4, every ARP table already warm. */
function chain(actions: ScenarioSpec["actions"], patch: (spec: ScenarioSpec) => void = () => {}) {
  const spec = scenario(
    {
      warm_arp: true,
      nodes: [
        host("laptop", "l1"),
        router("r1", "l1", "l2"),
        router("r2", "l2", "l3"),
        router("r3", "l3", "l4"),
        host("server", "l4"),
      ],
      links: [
        cable("l1", "laptop/eth0", "r1/eth0"),
        cable("l2", "r1/eth1", "r2/eth0"),
        cable("l3", "r2/eth1", "r3/eth0"),
        cable("l4", "r3/eth1", "server/eth0"),
      ],
    },
    actions,
  );
  patch(spec);
  return loadScenario(spec);
}

const ping = (ttl = 64) => ({
  action: "ping" as const,
  from: { name: "laptop" },
  to: { name: "server" },
  ttl,
});
const kinds = (events: Event[]) => events.map((e) => `${e.node}:${e.kind}`);
const received = (events: Event[]) =>
  events.flatMap((e) => (e.kind === "icmp.recv" ? [`${e.type} from ${e.from}`] : []));

describe("warm ARP tables", () => {
  it("fill every neighbour on every connected subnet, so no ARP happens at all", () => {
    const run = simulate(chain([ping()]));
    expect(run.events.some((e) => e.kind.startsWith("arp.") && e.kind !== "arp.hit")).toBe(false);
    const r1 = run.network.nodes.find((n) => n.id === "r1");
    expect(r1?.kind === "router" && r1.neighbors.map((n) => `${n.ip}@${n.dev}`)).toEqual([
      "10.0.1.10@eth0",
      "10.0.2.2@eth1",
    ]);
  });
});

describe("three routers", () => {
  const run = simulate(chain([ping()]));

  it("delivers with TTL 61 and brings the reply back with TTL 61", () => {
    const requests = Object.values(run.frames).filter(
      (f) => f.summary.icmp?.type === "echo-request",
    );
    expect(requests.map((f) => f.summary.ip?.ttl)).toEqual([64, 63, 62, 61]);
    const replies = Object.values(run.frames).filter((f) => f.summary.icmp?.type === "echo-reply");
    expect(replies.map((f) => f.summary.ip?.ttl)).toEqual([64, 63, 62, 61]);
    expect(received(run.events)).toEqual(["echo-reply from 10.0.4.10"]);
  });

  it("logs each hop as arrive, decrement, lookup, hit, send", () => {
    const r2 = kinds(run.events).filter((k) => k.startsWith("r2:"));
    expect(r2.slice(0, 5)).toEqual([
      "r2:frame.rx",
      "r2:ttl.decrement",
      "r2:route.lookup",
      "r2:arp.hit",
      "r2:frame.tx",
    ]);
  });
});

describe("time to live", () => {
  const run = simulate(chain([ping(2)]));

  it("dies at the second router, which sends time exceeded back from the interface it arrived on", () => {
    const r2 = kinds(run.events).filter((k) => k.startsWith("r2:"));
    expect(r2).toEqual([
      "r2:frame.rx",
      "r2:ttl.decrement",
      "r2:ttl.expired",
      "r2:drop",
      "r2:route.lookup",
      "r2:arp.hit",
      "r2:frame.tx",
    ]);
    const expired = run.events.find((e) => e.kind === "ttl.expired");
    expect(expired).toMatchObject({ packet: "10.0.1.10#1", reply_packet: "10.0.2.2#1" });
    expect(run.events.find((e) => e.kind === "drop")).toMatchObject({
      packet: "10.0.1.10#1",
      reason: "ttl",
    });
    expect(received(run.events)).toEqual(["time-exceeded from 10.0.2.2"]);
    expect(run.events.at(-1)).toMatchObject({
      node: "laptop",
      kind: "icmp.recv",
      packet: "10.0.1.10#1",
    });
  });

  it("quotes the dead packet's header and echo identifiers inside the time exceeded", () => {
    const te = Object.values(run.frames).find((f) => f.summary.icmp?.type === "time-exceeded");
    expect(te?.summary.ip).toMatchObject({ src: "10.0.2.2", dst: "10.0.1.10", ttl: 64 });
    expect(te?.summary.icmp).toEqual({
      type: "time-exceeded",
      original: { src: "10.0.1.10", dst: "10.0.4.10", id: 1, icmp_id: 1, icmp_seq: 1 },
    });
    expect(run.events.filter((e) => e.kind === "frame.tx")).toHaveLength(4);
  });

  it("produces a capture tshark reads as request, request, time exceeded, time exceeded", async () => {
    const packets = await dissect(captureOf(run));
    expect(packets.map((p) => p.summary)).toEqual([
      "ICMP echo-request 10.0.1.10 -> 10.0.4.10 ttl=2",
      "ICMP echo-request 10.0.1.10 -> 10.0.4.10 ttl=1",
      "ICMP time-exceeded 10.0.2.2 -> 10.0.1.10 ttl=64",
      "ICMP time-exceeded 10.0.2.2 -> 10.0.1.10 ttl=63",
    ]);
    expect(packets.every((p) => p.checksumsGood && p.expertErrors.length === 0)).toBe(true);
  });
});

describe("a routing loop", () => {
  const run = simulate(
    chain([ping(6)], (spec) => {
      const r2 = spec.network.nodes[2];
      if (r2?.kind !== "router") throw new Error("expected r2");
      r2.routes = [
        { dst: "10.0.4.0/24", via: "10.0.2.1" },
        { dst: "10.0.1.0/24", via: "10.0.2.1" },
      ];
    }),
  );

  it("bounces between the two routers until the TTL runs out, then reports time exceeded", () => {
    const decrements = run.events.flatMap((e) =>
      e.kind === "ttl.decrement" ? [`${e.node}:${e.after}`] : [],
    );
    // The last decrement is the time exceeded reply itself, crossing r1 on the way home.
    expect(decrements).toEqual(["r1:5", "r2:4", "r1:3", "r2:2", "r1:1", "r2:0", "r1:63"]);
    expect(received(run.events)).toEqual(["time-exceeded from 10.0.2.2"]);
    expect(run.events.some((e) => e.node === "r3")).toBe(false);
  });
});

describe("two ways home", () => {
  const run = simulate(
    loadScenario(
      scenario(
        {
          warm_arp: true,
          nodes: [
            host("laptop", "l1"),
            {
              id: "r1",
              kind: "router",
              interfaces: [
                { name: "eth0", link: "l1" },
                { name: "eth1", link: "l2" },
                { name: "eth2", link: "l5" },
              ],
              routes: [
                { dst: "10.0.4.0/24", via: "10.0.2.2", metric: 20 },
                { dst: "10.0.4.0/24", via: "10.0.5.2", metric: 10 },
              ],
            },
            router("r2", "l2", "l3"),
            {
              id: "r3",
              kind: "router",
              interfaces: [
                { name: "eth0", link: "l3" },
                { name: "eth1", link: "l4" },
                { name: "eth2", link: "l5" },
              ],
              routes: [{ dst: "10.0.1.0/24", via: "10.0.5.1", metric: 10 }],
            },
            host("server", "l4"),
          ],
          links: [
            cable("l1", "laptop/eth0", "r1/eth0"),
            cable("l2", "r1/eth1", "r2/eth0"),
            cable("l3", "r2/eth1", "r3/eth0"),
            cable("l4", "r3/eth1", "server/eth0"),
            cable("l5", "r1/eth2", "r3/eth2"),
          ],
        },
        [ping()],
      ),
    ),
  );

  it("takes the route with the lower metric and skips the middle router", () => {
    const lookup = run.events.find((e) => e.kind === "route.lookup" && e.node === "r1");
    expect(lookup?.kind === "route.lookup" && lookup.route).toMatchObject({
      via: "10.0.5.2",
      metric: 10,
    });
    expect(run.events.some((e) => e.node === "r2")).toBe(false);
    expect(received(run.events)).toEqual(["echo-reply from 10.0.4.10"]);
    const request = Object.values(run.frames).filter(
      (f) => f.summary.icmp?.type === "echo-request",
    );
    expect(request.map((f) => f.summary.ip?.ttl)).toEqual([64, 63, 62]);
  });
});

describe("traceroute", () => {
  const run = simulate(
    chain([{ action: "traceroute", from: { name: "laptop" }, to: { name: "server" }, max_ttl: 8 }]),
  );

  it("hears from each router in turn, then the server", () => {
    expect(received(run.events)).toEqual([
      "time-exceeded from 10.0.1.1",
      "time-exceeded from 10.0.2.2",
      "time-exceeded from 10.0.3.2",
      "echo-reply from 10.0.4.10",
    ]);
  });

  it("sends probes with TTL 1, 2, 3, 4 and stops", () => {
    const probes = run.events.flatMap((e) =>
      e.kind === "frame.tx" && e.node === "laptop" ? [run.frames[e.frame]?.summary.ip?.ttl] : [],
    );
    expect(probes).toEqual([1, 2, 3, 4]);
  });
});
