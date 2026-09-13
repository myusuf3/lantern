import { describe, expect, it } from "vitest";
import { ENGINE_VERSION } from "./index.js";

describe("engine package", () => {
  it("exports a schema version", () => {
    expect(ENGINE_VERSION).toBe(1);
  });
});
