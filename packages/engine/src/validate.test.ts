import { describe, expect, it } from "vitest";
import { ScenarioError } from "./errors.js";
import { l3, loose, withAction, withLink, withNode } from "./fixtures/helpers.js";
import { lesson2Minimal, lesson2Resolved } from "./fixtures/lesson2.js";
import { loadScenario } from "./load.js";

function issuesOf(input: unknown): { code: string; path: string }[] {
  try {
    loadScenario(input);
  } catch (e) {
    if (e instanceof ScenarioError) return e.issues.map(({ code, path }) => ({ code, path }));
    throw e;
  }
  throw new Error("expected loadScenario to throw");
}

describe("loadScenario", () => {
  it("parses, resolves, and returns a valid scenario", () => {
    expect(loadScenario(loose(lesson2Resolved))).toEqual(lesson2Resolved);
    expect(loadScenario(loose(lesson2Minimal))).toEqual(lesson2Resolved);
  });

  it("reports schema problems with a path", () => {
    expect(issuesOf(withAction(0, { ttl: 999 }))).toEqual([
      { code: "schema", path: "actions/0/ttl" },
    ]);
  });

  it("rejects duplicate node ids", () => {
    expect(issuesOf(withNode(3, { id: "laptop" }))).toContainEqual({
      code: "duplicate-node-id",
      path: "network/nodes/3",
    });
  });

  it("rejects duplicate link ids", () => {
    expect(issuesOf(withLink(2, { id: "l1" }))).toContainEqual({
      code: "duplicate-link-id",
      path: "network/links/2",
    });
  });

  it("rejects duplicate interface names within a node", () => {
    const input = withNode(2, {
      interfaces: [
        { name: "eth0", link: "l2" },
        { name: "eth0", link: "l3" },
      ],
    });
    expect(issuesOf(input)).toContainEqual({
      code: "duplicate-interface-name",
      path: "network/nodes/2/interfaces/1",
    });
  });

  it("rejects an interface on an unknown link", () => {
    const input = withNode(0, { interfaces: [{ name: "eth0", link: "l9" }] });
    expect(issuesOf(input)).toContainEqual({
      code: "unknown-link",
      path: "network/nodes/0/interfaces/0",
    });
  });

  it("rejects a link endpoint that names a missing interface", () => {
    expect(issuesOf(withLink(0, { a: "laptop/eth9" }))).toContainEqual({
      code: "unknown-interface",
      path: "network/links/0/a",
    });
  });

  it("rejects an interface whose link does not list it as an endpoint", () => {
    // server says it is on l1, but l1 joins laptop and sw1.
    const input = withNode(3, { interfaces: [{ name: "eth0", link: "l1" }] });
    expect(issuesOf(input)).toContainEqual({
      code: "link-endpoint-mismatch",
      path: "network/nodes/3/interfaces/0",
    });
  });

  it("rejects a route whose dev is not an interface of the node", () => {
    const input = withNode(0, { routes: [{ dst: "default", dev: "wlan0" }] });
    expect(issuesOf(input)).toContainEqual({
      code: "route-dev-unknown",
      path: "network/nodes/0/routes/0",
    });
  });

  it("rejects a gateway that does not resolve to a connected subnet, even with dev given", () => {
    const bare = withNode(0, { routes: [{ dst: "default", via: "192.168.5.1" }] });
    expect(issuesOf(bare)).toContainEqual({
      code: "gateway-unresolvable",
      path: "network/nodes/0/routes/0",
    });

    const withDev = withNode(0, { routes: [{ dst: "default", via: "192.168.5.1", dev: "eth0" }] });
    expect(issuesOf(withDev)).toContainEqual({
      code: "gateway-unresolvable",
      path: "network/nodes/0/routes/0",
    });
  });

  it("accepts a gateway that resolves recursively", () => {
    const input = withNode(0, {
      routes: [
        { dst: "default", via: "192.168.5.1" },
        { dst: "192.168.5.0/24", via: "10.0.1.1" },
      ],
    });
    expect(l3(loadScenario(input), "laptop").routes).toContainEqual({
      dst: "0.0.0.0/0",
      via: "192.168.5.1",
      dev: "eth0",
      metric: 0,
    });
  });

  it("rejects a neighbor outside every connected subnet", () => {
    const input = withNode(0, { neighbors: [{ ip: "10.0.2.1", mac: "02:00:00:00:00:03" }] });
    expect(issuesOf(input)).toContainEqual({
      code: "neighbor-not-connected",
      path: "network/nodes/0/neighbors/0",
    });
  });

  it("rejects duplicate MACs and duplicate IPs across the network", () => {
    const input = withNode(0, {
      interfaces: [{ name: "eth0", link: "l1", mac: "02:00:00:00:00:aa", ip: "10.0.1.10/24" }],
    });
    input.network.nodes[3] = {
      ...input.network.nodes[3],
      interfaces: [{ name: "eth0", link: "l3", mac: "02:00:00:00:00:aa", ip: "10.0.1.10/24" }],
      neighbors: [],
    };
    const issues = issuesOf(input);
    expect(issues).toContainEqual({ code: "duplicate-mac", path: "network/nodes/3/interfaces/0" });
    expect(issues).toContainEqual({ code: "duplicate-ip", path: "network/nodes/3/interfaces/0" });
  });

  it("rejects an action whose source or destination no node owns", () => {
    const issues = issuesOf(withAction(0, { from: { ip: "10.0.1.99" }, to: { ip: "10.0.2.99" } }));
    expect(issues).toContainEqual({ code: "endpoint-ip-unknown", path: "actions/0/from" });
    expect(issues).toContainEqual({ code: "endpoint-ip-unknown", path: "actions/0/to" });
  });

  it("rejects an action endpoint naming an unknown node or a switch", () => {
    const issues = issuesOf(withAction(0, { from: { name: "nope" }, to: { name: "sw1" } }));
    expect(issues).toContainEqual({ code: "unknown-node", path: "actions/0/from" });
    expect(issues).toContainEqual({ code: "endpoint-not-l3", path: "actions/0/to" });
  });

  it("collects several structural problems in one error", () => {
    const input = withNode(3, { id: "laptop" });
    input.network.links[2] = { ...input.network.links[2], id: "l1" };
    expect(
      issuesOf(input)
        .map((i) => i.code)
        .sort(),
    ).toEqual(["duplicate-link-id", "duplicate-node-id"]);
  });
});
