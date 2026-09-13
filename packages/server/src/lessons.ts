import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

export interface LessonSummary {
  id: string;
  title: string;
  summary: string;
}

export interface Lesson extends LessonSummary {
  /** The scenario as authored, so the client can post it to /api/runs unchanged. */
  scenario: unknown;
  /** Markdown per narration slot, keyed by file name without extension: `intro`, `arp.miss`, ... */
  narration: Record<string, string>;
}

const LESSON_ID = /^[a-z0-9][a-z0-9-]*$/;

/** One directory per lesson: `lesson.json`, `scenario.json`, and a `narration/` folder of markdown. */
export class Lessons {
  constructor(private readonly dir: string) {}

  async list(): Promise<LessonSummary[]> {
    const entries = await readdir(this.dir, { withFileTypes: true });
    const ids = entries.filter((e) => e.isDirectory() && LESSON_ID.test(e.name)).map((e) => e.name);
    const found = await Promise.all(ids.sort().map((id) => this.meta(id)));
    return found.filter((l): l is LessonSummary => l !== undefined);
  }

  async get(id: string): Promise<Lesson | undefined> {
    const meta = await this.meta(id);
    if (!meta) return undefined;
    const scenario = JSON.parse(await readFile(join(this.dir, id, "scenario.json"), "utf8"));
    return { ...meta, scenario, narration: await this.narration(id) };
  }

  private async meta(id: string): Promise<LessonSummary | undefined> {
    if (!LESSON_ID.test(id)) return undefined;
    try {
      const { title, summary } = JSON.parse(
        await readFile(join(this.dir, id, "lesson.json"), "utf8"),
      );
      return { id, title: String(title), summary: String(summary ?? "") };
    } catch {
      return undefined;
    }
  }

  private async narration(id: string): Promise<Record<string, string>> {
    const dir = join(this.dir, id, "narration");
    const files = (await readdir(dir).catch(() => [])).filter((f) => extname(f) === ".md").sort();
    const slots = await Promise.all(
      files.map(async (f) => [basename(f, ".md"), await readFile(join(dir, f), "utf8")] as const),
    );
    return Object.fromEntries(slots);
  }
}
