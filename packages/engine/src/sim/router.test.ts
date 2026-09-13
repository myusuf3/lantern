import { describe, expect, it } from "vitest";
import { cable, host, router, scenario } from "../fixtures/helpers.js";
import { loadScenario } from "../load.js";
import { dissect } from "../testing/tshark.js";
import type { Event } from "./events.js";
import { captureOf, simulate } from "./simulate.js";

/** a (10.0.1.10) - r (10.0.1.1 | 10.0.2.1) - b (10.0.2.10) */
function throughRouter() {
  return loadScenario(
    scenario(
      {
        nodes: [host("a", "l1"), router("r", "l1", "l2"), host("b", "l2")],
        links: [cable("l1", "a/eth0", "r/eth0"), cable("l2", "r/eth1", "b/eth0")],
      },
      [{ action: "ping", from: { name: "a" }, to: { name: "b" } }],
    ),
  );
}

const kinds = (events: Event[]) => events.map((e) => `${e.node}:${e.kind}`);

describe("simulate: through a router", () => {
  const run = simulate(throughRouter());

  it("has a ARP for the router, not the destination, and the router ARP for the destination", () => {
    const misses = run.events.filter((e) => e.kind === "arp.miss").map((e) => `${e.node}->${e.ip}`);
    expect(misses).toEqual(["a->10.0.1.1", "r->10.0.2.10"]);
  });

  it("forwards with a new frame but the same packet, losing one TTL and nothing else in the IP header", () => {
    const requests = Object.values(run.frames).filter(
      (f) => f.summary.icmp?.type === "echo-request",
    );
    expect(requests).toHaveLength(2);
    const [fromA, fromR] = requests.map((f) => f.summary);
    expect(fromA?.eth).toEqual({
      src: "02:00:00:00:00:01",
      dst: "02:00:00:00:00:02",
      type: "ipv4",
    });
    expect(fromR?.eth).toEqual({
      src: "02:00:00:00:00:03",
      dst: "02:00:00:00:00:04",
      type: "ipv4",
    });
    expect(fromA?.ip).toEqual({
      src: "10.0.1.10",
      dst: "10.0.2.10",
      ttl: 64,
      id: 1,
      protocol: "icmp",
    });
    expect(fromR?.ip).toEqual({
      src: "10.0.1.10",
      dst: "10.0.2.10",
      ttl: 63,
      id: 1,
      protocol: "icmp",
    });
    expect(fromA?.icmp).toEqual(fromR?.icmp);
  });

  it("logs the router's turn as decrement, lookup, resolve, send", () => {
    const first = kinds(run.events).indexOf("r:ttl.decrement");
    expect(kinds(run.events).slice(first, first + 4)).toEqual([
      "r:ttl.decrement",
      "r:route.lookup",
      "r:arp.miss",
      "r:frame.tx",
    ]);
    const decrement = run.events.find((e) => e.kind === "ttl.decrement");
    expect(decrement).toMatchObject({ packet: "10.0.1.10#1", before: 64, after: 63 });
  });

  it("mirrors the reply path and leaves the router knowing both hosts", () => {
    const replies = Object.values(run.frames).filter((f) => f.summary.icmp?.type === "echo-reply");
    expect(replies.map((f) => f.summary.ip?.ttl)).toEqual([64, 63]);
    const learned = run.events.flatMap((e) =>
      e.kind === "arp.learn" && e.node === "r" ? [e.ip] : [],
    );
    expect(learned).toEqual(["10.0.1.10", "10.0.2.10"]);
    expect(run.events.at(-1)).toMatchObject({ node: "a", kind: "icmp.recv", type: "echo-reply" });
  });

  it("drops a packet whose TTL runs out at the router and tells the sender", () => {
    const s = throughRouter();
    const [ping] = s.actions;
    if (ping?.action === "ping") ping.ttl = 1;
    const out = simulate(s);
    expect(out.events.filter((e) => e.kind === "drop")).toEqual([
      expect.objectContaining({ node: "r", reason: "ttl", packet: "10.0.1.10#1" }),
    ]);
    expect(out.events.at(-1)).toMatchObject({
      node: "a",
      kind: "icmp.recv",
      type: "time-exceeded",
      from: "10.0.1.1",
    });
  });

  it("cuts a capture where tshark sees the request and reply twice each, with TTL 64 then 63", async () => {
    const packets = await dissect(captureOf(run));
    expect(packets.map((p) => p.summary)).toEqual([
      "ARP request 10.0.1.10 -> 10.0.1.1",
      "ARP reply 10.0.1.1 -> 10.0.1.10",
      "ICMP echo-request 10.0.1.10 -> 10.0.2.10 ttl=64",
      "ARP request 10.0.2.1 -> 10.0.2.10",
      "ARP reply 10.0.2.10 -> 10.0.2.1",
      "ICMP echo-request 10.0.1.10 -> 10.0.2.10 ttl=63",
      "ICMP echo-reply 10.0.2.10 -> 10.0.1.10 ttl=64",
      "ICMP echo-reply 10.0.2.10 -> 10.0.1.10 ttl=63",
    ]);
    expect(packets.every((p) => p.checksumsGood && p.expertErrors.length === 0)).toBe(true);
  });
});
