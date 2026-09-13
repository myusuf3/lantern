import { loadScenario } from "@lantern/engine";
import { render, screen, waitFor } from "@testing-library/react";
import { Profiler } from "react";
import { describe, expect, it } from "vitest";
import { Scene } from "./Scene.js";

/** Lesson 3, two ways home: a chain plus a direct r1 - r3 cable that r1 prefers by metric. */
const twoWaysHome = loadScenario({
  version: 1,
  network: {
    warm_arp: true,
    nodes: [
      { id: "laptop", kind: "host", interfaces: [{ name: "eth0", link: "l1" }] },
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
      {
        id: "r2",
        kind: "router",
        interfaces: [
          { name: "eth0", link: "l2" },
          { name: "eth1", link: "l3" },
        ],
      },
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
      { id: "server", kind: "host", interfaces: [{ name: "eth0", link: "l4" }] },
    ],
    links: [
      { id: "l1", a: "laptop/eth0", b: "r1/eth0" },
      { id: "l2", a: "r1/eth1", b: "r2/eth0" },
      { id: "l3", a: "r2/eth1", b: "r3/eth0" },
      { id: "l4", a: "r3/eth1", b: "server/eth0" },
      { id: "l5", a: "r1/eth2", b: "r3/eth2" },
    ],
  },
  actions: [{ action: "ping", from: { name: "laptop" }, to: { name: "server" } }],
}).network;

const cable = loadScenario({
  version: 1,
  network: {
    nodes: [
      { id: "laptop", kind: "host", interfaces: [{ name: "eth0", link: "cable" }] },
      { id: "server", kind: "host", interfaces: [{ name: "eth0", link: "cable" }] },
    ],
    links: [{ id: "cable", a: "laptop/eth0", b: "server/eth0" }],
  },
  actions: [{ action: "ping", from: { name: "laptop" }, to: { name: "server" } }],
}).network;

function renderScene(network: typeof cable) {
  render(
    <Scene
      network={network}
      show={{ arp: false, routes: true }}
      arpTables={{}}
      macTables={{}}
      activeNodes={[]}
      activeRoute={undefined}
      inFlight={[]}
    />,
  );
}

function placement(id: string): { x: number; y: number } {
  const wrapper = screen.getByTestId(`node-${id}`).closest(".react-flow__node");
  const m = (wrapper as HTMLElement).style.transform.match(/translate\(([\d.]+)px,\s*([\d.]+)px\)/);
  if (!m) throw new Error(`node ${id} has no position yet`);
  return { x: Number(m[1]), y: Number(m[2]) };
}

describe("Scene layout", () => {
  it("hangs an off-path box below the box above it, clear of its measured height", async () => {
    renderScene(twoWaysHome);
    const r3Rows = screen.getByTestId("node-r3").querySelectorAll("tr").length;
    const r2Rows = screen.getByTestId("node-r2").querySelectorAll("tr").length;
    expect(r3Rows).toBeGreaterThan(r2Rows);
    await waitFor(() => {
      const r3 = placement("r3");
      const r2 = placement("r2");
      expect(r2.x).toBe(r3.x);
      // The test shim reports a box's height as 100 plus 20 per table row.
      expect(r2.y).toBe(r3.y + (100 + 20 * r3Rows) + 90);
    });
  });

  it("writes a route's metric on the cable the deciding router would send it down", async () => {
    renderScene(twoWaysHome);
    expect(await screen.findByText("metric 20")).toBeInTheDocument();
    expect(screen.getByText("metric 10")).toBeInTheDocument();
    expect(screen.getAllByText(/^metric /)).toHaveLength(2);
  });

  it("leaves cables unlabelled when every route is plain", async () => {
    renderScene(cable);
    await screen.findByTestId("node-laptop");
    expect(screen.queryByText(/^metric /)).toBeNull();
  });

  it("settles after stacking instead of re-rendering forever", async () => {
    let renders = 0;
    render(
      <Profiler id="scene" onRender={() => renders++}>
        <Scene
          network={twoWaysHome}
          show={{ arp: false, routes: true }}
          arpTables={{}}
          macTables={{}}
          activeNodes={[]}
          activeRoute={undefined}
          inFlight={[]}
        />
      </Profiler>,
    );
    await waitFor(() => expect(placement("r2").y).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 200));
    const settled = renders;
    await new Promise((r) => setTimeout(r, 300));
    expect(renders).toBe(settled);
  });
});
