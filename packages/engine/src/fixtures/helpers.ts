import { isL3, type L3Node, type Scenario } from "../schema.js";
import { lesson2Minimal } from "./lesson2.js";

/** A scenario typed loosely enough to break on purpose. */
export interface LooseScenario {
  version: unknown;
  network: { nodes: Record<string, unknown>[]; links: Record<string, unknown>[] };
  actions: Record<string, unknown>[];
}

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

export function loose(v: unknown): LooseScenario {
  return clone(v) as LooseScenario;
}

/** Lesson 2 minimal with one node patched. */
export function withNode(index: number, patch: Record<string, unknown>): LooseScenario {
  const s = loose(lesson2Minimal);
  s.network.nodes[index] = { ...s.network.nodes[index], ...patch };
  return s;
}

/** Lesson 2 minimal with one link patched. */
export function withLink(index: number, patch: Record<string, unknown>): LooseScenario {
  const s = loose(lesson2Minimal);
  s.network.links[index] = { ...s.network.links[index], ...patch };
  return s;
}

/** Lesson 2 minimal with one action patched. */
export function withAction(index: number, patch: Record<string, unknown>): LooseScenario {
  const s = loose(lesson2Minimal);
  s.actions[index] = { ...s.actions[index], ...patch };
  return s;
}

export function l3(scenario: Scenario, id: string): L3Node {
  const node = scenario.network.nodes.find((n) => n.id === id);
  if (!node || !isL3(node)) throw new Error(`no L3 node ${id}`);
  return node;
}
