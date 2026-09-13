import { describe, expect, it } from "vitest";
import { cable, host, router, scenario, sw } from "../fixtures/helpers.js";
import { loadScenario } from "../load.js";
import { dissect } from "../testing/tshark.js";
import type { Event } from "./events.js";
import { captureOf, simulate } from "./simulate.js";

/** a - sw - r - b, with the switch between a and the router. */
function throughSwitch(count = 1) {
  return loadScenario(
    scenario(
      {
        nodes: [host("a", "l1"), sw("sw", "l1", "l2"), router("r", "l2", "l3"), host("b", "l3")],
        links: [
          cable("l1", "a/eth0", "sw/p1"),
          cable("l2", "sw/p2", "r/eth0"),
          cable("l3", "r/eth1", "b/eth0"),
        ],
      },
      [{ action: "ping", from: { name: "a" }, to: { name: "b" }, count }],
    ),
  );
}

const kinds = (events: Event[]) => events.map((e) => `${e.node}:${e.kind}`);

describe("simulate: through a switch", () => {
  const run = simulate(throughSwitch());

  it("learns a's MAC on the first frame and floods it, because the destination is broadcast", () => {
    const first = kinds(run.events).indexOf("sw:frame.rx");
    expect(kinds(run.events).slice(first, first + 4)).toEqual([
      "sw:frame.rx",
      "sw:switch.learn",
      "sw:switch.flood",
      "sw:frame.tx",
    ]);
    expect(run.events.find((e) => e.kind === "switch.learn")).toMatchObject({
      mac: "02:00:00:00:00:01",
      port: "p1",
    });
    expect(run.events.find((e) => e.kind === "switch.flood")).toMatchObject({
      frame: "f0",
      in: "p1",
      out: ["p2"],
    });
  });

  it("re-transmits the same frame id, so the frame arrives at the router unchanged", () => {
    const txs = run.events
      .filter((e) => e.kind === "frame.tx" && e.frame === "f0")
      .map((e) => e.node);
    expect(txs).toEqual(["a", "sw"]);
    const rxs = run.events
      .filter((e) => e.kind === "frame.rx" && e.frame === "f0")
      .map((e) => e.node);
    expect(rxs).toEqual(["sw", "r"]);
  });

  it("forwards the reply to the port it learned a on, without flooding", () => {
    const forward = run.events.find((e) => e.kind === "switch.forward");
    expect(forward).toMatchObject({ frame: "f1", in: "p2", out: "p1" });
    const learned = run.events
      .filter((e) => e.kind === "switch.learn")
      .map((e) => `${e.mac}@${e.port}`);
    expect(learned).toEqual(["02:00:00:00:00:01@p1", "02:00:00:00:00:02@p2"]);
  });

  it("never floods once both MACs are known", () => {
    const two = simulate(throughSwitch(2));
    const floods = two.events.filter((e) => e.kind === "switch.flood");
    expect(floods).toHaveLength(1);
    expect(two.events.filter((e) => e.kind === "switch.learn")).toHaveLength(2);
  });

  it("puts each frame in the capture once even though the switch re-sends it", async () => {
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
