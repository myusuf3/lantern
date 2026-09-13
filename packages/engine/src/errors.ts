export type IssueCode =
  | "schema"
  | "duplicate-node-id"
  | "duplicate-link-id"
  | "duplicate-interface-name"
  | "unknown-link"
  | "unknown-interface"
  | "link-endpoint-mismatch"
  | "route-dev-unknown"
  | "gateway-unresolvable"
  | "neighbor-not-connected"
  | "duplicate-mac"
  | "duplicate-ip"
  | "unknown-node"
  | "endpoint-ip-unknown"
  | "endpoint-not-l3";

export interface ConfigIssue {
  code: IssueCode;
  /** Index-keyed location in the scenario document, e.g. `network/nodes/2/routes/1`. */
  path: string;
  message: string;
}

export class ScenarioError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super(issues.map((i) => `${i.path}: ${i.message} [${i.code}]`).join("\n"));
    this.name = "ScenarioError";
    this.issues = issues;
  }

  static throwIfAny(issues: readonly ConfigIssue[]): void {
    if (issues.length > 0) throw new ScenarioError(issues);
  }
}
