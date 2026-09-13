import { describe, expect, it } from "vitest";
import { clone, l3 } from "./fixtures/helpers.js";
import { lesson2Minimal, lesson2Resolved } from "./fixtures/lesson2.js";
import { resolveScenario } from "./resolve.js";
import type { NetworkSpec, ScenarioSpec } from "./schema.js";

function scenario(network: NetworkSpec, actions: ScenarioSpec["actions"] = []): ScenarioSpec {
  return { version: 1, network, actions };
}

const host = (id: string, link: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: "host" as const,
  interfaces: [{ name: "eth0", link }],
  ...extra,
});

const router = (id: string, ...links: string[]) => ({
  id,
  kind: "router" as const,
  interfaces: links.map((link, i) => ({ name: `eth${i}`, link })),
});

const cable = (id: string, a: string, b: string) => ({ id, a, b });

describe("resolveScenario", () => {
  it("fills the minimal lesson 2 spec out to the documented resolved form", () => {
    expect(resolveScenario(clone(lesson2Minimal))).toEqual(lesson2Resolved);
  });

  it("is deterministic", () => {
    const a = resolveScenario(clone(lesson2Minimal));
    const b = resolveScenario(clone(lesson2Minimal));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("returns a fully specified scenario unchanged", () => {
    expect(resolveScenario(clone(lesson2Resolved))).toEqual(lesson2Resolved);
  });

  it("puts two hosts on one cable in one /24 with no default route", () => {
    const out = resolveScenario(
      scenario({
        nodes: [host("a", "l1"), host("b", "l1")],
        links: [cable("l1", "a/eth0", "b/eth0")],
      }),
    );
    expect(l3(out, "a").interfaces[0]).toEqual({
      name: "eth0",
      mac: "02:00:00:00:00:01",
      ip: "10.0.1.10/24",
      link: "l1",
    });
    expect(l3(out, "b").interfaces[0]).toMatchObject({
      mac: "02:00:00:00:00:02",
      ip: "10.0.1.11/24",
    });
    expect(l3(out, "a").routes).toEqual([{ dst: "10.0.1.0/24", dev: "eth0", metric: 0 }]);
    expect(out.network.links[0]?.latency_us).toBe(1000);
  });

  it("keeps hosts joined by a switch in one /24", () => {
    const out = resolveScenario(
      scenario({
        nodes: [
          host("a", "l1"),
          host("b", "l2"),
          {
            id: "sw",
            kind: "switch",
            interfaces: [
              { name: "p1", link: "l1" },
              { name: "p2", link: "l2" },
            ],
          },
        ],
        links: [cable("l1", "a/eth0", "sw/p1"), cable("l2", "b/eth0", "sw/p2")],
      }),
    );
    expect(l3(out, "a").interfaces[0]?.ip).toBe("10.0.1.10/24");
    expect(l3(out, "b").interfaces[0]?.ip).toBe("10.0.1.11/24");
  });

  it("puts hosts either side of a router in two /24s with default routes to it", () => {
    const out = resolveScenario(
      scenario({
        nodes: [host("a", "l1"), router("r", "l1", "l2"), host("b", "l2")],
        links: [cable("l1", "a/eth0", "r/eth0"), cable("l2", "r/eth1", "b/eth0")],
      }),
    );
    expect(l3(out, "a").interfaces[0]?.ip).toBe("10.0.1.10/24");
    expect(l3(out, "r").interfaces.map((i) => i.ip)).toEqual(["10.0.1.1/24", "10.0.2.1/24"]);
    expect(l3(out, "b").interfaces[0]?.ip).toBe("10.0.2.10/24");
    expect(l3(out, "a").routes).toContainEqual({
      dst: "0.0.0.0/0",
      via: "10.0.1.1",
      dev: "eth0",
      metric: 0,
    });
    expect(l3(out, "b").routes).toContainEqual({
      dst: "0.0.0.0/0",
      via: "10.0.2.1",
      dev: "eth0",
      metric: 0,
    });
  });

  it("gives routers static routes to every distant subnet by shortest path", () => {
    const out = resolveScenario(
      scenario({
        nodes: [
          host("h1", "l1"),
          router("r1", "l1", "l2"),
          router("r2", "l2", "l3"),
          router("r3", "l3", "l4"),
          host("h2", "l4"),
        ],
        links: [
          cable("l1", "h1/eth0", "r1/eth0"),
          cable("l2", "r1/eth1", "r2/eth0"),
          cable("l3", "r2/eth1", "r3/eth0"),
          cable("l4", "r3/eth1", "h2/eth0"),
        ],
      }),
    );
    expect(l3(out, "r1").routes).toEqual([
      { dst: "10.0.1.0/24", dev: "eth0", metric: 0 },
      { dst: "10.0.2.0/24", dev: "eth1", metric: 0 },
      { dst: "10.0.3.0/24", via: "10.0.2.2", dev: "eth1", metric: 0 },
      { dst: "10.0.4.0/24", via: "10.0.2.2", dev: "eth1", metric: 0 },
    ]);
    expect(l3(out, "r2").routes).toEqual([
      { dst: "10.0.2.0/24", dev: "eth0", metric: 0 },
      { dst: "10.0.3.0/24", dev: "eth1", metric: 0 },
      { dst: "10.0.1.0/24", via: "10.0.2.1", dev: "eth0", metric: 0 },
      { dst: "10.0.4.0/24", via: "10.0.3.2", dev: "eth1", metric: 0 },
    ]);
    expect(l3(out, "h2").routes).toContainEqual({
      dst: "0.0.0.0/0",
      via: "10.0.4.1",
      dev: "eth0",
      metric: 0,
    });
  });

  it("respects explicit addresses and allocates the rest around them", () => {
    const out = resolveScenario(
      scenario({
        nodes: [
          {
            id: "a",
            kind: "host",
            interfaces: [
              { name: "eth0", mac: "02:00:00:00:00:01", ip: "192.168.7.5/24", link: "l1" },
            ],
          },
          host("b", "l1"),
        ],
        links: [cable("l1", "a/eth0", "b/eth0")],
      }),
    );
    expect(l3(out, "b").interfaces[0]).toMatchObject({
      mac: "02:00:00:00:00:02",
      ip: "192.168.7.10/24",
    });
    expect(l3(out, "a").routes).toEqual([{ dst: "192.168.7.0/24", dev: "eth0", metric: 0 }]);
  });

  it("normalizes explicit routes: dev from via, metric, and implicit connected routes", () => {
    const out = resolveScenario(
      scenario({
        nodes: [
          host("a", "l1", {
            routes: [
              { dst: "0.0.0.0/0", via: "10.0.1.1" },
              { dst: "10.0.9.0/24", via: "192.168.5.1" },
              { dst: "192.168.5.0/24", via: "10.0.1.1", metric: 5 },
            ],
          }),
          router("r", "l1"),
        ],
        links: [cable("l1", "a/eth0", "r/eth0")],
      }),
    );
    expect(l3(out, "a").routes).toEqual([
      { dst: "10.0.1.0/24", dev: "eth0", metric: 0 },
      { dst: "0.0.0.0/0", via: "10.0.1.1", dev: "eth0", metric: 0 },
      { dst: "10.0.9.0/24", via: "192.168.5.1", dev: "eth0", metric: 0 },
      { dst: "192.168.5.0/24", via: "10.0.1.1", dev: "eth0", metric: 5 },
    ]);
  });

  it("does not add default routes when routes are given explicitly", () => {
    const out = resolveScenario(
      scenario({
        nodes: [host("a", "l1", { routes: [] }), router("r", "l1")],
        links: [cable("l1", "a/eth0", "r/eth0")],
      }),
    );
    expect(l3(out, "a").routes).toEqual([{ dst: "10.0.1.0/24", dev: "eth0", metric: 0 }]);
  });

  it("drops a duplicated static route", () => {
    const out = resolveScenario(
      scenario({
        nodes: [
          host("a", "l1", {
            routes: [
              { dst: "0.0.0.0/0", via: "10.0.1.1" },
              { dst: "0.0.0.0/0", via: "10.0.1.1" },
            ],
          }),
          router("r", "l1"),
        ],
        links: [cable("l1", "a/eth0", "r/eth0")],
      }),
    );
    expect(l3(out, "a").routes).toHaveLength(2);
  });

  it("fills a neighbor's dev from the connected subnet that covers it", () => {
    const out = resolveScenario(
      scenario({
        nodes: [
          host("a", "l1", { neighbors: [{ ip: "10.0.1.11", mac: "02:00:00:00:00:02" }] }),
          host("b", "l1"),
        ],
        links: [cable("l1", "a/eth0", "b/eth0")],
      }),
    );
    expect(l3(out, "a").neighbors).toEqual([
      { ip: "10.0.1.11", mac: "02:00:00:00:00:02", dev: "eth0" },
    ]);
  });

  it("resolves endpoint names to the node's first address and applies action defaults", () => {
    const out = resolveScenario(
      scenario(
        { nodes: [host("a", "l1"), host("b", "l1")], links: [cable("l1", "a/eth0", "b/eth0")] },
        [
          { action: "ping", from: { name: "a" }, to: { name: "b" } },
          { action: "traceroute", from: { ip: "10.0.1.10" }, to: { name: "b" } },
        ],
      ),
    );
    expect(out.actions).toEqual([
      {
        action: "ping",
        from: { name: "a", ip: "10.0.1.10" },
        to: { name: "b", ip: "10.0.1.11" },
        ttl: 64,
        count: 1,
      },
      {
        action: "traceroute",
        from: { ip: "10.0.1.10" },
        to: { name: "b", ip: "10.0.1.11" },
        max_ttl: 30,
      },
    ]);
  });
});
