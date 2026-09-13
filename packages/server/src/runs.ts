import { createHash } from "node:crypto";
import { captureOf, type RunResult, type Scenario, simulate } from "@lantern/engine";

/**
 * Runs kept in memory, keyed by a hash of the resolved scenario. The engine is deterministic,
 * so the same scenario always maps to the same id and the same result.
 */
export class Runs {
  private readonly runs = new Map<string, RunResult>();

  run(scenario: Scenario): { id: string; run: RunResult } {
    const id = createHash("sha256").update(JSON.stringify(scenario)).digest("hex").slice(0, 12);
    const run = this.runs.get(id) ?? simulate(scenario);
    this.runs.set(id, run);
    return { id, run };
  }

  pcap(id: string): Uint8Array | undefined {
    const run = this.runs.get(id);
    return run && captureOf(run);
  }
}
