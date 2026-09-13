import { parseCidr, parseIp } from "./addr.js";
import type { ConfigIssue } from "./errors.js";
import { isL3, type Scenario, type ScenarioSpec } from "./schema.js";

function duplicateIndexes<T>(items: T[], key: (item: T) => string): number[] {
  const seen = new Set<string>();
  const dupes: number[] = [];
  items.forEach((item, i) => {
    const k = key(item);
    if (seen.has(k)) dupes.push(i);
    seen.add(k);
  });
  return dupes;
}

/** Checks that must hold before the resolver can walk the graph: ids, links, and references. */
export function validateSpec(spec: ScenarioSpec): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const { nodes, links } = spec.network;

  for (const i of duplicateIndexes(nodes, (n) => n.id)) {
    issues.push({
      code: "duplicate-node-id",
      path: `network/nodes/${i}`,
      message: `duplicate node id ${nodes[i]?.id}`,
    });
  }
  for (const i of duplicateIndexes(links, (l) => l.id)) {
    issues.push({
      code: "duplicate-link-id",
      path: `network/links/${i}`,
      message: `duplicate link id ${links[i]?.id}`,
    });
  }
  // Reference checks below assume unique ids; with duplicates they would only add noise.
  if (issues.length > 0) return issues;

  const linkById = new Map(links.map((l) => [l.id, l]));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const ifaceRefs = new Set(nodes.flatMap((n) => n.interfaces.map((i) => `${n.id}/${i.name}`)));

  links.forEach((l, li) => {
    for (const end of ["a", "b"] as const) {
      if (!ifaceRefs.has(l[end])) {
        issues.push({
          code: "unknown-interface",
          path: `network/links/${li}/${end}`,
          message: `no interface ${l[end]}`,
        });
      }
    }
  });

  nodes.forEach((n, ni) => {
    for (const i of duplicateIndexes(n.interfaces, (iface) => iface.name)) {
      issues.push({
        code: "duplicate-interface-name",
        path: `network/nodes/${ni}/interfaces/${i}`,
        message: `${n.id}: duplicate interface name ${n.interfaces[i]?.name}`,
      });
    }
    n.interfaces.forEach((iface, i) => {
      const path = `network/nodes/${ni}/interfaces/${i}`;
      const link = linkById.get(iface.link);
      if (!link) {
        issues.push({
          code: "unknown-link",
          path,
          message: `${n.id}/${iface.name} refers to unknown link ${iface.link}`,
        });
        return;
      }
      const ref = `${n.id}/${iface.name}`;
      if (link.a !== ref && link.b !== ref) {
        issues.push({
          code: "link-endpoint-mismatch",
          path,
          message: `${ref} claims link ${link.id}, but that link joins ${link.a} and ${link.b}`,
        });
      }
    });
    if (!isL3(n)) return;
    const ifaceNames = new Set(n.interfaces.map((i) => i.name));
    (n.routes ?? []).forEach((r, i) => {
      if (r.dev !== undefined && !ifaceNames.has(r.dev)) {
        issues.push({
          code: "route-dev-unknown",
          path: `network/nodes/${ni}/routes/${i}`,
          message: `${n.id}: route dev ${r.dev} is not an interface`,
        });
      }
    });
  });

  spec.actions.forEach((a, i) => {
    for (const end of ["from", "to"] as const) {
      const { ip, name } = a[end];
      if (ip !== undefined || name === undefined) continue;
      const node = nodeById.get(name);
      if (!node) {
        issues.push({
          code: "unknown-node",
          path: `actions/${i}/${end}`,
          message: `unknown node ${name}`,
        });
      } else if (!isL3(node)) {
        issues.push({
          code: "endpoint-not-l3",
          path: `actions/${i}/${end}`,
          message: `${name} is a switch and has no address`,
        });
      }
    }
  });
  return issues;
}

/**
 * Checks on the resolved network: address uniqueness, and that both ends of every action are
 * owned by some interface. Every address a lesson pings is owned by someone; there is no ARP
 * timeout to fall back on.
 */
export function validateScenario(scenario: Scenario): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const ifaces = scenario.network.nodes.flatMap((n, ni) =>
    isL3(n)
      ? n.interfaces.map((iface, ii) => ({ iface, path: `network/nodes/${ni}/interfaces/${ii}` }))
      : [],
  );

  for (const i of duplicateIndexes(ifaces, (x) => x.iface.mac)) {
    const x = ifaces[i];
    if (x)
      issues.push({
        code: "duplicate-mac",
        path: x.path,
        message: `MAC ${x.iface.mac} is already in use`,
      });
  }
  for (const i of duplicateIndexes(ifaces, (x) => String(parseCidr(x.iface.ip).ip))) {
    const x = ifaces[i];
    if (x)
      issues.push({
        code: "duplicate-ip",
        path: x.path,
        message: `address ${x.iface.ip} is already in use`,
      });
  }

  const owned = new Set(ifaces.map((x) => parseCidr(x.iface.ip).ip));
  scenario.actions.forEach((a, i) => {
    for (const end of ["from", "to"] as const) {
      if (!owned.has(parseIp(a[end].ip))) {
        issues.push({
          code: "endpoint-ip-unknown",
          path: `actions/${i}/${end}`,
          message: `no interface owns ${a[end].ip}`,
        });
      }
    }
  });
  return issues;
}
