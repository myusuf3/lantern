import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

describe("server", () => {
  it("reports health with the engine version", async () => {
    const res = await createApp().request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, engine: 1 });
  });

  it("serves the web app from the static directory when configured", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lantern-static-"));
    await writeFile(join(dir, "index.html"), "<h1>Lantern</h1>");

    const res = await createApp({ staticDir: dir }).request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>Lantern</h1>");
  });

  it("does not serve files when no static directory is configured", async () => {
    const res = await createApp().request("/");
    expect(res.status).toBe(404);
  });
});
