import {
  type Cidr,
  cidrContains,
  formatCidr,
  formatMac,
  formatNetwork,
  parseCidr,
  parseIp,
  stripPrefix,
} from "./addr.js";
import { type ConfigIssue, ScenarioError } from "./errors.js";
import type {
  Action,
  ActionSpec,
  Endpoint,
  EndpointSpec,
  Interface,
  InterfaceSpec,
  L3NodeSpec,
  Network,
  NetworkSpec,
  Route,
  RouteSpec,
  Scenario,
  ScenarioSpec,
} from "./schema.js";
import { isL3 } from "./schema.js";

export const DEFAULT_LATENCY_US = 1000;
export const DEFAULT_TTL = 64;
export const DEFAULT_PING_COUNT = 1;
export const DEFAULT_MAX_TTL = 30;
const ROUTER_FIRST_HOST = 1;
const HOST_FIRST_HOST = 10;
/** Locally administered, unicast: 02:00:00:00:00:00. Generated MACs count up from here. */
const MAC_BASE = 0x020000000000;

/**
 * Fill in everything a partial scenario leaves out, deterministically. Expects a spec that
 * passed validateSpec, so every id and reference is consistent. Throws ScenarioError when a
 * gateway or neighbor cannot be placed on a connected subnet.
 */
export function resolveScenario(spec: ScenarioSpec): Scenario {
  const issues: ConfigIssue[] = [];
  const network = resolveNetwork(spec.network, issues);
  ScenarioError.throwIfAny(issues);
  return { version: 1, network, actions: spec.actions.map((a) => resolveAction(a, network)) };
}

/** A broadcast domain: the links a switch joins together, and the L3 interfaces on them. */
interface Domain {
  index: number;
  subnet: Cidr;
  members: { node: L3NodeSpec; iface: Interface }[];
}

type DomainOf = (link: string) => Domain | undefined;

function resolveNetwork(spec: NetworkSpec, issues: ConfigIssue[]): Network {
  const links = spec.links.map((l) => ({ ...l, latency_us: l.latency_us ?? DEFAULT_LATENCY_US }));
  const l3 = spec.nodes.filter(isL3);
  const domainOfLink = groupLinksIntoDomains(spec);
  const ifaces = resolveAddresses(l3, domainOfLink);
  const domainOf = buildDomains(l3, ifaces, domainOfLink);

  const nodes = spec.nodes.map((n, ni) => {
    if (!isL3(n)) return n;
    const own = ifaces.get(n.id) ?? [];
    return {
      id: n.id,
      kind: n.kind,
      interfaces: own,
      routes: resolveRoutes(n, ni, own, domainOf, issues),
      neighbors: resolveNeighbors(n, ni, own, issues),
    };
  });
  return { nodes, links };
}

