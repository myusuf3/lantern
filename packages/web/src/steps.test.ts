import type { Event, RunResult } from "@lantern/engine";
import { loadScenario, simulate } from "@lantern/engine";
import { describe, expect, it } from "vitest";
import { arpTableAt, macTableAt, turnsOf } from "./steps.js";

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
      turns.map(
        (t) => `${t.nodes.join("+")}@${t.t_us}:${t.events.map((e: Event) => e.kind).join(",")}`,
      ),
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

  it("marks a turn that receives a frame with the frame, the link it crossed, and where it landed", () => {
    const turns = turnsOf(run.events);
    expect(turns[1]?.arrivals).toEqual([
      { frame: "f0", link: "cable", from: "laptop", node: "server" },
    ]);
    expect(turns[0]?.arrivals).toEqual([]);
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
  it("grows as switch.learn events pass", () => {
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

describe("turnsOf with a flood", () => {
  const flooded = simulate(
    loadScenario({
      version: 1,
      network: {
        nodes: [
          { id: "laptop", kind: "host", interfaces: [{ name: "eth0", link: "l1" }] },
          {
            id: "sw",
            kind: "switch",
            interfaces: [
              { name: "p1", link: "l1" },
              { name: "p2", link: "l2" },
              { name: "p3", link: "l3" },
              { name: "p4", link: "l4" },
            ],
          },
          {
            id: "router",
            kind: "router",
            interfaces: [
              { name: "eth0", link: "l2" },
              { name: "eth1", link: "l5" },
            ],
          },
          { id: "desktop", kind: "host", interfaces: [{ name: "eth0", link: "l3" }] },
          { id: "printer", kind: "host", interfaces: [{ name: "eth0", link: "l4" }] },
          { id: "server", kind: "host", interfaces: [{ name: "eth0", link: "l5" }] },
        ],
        links: [
          { id: "l1", a: "laptop/eth0", b: "sw/p1" },
          { id: "l2", a: "sw/p2", b: "router/eth0" },
          { id: "l3", a: "sw/p3", b: "desktop/eth0" },
          { id: "l4", a: "sw/p4", b: "printer/eth0" },
          { id: "l5", a: "router/eth1", b: "server/eth0" },
        ],
      },
      actions: [{ action: "ping", from: { name: "laptop" }, to: { name: "server" } }],
    }),
  );

  it("groups the same frame arriving at several machines at once into one turn", () => {
    const turns = turnsOf(flooded.events);
    expect(turns[2]?.events.map((e) => e.kind)).toEqual([
      "switch.learn",
      "switch.flood",
      "frame.tx",
      "frame.tx",
      "frame.tx",
    ]);
    expect(turns[3]?.nodes).toEqual(["router", "desktop", "printer"]);
    expect(turns[3]?.arrivals.map((a) => `${a.link}->${a.node}`)).toEqual([
      "l2->router",
      "l3->desktop",
      "l4->printer",
    ]);
  });

  it("groups the machines that discard it into one turn, after the one that answers", () => {
    const turns = turnsOf(flooded.events);
    expect(turns[4]?.nodes).toEqual(["router"]);
    expect(turns[4]?.events.map((e) => e.kind)).toEqual(["arp.learn", "arp.reply", "frame.tx"]);
    expect(turns[5]?.nodes).toEqual(["desktop", "printer"]);
    expect(turns[5]?.events.map((e) => e.kind)).toEqual(["drop", "drop"]);
  });
});
