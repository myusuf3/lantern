import { describe, expect, it } from "vitest";
import { loose, withAction, withNode } from "./fixtures/helpers.js";
import { lesson2Minimal, lesson2Resolved } from "./fixtures/lesson2.js";
import { scenarioSchema, scenarioSpecSchema } from "./schema.js";

describe("scenarioSpecSchema", () => {
  it("accepts a fully specified scenario and returns it unchanged", () => {
    expect(scenarioSpecSchema.parse(loose(lesson2Resolved))).toEqual(lesson2Resolved);
  });

  it("accepts a minimal scenario with addresses and routes omitted", () => {
    expect(scenarioSpecSchema.parse(loose(lesson2Minimal))).toEqual(lesson2Minimal);
  });

  it("normalizes a default route destination and lower-cases MACs", () => {
    const parsed = scenarioSpecSchema.parse(
      withNode(0, {
        routes: [{ dst: "default", via: "10.0.1.1" }],
        neighbors: [{ ip: "10.0.1.1", mac: "02:00:00:00:00:0A" }],
      }),
    );
    const laptop = parsed.network.nodes[0];
    expect(laptop?.kind === "host" && laptop.routes?.[0]?.dst).toBe("0.0.0.0/0");
    expect(laptop?.kind === "host" && laptop.neighbors?.[0]?.mac).toBe("02:00:00:00:00:0a");
  });

  it("rejects an unknown schema version", () => {
    expect(() => scenarioSpecSchema.parse({ ...loose(lesson2Minimal), version: 2 })).toThrow(
      /version/,
    );
  });

  it("rejects an unknown node kind", () => {
    expect(() => scenarioSpecSchema.parse(withNode(0, { kind: "hub" }))).toThrow(/kind/);
  });

  it("rejects a switch that carries ip, mac, routes, or neighbors", () => {
    for (const extra of [
      { interfaces: [{ name: "p1", link: "l1", ip: "10.0.1.2/24" }] },
      { interfaces: [{ name: "p1", link: "l1", mac: "02:00:00:00:00:09" }] },
      { routes: [] },
      { neighbors: [] },
    ]) {
      expect(() => scenarioSpecSchema.parse(withNode(1, extra)), JSON.stringify(extra)).toThrow(
        /switch/,
      );
    }
  });

  it("rejects a route with neither via nor dev", () => {
    expect(() => scenarioSpecSchema.parse(withNode(0, { routes: [{ dst: "default" }] }))).toThrow(
      /via|dev/,
    );
  });

  it("rejects malformed addresses", () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ interfaces: [{ name: "eth0", link: "l1", ip: "10.0.1.10" }] }, /prefix/],
      [{ interfaces: [{ name: "eth0", link: "l1", ip: "010.0.1.10/24" }] }, /prefix/],
      [{ interfaces: [{ name: "eth0", link: "l1", mac: "02-00-00-00-00-01" }] }, /mac/i],
      [{ neighbors: [{ ip: "10.0.1.300", mac: "02:00:00:00:00:01" }] }, /ip/i],
      [{ routes: [{ dst: "10.0.1.0/33", dev: "eth0" }] }, /dst/],
    ];
    for (const [extra, pattern] of cases) {
      expect(() => scenarioSpecSchema.parse(withNode(0, extra)), JSON.stringify(extra)).toThrow(
        pattern,
      );
    }
  });

  it("rejects an endpoint with neither ip nor name", () => {
    expect(() => scenarioSpecSchema.parse(withAction(0, { from: {} }))).toThrow(/ip|name/);
  });

  it("rejects a ttl outside 1..255", () => {
    expect(() => scenarioSpecSchema.parse(withAction(0, { ttl: 0 }))).toThrow(/ttl/);
  });
});

describe("scenarioSchema (resolved form)", () => {
  it("accepts the resolved fixture", () => {
    expect(scenarioSchema.parse(loose(lesson2Resolved))).toEqual(lesson2Resolved);
  });

  it("requires mac and ip on host interfaces and dev on every route", () => {
    const missingMac = loose(lesson2Resolved);
    missingMac.network.nodes[0] = {
      ...missingMac.network.nodes[0],
      interfaces: [{ name: "eth0", ip: "10.0.1.10/24", link: "l1" }],
    };
    expect(() => scenarioSchema.parse(missingMac)).toThrow(/mac/);

    const missingDev = loose(lesson2Resolved);
    missingDev.network.nodes[0] = {
      ...missingDev.network.nodes[0],
      routes: [{ dst: "0.0.0.0/0", via: "10.0.1.1", metric: 0 }],
    };
    expect(() => scenarioSchema.parse(missingDev)).toThrow(/dev/);
  });

  it("requires ip on every endpoint", () => {
    const input = loose(lesson2Resolved);
    input.actions[0] = { ...input.actions[0], to: { name: "server" } };
    expect(() => scenarioSchema.parse(input)).toThrow(/ip/);
  });
});