/** Union-find over links: a switch joins every link on its ports. Domains number in link order. */
function groupLinksIntoDomains(spec: NetworkSpec): Map<string, number> {
  const parent = new Map(spec.links.map((l) => [l.id, l.id]));
  const find = (id: string): string => {
    const p = parent.get(id) ?? id;
    if (p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  };
  for (const n of spec.nodes) {
    if (isL3(n)) continue;
    const [first, ...rest] = n.interfaces;
    for (const port of rest) if (first) parent.set(find(port.link), find(first.link));
  }

  const domainOfRoot = new Map<string, number>();
  const out = new Map<string, number>();
  for (const l of spec.links) {
    const root = find(l.id);
    if (!domainOfRoot.has(root)) domainOfRoot.set(root, domainOfRoot.size);
    out.set(l.id, domainOfRoot.get(root) ?? 0);
  }
  return out;
}

/** Every L3 interface with its MAC and IP, explicit or generated, in declaration order. */
function resolveAddresses(
  l3: L3NodeSpec[],
  domainOfLink: Map<string, number>,
): Map<string, Interface[]> {
  const nextMac = macAllocator(l3);
  const nextIp = ipAllocator(l3, domainOfLink);
  return new Map(
    l3.map((n) => [
      n.id,
      n.interfaces.map((i) => ({
        name: i.name,
        mac: i.mac ?? nextMac(),
        ip: i.ip ?? nextIp(n, i),
        link: i.link,
      })),
    ]),
  );
}

function macAllocator(l3: L3NodeSpec[]): () => string {
  const used = new Set(l3.flatMap((n) => n.interfaces.flatMap((i) => (i.mac ? [i.mac] : []))));
  let counter = 0;
  return () => {
    let mac: string;
    do {
      counter += 1;
      mac = formatMac(MAC_BASE + counter);
    } while (used.has(mac));
    used.add(mac);
    return mac;
  };
}

/**
 * One subnet per domain: the first explicit address on it decides, otherwise the next unused
 * 10.0.N.0/24. Routers count up from .1, hosts from .10, skipping taken addresses.
 */
function ipAllocator(
  l3: L3NodeSpec[],
  domainOfLink: Map<string, number>,
): (node: L3NodeSpec, iface: InterfaceSpec) => string {
  const explicit = new Map<number, Cidr>();
  const taken = new Map<number, Set<number>>();
  for (const n of l3) {
    for (const i of n.interfaces) {
      const d = domainOfLink.get(i.link) ?? -1;
      if (!i.ip) continue;
      const c = parseCidr(i.ip);
      if (!explicit.has(d)) explicit.set(d, c);
      taken.set(d, (taken.get(d) ?? new Set()).add(c.ip));
    }
  }
  const explicitSubnets = new Set([...explicit.values()].map(formatNetwork));

  const subnets = new Map<number, Cidr>(explicit);
  let thirdOctet = 0;
  const subnetOf = (d: number): Cidr => {
    let s = subnets.get(d);
    while (!s) {
      thirdOctet += 1;
      const candidate = parseCidr(`10.0.${thirdOctet}.0/24`);
      if (!explicitSubnets.has(formatNetwork(candidate))) s = candidate;
    }
    subnets.set(d, s);
    return s;
  };

  return (node, iface) => {
    const d = domainOfLink.get(iface.link) ?? -1;
    const subnet = subnetOf(d);
    const used = taken.get(d) ?? new Set<number>();
    taken.set(d, used);
    let host = node.kind === "router" ? ROUTER_FIRST_HOST : HOST_FIRST_HOST;
    while (used.has(subnet.network + host)) host += 1;
    used.add(subnet.network + host);
    return formatCidr(subnet.network + host, subnet.prefix);
  };
}

function buildDomains(
  l3: L3NodeSpec[],
  ifaces: Map<string, Interface[]>,
  domainOfLink: Map<string, number>,
): DomainOf {
  const domains = new Map<number, Domain>();
  for (const node of l3) {
    for (const iface of ifaces.get(node.id) ?? []) {
      const index = domainOfLink.get(iface.link) ?? -1;
      const domain = domains.get(index) ?? { index, subnet: parseCidr(iface.ip), members: [] };
      domain.members.push({ node, iface });
      domains.set(index, domain);
    }
  }
  return (link) => domains.get(domainOfLink.get(link) ?? -1);
}

/** The interface whose subnet covers an address: where a node would ARP for it. */
function connectedIface(ifaces: Interface[], ip: string): Interface | undefined {
  const target = parseIp(ip);
  return ifaces.find((i) => cidrContains(parseCidr(i.ip), target));
}

function resolveRoutes(
  node: L3NodeSpec,
  nodeIndex: number,
  ifaces: Interface[],
  domainOf: DomainOf,
  issues: ConfigIssue[],
): Route[] {
  const connected: Route[] = ifaces.map((i) => ({
    dst: formatNetwork(parseCidr(i.ip)),
    dev: i.name,
    metric: 0,
  }));
  if (node.routes === undefined) {
    const derived =
      node.kind === "router"
        ? routerStaticRoutes(node, ifaces, domainOf)
        : hostDefaultRoute(ifaces, domainOf);
    return [...connected, ...derived];
  }

  const given: Route[] = [];
  node.routes.forEach((r, ri) => {
    const dst = formatNetwork(parseCidr(r.dst));
    const metric = r.metric ?? 0;
    const viaDev =
      r.via === undefined
        ? undefined
        : resolveGatewayDev(r.via, ifaces, node.routes ?? [], new Set());
    if (r.via !== undefined && viaDev === undefined) {
      issues.push({
        code: "gateway-unresolvable",
        path: `network/nodes/${nodeIndex}/routes/${ri}`,
        message: `${node.id}: gateway ${r.via} does not resolve to a connected subnet`,
      });
      return;
    }
    // The schema guarantees dev when via is absent, so one of the two is always set.
    given.push({ dst, via: r.via, dev: r.dev ?? viaDev ?? "", metric });
  });

  return uniqueBy([...connected, ...given], (r) => `${r.dst} via ${r.via ?? "-"} dev ${r.dev}`);
}

/**
 * Recursive next-hop resolution, the way a router builds its FIB: a gateway is reachable
 * through a connected subnet, or through another route whose own gateway is.
 */
function resolveGatewayDev(
  via: string,
  ifaces: Interface[],
  routes: RouteSpec[],
  visiting: Set<string>,
): string | undefined {
  const direct = connectedIface(ifaces, via);
  if (direct) return direct.name;
  if (visiting.has(via)) return undefined;
  visiting.add(via);

  const target = parseIp(via);
  let best: { prefix: number; dev: string } | undefined;
  for (const r of routes) {
    if (r.via === undefined || r.via === via) continue;
    const dstCidr = parseCidr(r.dst);
    if (!cidrContains(dstCidr, target)) continue;
    const dev = r.dev ?? resolveGatewayDev(r.via, ifaces, routes, visiting);
    if (dev !== undefined && (best === undefined || dstCidr.prefix > best.prefix)) {
      best = { prefix: dstCidr.prefix, dev };
    }
  }
  return best?.dev;
}

function hostDefaultRoute(ifaces: Interface[], domainOf: DomainOf): Route[] {
  for (const iface of ifaces) {
    const gateway = domainOf(iface.link)?.members.find((m) => m.node.kind === "router");
    if (gateway)
      return [{ dst: "0.0.0.0/0", via: stripPrefix(gateway.iface.ip), dev: iface.name, metric: 0 }];
  }
  return [];
}

/** Breadth-first over domains, hopping through routers, to find a first hop for every distant subnet. */
function routerStaticRoutes(node: L3NodeSpec, ifaces: Interface[], domainOf: DomainOf): Route[] {
  const own = new Map<Domain, Interface>();
  for (const i of ifaces) {
    const d = domainOf(i.link);
    if (d && !own.has(d)) own.set(d, i);
  }

  const firstHop = new Map<Domain, { via: string; dev: string }>();
  const visited = new Set(own.keys());
  let frontier = [...own.keys()];
  while (frontier.length > 0) {
    const next: Domain[] = [];
    for (const d of frontier.sort((a, b) => a.index - b.index)) {
      for (const m of d.members) {
        if (m.node.kind !== "router" || m.node.id === node.id) continue;
        const ownIface = own.get(d);
        const hop = ownIface
          ? { via: stripPrefix(m.iface.ip), dev: ownIface.name }
          : firstHop.get(d);
        if (!hop) continue;
        for (const other of m.node.interfaces) {
          const d2 = domainOf(other.link);
          if (!d2 || visited.has(d2)) continue;
          visited.add(d2);
          firstHop.set(d2, hop);
          next.push(d2);
        }
      }
    }
    frontier = next;
  }

  return [...firstHop.entries()]
    .sort((a, b) => a[0].index - b[0].index)
    .map(([d, hop]) => ({ dst: formatNetwork(d.subnet), via: hop.via, dev: hop.dev, metric: 0 }));
}

function resolveNeighbors(
  node: L3NodeSpec,
  nodeIndex: number,
  ifaces: Interface[],
  issues: ConfigIssue[],
) {
  return (node.neighbors ?? []).flatMap((n, i) => {
    const dev = n.dev ?? connectedIface(ifaces, n.ip)?.name;
    if (dev !== undefined) return [{ ip: n.ip, mac: n.mac, dev }];
    issues.push({
      code: "neighbor-not-connected",
      path: `network/nodes/${nodeIndex}/neighbors/${i}`,
      message: `${node.id}: neighbor ${n.ip} is not on any connected subnet`,
    });
    return [];
  });
}

function resolveEndpoint(e: EndpointSpec, network: Network): Endpoint {
  if (e.ip !== undefined) return { ...e, ip: e.ip };
  const node = network.nodes.find((n) => n.id === e.name);
  const first = node && isL3(node) ? node.interfaces[0] : undefined;
  if (!first) throw new Error(`endpoint ${e.name} was not validated`);
  return { ...e, ip: stripPrefix(first.ip) };
}

function resolveAction(a: ActionSpec, network: Network): Action {
  const from = resolveEndpoint(a.from, network);
  const to = resolveEndpoint(a.to, network);
  if (a.action === "ping") {
    return {
      action: "ping",
      from,
      to,
      ttl: a.ttl ?? DEFAULT_TTL,
      count: a.count ?? DEFAULT_PING_COUNT,
    };
  }
  return { action: "traceroute", from, to, max_ttl: a.max_ttl ?? DEFAULT_MAX_TTL };
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
