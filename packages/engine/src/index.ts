export const ENGINE_VERSION = 1;

export { type ConfigIssue, type IssueCode, ScenarioError } from "./errors.js";
export { loadScenario } from "./load.js";
export {
  type Action,
  type ActionSpec,
  type Endpoint,
  type Interface,
  isL3,
  type L3Node,
  type Link,
  type Neighbor,
  type Network,
  type NetworkSpec,
  type Node,
  type Route,
  type Scenario,
  type ScenarioSpec,
  type SwitchNode,
  scenarioSchema,
  scenarioSpecSchema,
} from "./schema.js";
export type { DropReason, Event, EventKind, FrameRecord, RunResult } from "./sim/events.js";
export { captureOf, PING_INTERVAL_US, PROCESSING_US, simulate } from "./sim/simulate.js";
export { type FrameSummary, summarizeFrame } from "./wire/frame.js";
export { type PcapRecord, writePcap } from "./wire/pcap.js";
