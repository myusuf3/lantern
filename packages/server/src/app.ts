import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { ENGINE_VERSION, loadScenario, ScenarioError } from "@lantern/engine";
import { type Context, Hono } from "hono";
import { capturesPage, pageMarkdown } from "./captures.js";
import { Lessons } from "./lessons.js";
import { Runs } from "./runs.js";

export interface AppOptions {
  /** Directory of the built web app. When unset, only the API is served. */
  staticDir?: string;
  /** Directory of lessons. When unset, /api/lessons is empty. */
  lessonsDir?: string;
}

export function createApp({ staticDir, lessonsDir }: AppOptions = {}) {
  const app = new Hono();
  const runs = new Runs();
  const lessons = lessonsDir ? new Lessons(lessonsDir) : undefined;

  app.get("/api/health", (c) => c.json({ ok: true, engine: ENGINE_VERSION }));

  app.post("/api/runs", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    if (body === undefined) return c.json({ error: "body must be JSON" }, 400);
    try {
      const { id, run } = runs.run(loadScenario(body));
      return c.json({ id, ...run });
    } catch (e) {
      if (!(e instanceof ScenarioError)) throw e;
      return c.json({ error: "invalid scenario", issues: e.issues }, 400);
    }
  });

  app.get("/api/runs/:id/pcap", (c) => {
    const id = c.req.param("id");
    const pcap = runs.pcap(id);
    if (!pcap) return c.json({ error: "unknown run" }, 404);
    return c.body(new Uint8Array(pcap).buffer, 200, {
      "content-type": "application/vnd.tcpdump.pcap",
      "content-disposition": `attachment; filename="lantern-${id}.pcap"`,
    });
  });

  app.get("/api/lessons", async (c) => c.json(lessons ? await lessons.list() : []));

  app.get("/api/glossary", async (c) => c.json(lessons ? await lessons.glossary() : {}));

  app.get("/api/home", async (c) =>
    c.json({ markdown: lessonsDir ? await pageMarkdown(lessonsDir, "home.md") : "" }),
  );

  app.get("/api/captures", async (c) =>
    c.json(
      lessons && lessonsDir
        ? await capturesPage(lessons, runs, lessonsDir)
        : { markdown: "", captures: [] },
    ),
  );

  app.get("/api/lessons/:id", async (c) => {
    const lesson = await lessons?.get(c.req.param("id"));
    return lesson ? c.json(lesson) : c.json({ error: "unknown lesson" }, 404);
  });

  if (staticDir) {
    const index = readFile(join(staticDir, "index.html"), "utf8");
    const page = async (c: Context) => c.html((await index).replaceAll(PUBLIC_URL, originOf(c)));
    app.get("/", page);
    app.get("/index.html", page);
    app.use("/*", serveStatic({ root: staticDir }));
  }

  return app;
}

/**
 * Link previews need absolute URLs, and the site does not know where it is hosted until a request
 * arrives. The built page carries this placeholder where its public origin belongs.
 */
const PUBLIC_URL = "__PUBLIC_URL__";

function originOf(c: Context): string {
  const proto = c.req.header("x-forwarded-proto") ?? "http";
  return `${proto}://${c.req.header("host") ?? "localhost"}`;
}
