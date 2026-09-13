import { z } from "zod";

const id = z.string().regex(/^[a-z0-9_-]+$/, { error: "id must be [a-z0-9_-]+" });
const ifaceName = z.string().min(1);
const ip = z.ipv4();
const cidr = z.cidrv4({ error: "expected address with prefix length, like 10.0.1.10/24" });
const mac = z.mac().toLowerCase();
const endpointRef = z
  .string()
  .regex(/^[a-z0-9_-]+\/[^/\s]+$/, { error: "expected node/interface" });
const ttl = z.int().min(1).max(255);
const metric = z.int().min(0);

const DEFAULT_ROUTE = "0.0.0.0/0";
const routeDst = z.union([z.literal("default").transform(() => DEFAULT_ROUTE), cidr]);
const routeSpec = z
  .object({
    dst: routeDst,
    via: ip.optional(),
    dev: ifaceName.optional(),
    metric: metric.optional(),
  })
  .refine((r) => r.via !== undefined || r.dev !== undefined, { error: "route needs via or dev" });
const route = z.object({ dst: cidr, via: ip.optional(), dev: ifaceName, metric });

const neighborSpec = z.object({ ip, mac, dev: ifaceName.optional() });
const neighbor = neighborSpec.required();

const ifaceSpec = z.object({ name: ifaceName, mac: mac.optional(), ip: cidr.optional(), link: id });
const iface = ifaceSpec.required();

const switchPort = z.strictObject(
  { name: ifaceName, link: id },
  { error: "switch ports carry only name and link" },
);
const switchNode = z.strictObject(
  { id, kind: z.literal("switch"), interfaces: z.array(switchPort).min(1) },
  { error: "switch has no ip layer: no routes or neighbors" },
);

const l3Kind = z.enum(["host", "router"]);
const l3NodeSpec = z.object({
  id,
  kind: l3Kind,
  interfaces: z.array(ifaceSpec).min(1),
  routes: z.array(routeSpec).optional(),
  neighbors: z.array(neighborSpec).optional(),
});
const l3Node = z.object({
  id,
  kind: l3Kind,
  interfaces: z.array(iface).min(1),
  routes: z.array(route),
  neighbors: z.array(neighbor),
});

const linkSpec = z.object({
  id,
  a: endpointRef,
  b: endpointRef,
  latency_us: z.int().min(0).optional(),
});
const link = linkSpec.required();

const endpointBase = z.object({ ip: ip.optional(), name: id.optional() });
const endpointSpec = endpointBase.refine((e) => e.ip !== undefined || e.name !== undefined, {
  error: "endpoint needs ip or name",
});
const endpoint = endpointBase.required({ ip: true });

const actionSpec = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("ping"),
    from: endpointSpec,
    to: endpointSpec,
    ttl: ttl.optional(),
    count: z.int().min(1).optional(),
  }),
  z.object({
    action: z.literal("traceroute"),
    from: endpointSpec,
    to: endpointSpec,
    max_ttl: ttl.optional(),
  }),
]);
const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ping"), from: endpoint, to: endpoint, ttl, count: z.int().min(1) }),
  z.object({ action: z.literal("traceroute"), from: endpoint, to: endpoint, max_ttl: ttl }),
]);

const version = z.literal(1, { error: "unsupported schema version" });

/** What a lesson author writes: anything the resolver can fill in may be omitted. */
export const scenarioSpecSchema = z.object({
  version,
  network: z.object({
    nodes: z.array(z.union([l3NodeSpec, switchNode])).min(1),
    links: z.array(linkSpec),
  }),
  actions: z.array(actionSpec),
});

/** What the engine runs and the API returns: the same shape with nothing omitted. */
export const scenarioSchema = z.object({
  version,
  network: z.object({ nodes: z.array(z.union([l3Node, switchNode])).min(1), links: z.array(link) }),
  actions: z.array(action),
});

export type RouteSpec = z.infer<typeof routeSpec>;
export type Route = z.infer<typeof route>;
export type NeighborSpec = z.infer<typeof neighborSpec>;
export type Neighbor = z.infer<typeof neighbor>;
export type InterfaceSpec = z.infer<typeof ifaceSpec>;
export type Interface = z.infer<typeof iface>;
export type SwitchNode = z.infer<typeof switchNode>;
export type L3NodeSpec = z.infer<typeof l3NodeSpec>;
export type L3Node = z.infer<typeof l3Node>;
export type NodeSpec = L3NodeSpec | SwitchNode;
export type Node = L3Node | SwitchNode;
export type LinkSpec = z.infer<typeof linkSpec>;
export type Link = z.infer<typeof link>;
export type EndpointSpec = z.infer<typeof endpointSpec>;
export type Endpoint = z.infer<typeof endpoint>;
export type ActionSpec = z.infer<typeof actionSpec>;
export type Action = z.infer<typeof action>;
export type NetworkSpec = ScenarioSpec["network"];
export type Network = Scenario["network"];
export type ScenarioSpec = z.infer<typeof scenarioSpecSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;

export function isL3<N extends NodeSpec | Node>(node: N): node is Exclude<N, SwitchNode> {
  return node.kind !== "switch";
}
