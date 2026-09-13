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
      show: { arp: true, routes: false },
    });
  });

  it("returns one lesson with its scenes, each with a scenario and narration slots", async () => {
    const res = await app().request("/api/lessons/01-two-hosts");
    expect(res.status).toBe(200);
    const lesson = (await res.json()) as {
      id: string;
      title: string;
      scenes: {
        id: string;
        title: string;
        scenario: { version: number };
        narration: Record<string, string>;
      }[];
    };
    expect(lesson.id).toBe("01-two-hosts");
    const [scene] = lesson.scenes;
    expect(lesson.scenes).toHaveLength(1);
    expect(scene?.id).toBe("01-cable");
    expect(scene?.title).toBe("Two hosts, one cable");
    expect(scene?.scenario.version).toBe(1);
    expect(Object.keys(scene?.narration ?? {}).sort()).toEqual([
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
    expect(scene?.narration.intro).toMatch(/^Two computers\. One cable\./);
    expect(() => loadScenario(scene?.scenario)).not.toThrow();
  });

  it("returns lesson 2 with two scenes and node-specific narration slots", async () => {
    const res = await app().request("/api/lessons/02-through-a-router");
    const lesson = (await res.json()) as {
      scenes: { id: string; narration: Record<string, string> }[];
    };
    expect(lesson.scenes.map((s) => s.id)).toEqual(["01-router", "02-switch"]);
    expect(lesson.scenes[0]?.narration["route.lookup@laptop"]).toMatch(/gateway/);
    expect(lesson.scenes[1]?.narration["switch.flood"]).toMatch(/every other port/);
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

describe("GET /api/glossary", () => {
  it("returns every term with its title and definition, keyed by slug", async () => {
    const res = await app().request("/api/glossary");
    expect(res.status).toBe(200);
    const glossary = (await res.json()) as Record<string, { title: string; body: string }>;
    expect(glossary["mac-address"]).toEqual({
      title: "MAC address",
      body: expect.stringMatching(/network card/),
    });
    expect(Object.keys(glossary).length).toBeGreaterThan(5);
  });

  it("is empty when there is no glossary directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lantern-lessons-"));
    const res = await createApp({ lessonsDir: dir }).request("/api/glossary");
    expect(await res.json()).toEqual({});
  });
});

describe("GET /api/home", () => {
  it("returns the landing page prose", async () => {
    const res = await app().request("/api/home");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { markdown: string }).markdown).toMatch(/typed `ping` before/);
  });
});

describe("GET /api/captures", () => {
  it("runs every scene of every lesson and lists its capture", async () => {
    const server = app();
    const res = await server.request("/api/captures");
    expect(res.status).toBe(200);
    const page = (await res.json()) as {
      markdown: string;
      captures: {
        lesson: string;
        lessonTitle: string;
        scene: string;
        sceneTitle: string;
        run: string;
        frames: string[];
      }[];
    };
    expect(page.markdown).toMatch(/Wireshark/);
    const ids = page.captures.map((c) => `${c.lesson}/${c.scene}`);
    expect(ids.slice(0, 3)).toEqual([
      "01-two-hosts/01-cable",
      "02-through-a-router/01-router",
      "02-through-a-router/02-switch",
    ]);
    expect(ids).toContain("03-many-routers/01-three-routers");
    const [first] = page.captures;
    expect(first?.lessonTitle).toBe("Two hosts and a cable");
    expect(first?.frames).toEqual([
      "ARP request 10.0.1.10 -> 10.0.1.11",
      "ARP reply 10.0.1.11 -> 10.0.1.10",
      "ICMP echo request 10.0.1.10 -> 10.0.1.11 TTL 64",
      "ICMP echo reply 10.0.1.11 -> 10.0.1.10 TTL 64",
    ]);
    const pcap = await server.request(`/api/runs/${first?.run}/pcap`);
    expect(pcap.status).toBe(200);
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

  it("fills the page's public origin in from the request, so link previews get absolute URLs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lantern-static-"));
    await writeFile(
      join(dir, "index.html"),
      '<meta property="og:image" content="__PUBLIC_URL__/oneframe.jpg" />',
    );
    const app = createApp({ staticDir: dir });
    const behindProxy = await app.request("/", {
      headers: { host: "frames.example", "x-forwarded-proto": "https" },
    });
    expect(await behindProxy.text()).toBe(
      '<meta property="og:image" content="https://frames.example/oneframe.jpg" />',
    );
    const plain = await app.request("/index.html", { headers: { host: "localhost:3000" } });
    expect(await plain.text()).toContain('content="http://localhost:3000/oneframe.jpg"');
  });

  it("does not serve files when no static directory is configured", async () => {
    expect((await createApp().request("/")).status).toBe(404);
  });
});
