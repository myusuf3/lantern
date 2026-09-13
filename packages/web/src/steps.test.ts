import type { Event, RunResult } from "@lantern/engine";
import { loadScenario, simulate } from "@lantern/engine";
import { describe, expect, it } from "vitest";
import { arpTableAt, turnsOf } from "./steps.js";

const run: RunResult = simulate(
  loadScenario({
    version: 1,
    network: {
      nodes: [
        { id: "laptop", kind: "host", interfaces: [{ name: "eth0", link: "cable" }] },
        { id: "server", kind: "host", interfaces: [{ name: "eth0", link: "cable" }] },
      ],
      links: [{ id: "cable", a: "laptop/eth0", b: "server/eth0" }],
    },
    actions: [{ action: "ping", from: { name: "laptop" }, to: { name: "server" }, count: 2 }],
  }),
);

describe("turnsOf", () => {
  it("groups events into one turn per node per instant", () => {
    const turns = turnsOf(run.events);
    expect(
      turns.map((t) => `${t.node}@${t.t_us}:${t.events.map((e: Event) => e.kind).join(",")}`),
    ).toEqual([
      "laptop@0:route.lookup,arp.miss,frame.tx",
      "server@1000:frame.rx",
      "server@1010:arp.learn,arp.reply,frame.tx",
      "laptop@2010:frame.rx",
      "laptop@2020:arp.learn,frame.tx",
      "server@3020:frame.rx",
      "server@3030:icmp.reply,route.lookup,arp.hit,frame.tx",
      "laptop@4030:frame.rx",
      "laptop@4040:icmp.recv",
      "laptop@1000000:route.lookup,arp.hit,frame.tx",
      "server@1001000:frame.rx",
      "server@1001010:icmp.reply,route.lookup,arp.hit,frame.tx",
      "laptop@1002010:frame.rx",
      "laptop@1002020:icmp.recv",
    ]);
  });

  it("marks a turn that receives a frame with the frame and the link it crossed", () => {
    const turns = turnsOf(run.events);
    expect(turns[1]?.arriving).toEqual({ frame: "f0", link: "cable", from: "laptop" });
    expect(turns[0]?.arriving).toBeUndefined();
  });

  it("names the frame a turn sends, if any", () => {
    const turns = turnsOf(run.events);
    expect(turns[0]?.sent).toBe("f0");
    expect(turns[1]?.sent).toBeUndefined();
  });
});

describe("arpTableAt", () => {
  it("starts from the configured neighbors and grows as arp.learn events pass", () => {
    const turns = turnsOf(run.events);
    expect(arpTableAt(run, turns, "laptop", 0)).toEqual([]);
    expect(arpTableAt(run, turns, "server", 2)).toEqual([
      { ip: "10.0.1.10", mac: "02:00:00:00:00:01", dev: "eth0", fresh: true },
    ]);
    expect(arpTableAt(run, turns, "server", 3)).toEqual([
      { ip: "10.0.1.10", mac: "02:00:00:00:00:01", dev: "eth0", fresh: false },
    ]);
    expect(arpTableAt(run, turns, "laptop", 4)).toEqual([
      { ip: "10.0.1.11", mac: "02:00:00:00:00:02", dev: "eth0", fresh: true },
    ]);
  });
});

describe("macTableAt", () => {
  it("grows as switch.learn events pass", async () => {
    const { macTableAt } = await import("./steps.js");
    const viaSwitch = simulate(
      loadScenario({
        version: 1,
        network: {
          nodes: [
            { id: "a", kind: "host", interfaces: [{ name: "eth0", link: "l1" }] },
            {
              id: "sw",
              kind: "switch",
              interfaces: [
                { name: "p1", link: "l1" },
                { name: "p2", link: "l2" },
              ],
            },
            { id: "b", kind: "host", interfaces: [{ name: "eth0", link: "l2" }] },
          ],
          links: [
            { id: "l1", a: "a/eth0", b: "sw/p1" },
            { id: "l2", a: "sw/p2", b: "b/eth0" },
          ],
        },
        actions: [{ action: "ping", from: { name: "a" }, to: { name: "b" } }],
      }),
    );
    const turns = turnsOf(viaSwitch.events);
    expect(macTableAt(turns, "sw", 1)).toEqual([]);
    expect(macTableAt(turns, "sw", 2)).toEqual([
      { mac: "02:00:00:00:00:01", port: "p1", fresh: true },
    ]);
  });
});
