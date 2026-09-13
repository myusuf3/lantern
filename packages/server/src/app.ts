import { serveStatic } from "@hono/node-server/serve-static";
import { ENGINE_VERSION } from "@lantern/engine";
import { Hono } from "hono";

export interface AppOptions {
  /** Directory of the built web app. When unset, only the API is served. */
  staticDir?: string;
}

export function createApp({ staticDir }: AppOptions = {}) {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ ok: true, engine: ENGINE_VERSION }));

  if (staticDir) {
    app.use("/*", serveStatic({ root: staticDir }));
  }

  return app;
}
