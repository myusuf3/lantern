import type { Scenario, ScenarioSpec } from "../schema.js";

/** The fully resolved lesson 2 scenario from the design doc, Appendix A. */
export const lesson2Resolved: Scenario = {
  version: 1,
  network: {
    nodes: [
      {
        id: "laptop",
        kind: "host",
        interfaces: [{ name: "eth0", mac: "02:00:00:00:00:01", ip: "10.0.1.10/24", link: "l1" }],
        routes: [
          { dst: "10.0.1.0/24", dev: "eth0", metric: 0 },
          { dst: "0.0.0.0/0", via: "10.0.1.1", dev: "eth0", metric: 0 },
        ],
        neighbors: [],
      },
      {
        id: "sw1",
        kind: "switch",
        interfaces: [
          { name: "p1", link: "l1" },
          { name: "p2", link: "l2" },
        ],
      },
      {
        id: "r1",
        kind: "router",
        interfaces: [
          { name: "eth0", mac: "02:00:00:00:00:02", ip: "10.0.1.1/24", link: "l2" },
          { name: "eth1", mac: "02:00:00:00:00:03", ip: "10.0.2.1/24", link: "l3" },
        ],
        routes: [
          { dst: "10.0.1.0/24", dev: "eth0", metric: 0 },
          { dst: "10.0.2.0/24", dev: "eth1", metric: 0 },
        ],
        neighbors: [],
      },
      {
        id: "server",
        kind: "host",
        interfaces: [{ name: "eth0", mac: "02:00:00:00:00:04", ip: "10.0.2.10/24", link: "l3" }],
        routes: [
          { dst: "10.0.2.0/24", dev: "eth0", metric: 0 },
          { dst: "0.0.0.0/0", via: "10.0.2.1", dev: "eth0", metric: 0 },
        ],
        neighbors: [{ ip: "10.0.2.1", mac: "02:00:00:00:00:03", dev: "eth0" }],
      },
    ],
    links: [
      { id: "l1", a: "laptop/eth0", b: "sw1/p1", latency_us: 1000 },
      { id: "l2", a: "sw1/p2", b: "r1/eth0", latency_us: 1000 },
      { id: "l3", a: "r1/eth1", b: "server/eth0", latency_us: 1000 },
    ],
  },
  actions: [
    {
      action: "ping",
      from: { name: "laptop", ip: "10.0.1.10" },
      to: { name: "server", ip: "10.0.2.10" },
      ttl: 64,
      count: 2,
    },
    {
      action: "traceroute",
      from: { name: "laptop", ip: "10.0.1.10" },
      to: { name: "server", ip: "10.0.2.10" },
      max_ttl: 8,
    },
  ],
};

/** The same scenario with everything the resolver can fill in left out. Resolves to the above. */
export const lesson2Minimal: ScenarioSpec = {
  version: 1,
  network: {
    nodes: [
      { id: "laptop", kind: "host", interfaces: [{ name: "eth0", link: "l1" }] },
      {
        id: "sw1",
        kind: "switch",
        interfaces: [
          { name: "p1", link: "l1" },
          { name: "p2", link: "l2" },
        ],
      },
      {
        id: "r1",
        kind: "router",
        interfaces: [
          { name: "eth0", link: "l2" },
          { name: "eth1", link: "l3" },
        ],
      },
      {
        id: "server",
        kind: "host",
        interfaces: [{ name: "eth0", link: "l3" }],
        neighbors: [{ ip: "10.0.2.1", mac: "02:00:00:00:00:03" }],
      },
    ],
    links: [
      { id: "l1", a: "laptop/eth0", b: "sw1/p1" },
      { id: "l2", a: "sw1/p2", b: "r1/eth0" },
      { id: "l3", a: "r1/eth1", b: "server/eth0" },
    ],
  },
  actions: [
    { action: "ping", from: { name: "laptop" }, to: { name: "server" }, count: 2 },
    { action: "traceroute", from: { name: "laptop" }, to: { name: "server" }, max_ttl: 8 },
  ],
};
