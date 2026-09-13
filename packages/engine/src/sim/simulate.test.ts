import { describe, expect, it } from "vitest";
import { cable, host, scenario } from "../fixtures/helpers.js";
import { loadScenario } from "../load.js";
import { DEFAULT_LATENCY_US } from "../resolve.js";
import type { L3NodeSpec, ScenarioSpec } from "../schema.js";
import { dissect } from "../testing/tshark.js";
import { hex } from "../wire/bytes.js";
import { writePcap } from "../wire/pcap.js";
import type { Event } from "./events.js";
import { captureOf, PROCESSING_US, simulate } from "./simulate.js";

/** Two laptops and one cable. a is 10.0.1.10, b is 10.0.1.11. */
function twoHosts(actions: ScenarioSpec["actions"], a: Partial<L3NodeSpec> = {}) {
  return loadScenario(
    scenario(
      { nodes: [host("a", "l1", a), host("b", "l1")], links: [cable("l1", "a/eth0", "b/eth0")] },
      actions,
    ),
  );
}

const pingAtoB = { action: "ping" as const, from: { name: "a" }, to: { name: "b" } };

function kinds(events: Event[]): string[] {
  return events.map((e) => `${e.node}:${e.kind}`);
}

describe("simulate: two hosts on a cable", () => {
  it("resolves the neighbour with ARP, then pings, in the order a reader would narrate it", () => {
    const run = simulate(twoHosts([pingAtoB]));
    expect(kinds(run.events)).toEqual([
      "a:route.lookup",
      "a:arp.miss",
      "a:frame.tx",
      "b:frame.rx",
      "b:arp.learn",
      "b:arp.reply",
      "b:frame.tx",
      "a:frame.rx",
      "a:arp.learn",
      "a:frame.tx",
      "b:frame.rx",
      "b:icmp.reply",
      "b:route.lookup",
      "b:arp.hit",
      "b:frame.tx",
      "a:frame.rx",
      "a:icmp.recv",
    ]);
  });

  it("puts the right addresses in each frame", () => {
    const run = simulate(twoHosts([pingAtoB]));
    const summaries = Object.values(run.frames).map((f) => f.summary);
    expect(summaries.map((s) => [s.eth.src, s.eth.dst, s.arp?.op ?? s.icmp?.type])).toEqual([
      ["02:00:00:00:00:01", "ff:ff:ff:ff:ff:ff", "request"],
      ["02:00:00:00:00:02", "02:00:00:00:00:01", "reply"],
      ["02:00:00:00:00:01", "02:00:00:00:00:02", "echo-request"],
      ["02:00:00:00:00:02", "02:00:00:00:00:01", "echo-reply"],
    ]);
    expect(summaries[2]?.ip).toMatchObject({ src: "10.0.1.10", dst: "10.0.1.11", ttl: 64 });
  });

  it("carries the same frame id from tx to rx and a stable packet id from request to reply", () => {
    const run = simulate(twoHosts([pingAtoB]));
    const tx = run.events.filter((e) => e.kind === "frame.tx");
    const rx = run.events.filter((e) => e.kind === "frame.rx");
    expect(tx.map((e) => e.frame)).toEqual(rx.map((e) => e.frame));

    const reply = run.events.find((e) => e.kind === "icmp.reply");
    const recv = run.events.find((e) => e.kind === "icmp.recv");
    const parked = run.events.find((e) => e.kind === "arp.miss");
    expect(reply?.packet).toBe(parked?.parked);
    expect(recv).toMatchObject({ packet: parked?.parked, type: "echo-reply", from: "10.0.1.11" });
  });

  it("reports the first round trip including ARP, and the second without it", () => {
    const run = simulate(twoHosts([{ ...pingAtoB, count: 2 }]));
    const rtts = run.events.filter((e) => e.kind === "icmp.recv").map((e) => e.rtt_us);
    const oneWay = DEFAULT_LATENCY_US + PROCESSING_US;
    expect(rtts).toEqual([4 * oneWay, 2 * oneWay]);
  });

  it("stamps every event with the action index and keeps time and seq monotonic", () => {
    const run = simulate(twoHosts([pingAtoB, pingAtoB]));
    expect(new Set(run.events.map((e) => e.action))).toEqual(new Set([0, 1]));
    run.events.forEach((e, i) => {
      expect(e.seq).toBe(i);
      if (i > 0) expect(e.t_us).toBeGreaterThanOrEqual(run.events[i - 1]?.t_us ?? 0);
    });
  });

  it("does no ARP on the second ping because both tables are warm", () => {
    const run = simulate(twoHosts([{ ...pingAtoB, count: 2 }]));
    const second = run.events.filter((e) => e.t_us >= 1_000_000);
    expect(second.some((e) => e.kind.startsWith("arp.") && e.kind !== "arp.hit")).toBe(false);
    expect(second.filter((e) => e.kind === "arp.hit")).toHaveLength(2);
    expect(run.events.filter((e) => e.kind === "icmp.recv")).toHaveLength(2);
  });

  it("does no ARP on the first ping when the neighbour is pre-seeded", () => {
    const run = simulate(
      twoHosts([pingAtoB], { neighbors: [{ ip: "10.0.1.11", mac: "02:00:00:00:00:02" }] }),
    );
    expect(kinds(run.events).slice(0, 3)).toEqual(["a:route.lookup", "a:arp.hit", "a:frame.tx"]);
  });

  it("drops a packet with no route and says so once", () => {
    // a and b share a cable; b also reaches c. a has no router on its subnet, so no default route.
    const scenario = loadScenario({
      version: 1,
      network: {
        nodes: [
          host("a", "l1"),
          {
            id: "b",
            kind: "host",
            interfaces: [
              { name: "eth0", link: "l1" },
              { name: "eth1", link: "l2" },
            ],
          },
          host("c", "l2"),
        ],
        links: [
          { id: "l1", a: "a/eth0", b: "b/eth0" },
          { id: "l2", a: "b/eth1", b: "c/eth0" },
        ],
      },
      actions: [{ action: "ping", from: { name: "a" }, to: { name: "c" } }],
    });
    const run = simulate(scenario);
    expect(kinds(run.events)).toEqual(["a:route.lookup", "a:drop"]);
    expect(run.events[1]).toMatchObject({ kind: "drop", reason: "no-route" });
    expect(Object.keys(run.frames)).toHaveLength(0);
  });

  it("is deterministic", () => {
    const a = JSON.stringify(simulate(twoHosts([pingAtoB, pingAtoB])));
    const b = JSON.stringify(simulate(twoHosts([pingAtoB, pingAtoB])));
    expect(a).toBe(b);
  });

  it("returns the resolved network so the UI never resolves", () => {
    const s = twoHosts([pingAtoB]);
    expect(simulate(s).network).toEqual(s.network);
  });

  it("cuts a merged pcap with every frame once, in time order, that tshark dissects cleanly", async () => {
    const run = simulate(twoHosts([{ ...pingAtoB, count: 2 }]));
    const capture = captureOf(run);
    const packets = await dissect(capture);
    expect(packets.map((p) => p.summary)).toEqual([
      "ARP request 10.0.1.10 -> 10.0.1.11",
      "ARP reply 10.0.1.11 -> 10.0.1.10",
      "ICMP echo-request 10.0.1.10 -> 10.0.1.11 ttl=64",
      "ICMP echo-reply 10.0.1.11 -> 10.0.1.10 ttl=64",
      "ICMP echo-request 10.0.1.10 -> 10.0.1.11 ttl=64",
      "ICMP echo-reply 10.0.1.11 -> 10.0.1.10 ttl=64",
    ]);
    expect(packets.every((p) => p.checksumsGood && p.expertErrors.length === 0)).toBe(true);

    const txTimes = run.events.filter((e) => e.kind === "frame.tx").map((e) => e.t_us);
    expect(packets.map((p) => p.t_us)).toEqual(txTimes);
    expect(capture).toEqual(
      writePcap(
        run.events
          .filter((e) => e.kind === "frame.tx")
          .map((e) => ({ t_us: e.t_us, bytes: hex(run.frames[e.frame]?.bytes ?? "") })),
      ),
    );
  });
});
