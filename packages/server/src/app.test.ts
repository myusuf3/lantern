import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadScenario, type RunResult, simulate } from "@lantern/engine";
import { dissect } from "@lantern/engine/testing";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const LESSONS_DIR = join(import.meta.dirname, "../../lessons");

const twoHosts = {
  version: 1,
  network: {
    nodes: [
      { id: "a", kind: "host", interfaces: [{ name: "eth0", link: "l1" }] },
      { id: "b", kind: "host", interfaces: [{ name: "eth0", link: "l1" }] },
    ],
    links: [{ id: "l1", a: "a/eth0", b: "b/eth0" }],
  },
  actions: [{ action: "ping", from: { name: "a" }, to: { name: "b" } }],
};

function app() {
  return createApp({ lessonsDir: LESSONS_DIR });
}

async function postRun(scenario: unknown) {
  return app().request("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(scenario),
  });
}

describe("health", () => {
  it("reports the engine version", async () => {
    const res = await app().request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, engine: 1 });
  });
});

describe("POST /api/runs", () => {
  it("simulates a scenario and returns exactly what the engine returns, plus an id", async () => {
    const res = await postRun(twoHosts);
    expect(res.status).toBe(200);
    const body = (await res.json()) as RunResult & { id: string };
    const { id, ...run } = body;
    expect(typeof id).toBe("string");
    expect(run).toEqual(JSON.parse(JSON.stringify(simulate(loadScenario(twoHosts)))));
  });

  it("gives the same id for the same scenario", async () => {
    const a = (await (await postRun(twoHosts)).json()) as { id: string };
    const b = (await (await postRun(twoHosts)).json()) as { id: string };
    expect(a.id).toBe(b.id);
  });

  it("rejects an invalid scenario with 400 and the issues by name", async () => {
    const broken = {
      ...twoHosts,
      actions: [{ action: "ping", from: { name: "nope" }, to: { name: "b" } }],
    };
    const res = await postRun(broken);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "invalid scenario",
      issues: [{ code: "unknown-node", path: "actions/0/from", message: "unknown node nope" }],
    });
  });

  it("rejects a body that is not JSON", async () => {
    const res = await app().request("/api/runs", { method: "POST", body: "not json" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/runs/:id/pcap", () => {
  it("returns a capture tshark dissects as the run's frames", async () => {
    const server = app();
    const post = await server.request("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(twoHosts),
    });
    const { id } = (await post.json()) as { id: string };

    const res = await server.request(`/api/runs/${id}/pcap`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/vnd.tcpdump.pcap");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="lantern-${id}.pcap"`,
    );
    const packets = await dissect(new Uint8Array(await res.arrayBuffer()));
    expect(packets.map((p) => p.summary)).toEqual([
      "ARP request 10.0.1.10 -> 10.0.1.11",
      "ARP reply 10.0.1.11 -> 10.0.1.10",
      "ICMP echo-request 10.0.1.10 -> 10.0.1.11 ttl=64",
      "ICMP echo-reply 10.0.1.11 -> 10.0.1.10 ttl=64",
    ]);
    expect(packets.every((p) => p.checksumsGood && p.expertErrors.length === 0)).toBe(true);
  });

  it("is 404 for a run this server has not seen", async () => {
    const res = await app().request("/api/runs/nope/pcap");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/lessons", () => {
  it("lists lessons in directory order with title and summary", async () => {
    const res = await app().request("/api/lessons");
    expect(res.status).toBe(200);
    const lessons = (await res.json()) as { id: string; title: string; summary: string }[];
    expect(lessons[0]).toEqual({
      id: "01-two-hosts",
      title: "Two hosts and a cable",
      summary: expect.stringContaining("smallest network"),
    });
  });

  it("returns one lesson with its scenario and narration slots", async () => {
    const res = await app().request("/api/lessons/01-two-hosts");
    expect(res.status).toBe(200);
    const lesson = (await res.json()) as {
      id: string;
      title: string;
      scenario: { version: number };
      narration: Record<string, string>;
    };
    expect(lesson.id).toBe("01-two-hosts");
    expect(lesson.scenario.version).toBe(1);
    expect(Object.keys(lesson.narration).sort()).toEqual([
      "arp.hit",
      "arp.learn",
      "arp.miss",
      "arp.reply",
      "aside.arp-aging",
      "icmp.recv",
      "icmp.reply",
      "intro",
      "outro",
      "route.lookup",
    ]);
    expect(lesson.narration.intro).toMatch(/^Two computers\. One cable\./);
    expect(() => loadScenario(lesson.scenario)).not.toThrow();
  });

  it("is 404 for an unknown lesson and for path tricks", async () => {
    expect((await app().request("/api/lessons/nope")).status).toBe(404);
    expect((await app().request("/api/lessons/..%2F..%2Fpackage.json")).status).toBe(404);
  });

  it("skips directories without a lesson.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lantern-lessons-"));
    await writeFile(join(dir, "stray.txt"), "");
    const res = await createApp({ lessonsDir: dir }).request("/api/lessons");
    expect(await res.json()).toEqual([]);
  });
});

describe("static files", () => {
  it("serves the web app from the static directory when configured", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lantern-static-"));
    await writeFile(join(dir, "index.html"), "<h1>Lantern</h1>");
    const res = await createApp({ staticDir: dir }).request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>Lantern</h1>");
  });

  it("does not serve files when no static directory is configured", async () => {
    expect((await createApp().request("/")).status).toBe(404);
  });
});
