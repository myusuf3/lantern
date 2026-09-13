import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadScenario, type RunResult } from "@lantern/engine";
import type { Lessons } from "./lessons.js";
import type { Runs } from "./runs.js";

export interface Capture {
  lesson: string;
  lessonTitle: string;
  scene: string;
  sceneTitle: string;
  run: string;
  /** One line per frame in the capture, in order. */
  frames: string[];
}

/** A standalone page's prose, or empty when the file is missing. */
export function pageMarkdown(dir: string, ...path: string[]): Promise<string> {
  return readFile(join(dir, ...path), "utf8").catch(() => "");
}

/** The closing page: every scene's capture, plus the prose that introduces them. */
export async function capturesPage(lessons: Lessons, runs: Runs, dir: string) {
  const markdown = await pageMarkdown(dir, "captures", "page.md");
  const captures: Capture[] = [];
  for (const summary of await lessons.list()) {
    const lesson = await lessons.get(summary.id);
    for (const scene of lesson?.scenes ?? []) {
      const { id, run } = runs.run(loadScenario(scene.scenario));
      captures.push({
        lesson: summary.id,
        lessonTitle: summary.title,
        scene: scene.id,
        sceneTitle: scene.title,
        run: id,
        frames: frameLines(run),
      });
    }
  }
  return { markdown, captures };
}

/** The frames as tshark would list them: each once, at its first transmission. */
function frameLines(run: RunResult): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const e of run.events) {
    if (e.kind !== "frame.tx" || seen.has(e.frame)) continue;
    seen.add(e.frame);
    const s = run.frames[e.frame]?.summary;
    if (!s) continue;
    if (s.arp) lines.push(`ARP ${s.arp.op} ${s.arp.sender_ip} -> ${s.arp.target_ip}`);
    else if (s.ip && s.icmp)
      lines.push(
        `ICMP ${s.icmp.type.replace("-", " ")} ${s.ip.src} -> ${s.ip.dst} TTL ${s.ip.ttl}`,
      );
  }
  return lines;
}
