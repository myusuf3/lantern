import { ZodError } from "zod";
import { type ConfigIssue, ScenarioError } from "./errors.js";
import { resolveScenario } from "./resolve.js";
import { type Scenario, scenarioSpecSchema } from "./schema.js";
import { validateScenario, validateSpec } from "./validate.js";

/**
 * Parse, validate, resolve, and validate again. The only entry point callers need:
 * unknown JSON in, a fully specified scenario out, or a ScenarioError listing every issue.
 */
export function loadScenario(input: unknown): Scenario {
  const spec = parseOrThrow(input);
  ScenarioError.throwIfAny(validateSpec(spec));
  const scenario = resolveScenario(spec);
  ScenarioError.throwIfAny(validateScenario(scenario));
  return scenario;
}

function parseOrThrow(input: unknown) {
  try {
    return scenarioSpecSchema.parse(input);
  } catch (e) {
    if (!(e instanceof ZodError)) throw e;
    const issues: ConfigIssue[] = e.issues.map((i) => ({
      code: "schema",
      path: i.path.map(String).join("/"),
      message: i.message,
    }));
    throw new ScenarioError(issues);
  }
}
