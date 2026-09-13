import { join } from "node:path";
import { serve } from "@hono/node-server";
import { configure, getConsoleSink } from "@logtape/logtape";
import { createApp } from "./app.js";

await configure({
  sinks: { console: getConsoleSink() },
  loggers: [{ category: ["lantern"], lowestLevel: "info", sinks: ["console"] }],
});

const port = Number(process.env.PORT ?? 3000);
const app = createApp({
  ...(process.env.LANTERN_STATIC_DIR ? { staticDir: process.env.LANTERN_STATIC_DIR } : {}),
  lessonsDir: process.env.LANTERN_LESSONS_DIR ?? join(import.meta.dirname, "../../lessons"),
});
serve({ fetch: app.fetch, port });
console.log(`lantern server listening on http://localhost:${port}`);
