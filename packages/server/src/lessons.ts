import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

export interface LessonSummary {
  id: string;
  title: string;
  summary: string;
  /** Which node tables the scene draws for this lesson. */
  show: { arp: boolean; routes: boolean };
}

export interface Lesson extends LessonSummary {
  /** The scenario as authored, so the client can post it to /api/runs unchanged. */
  scenario: unknown;
  /** Markdown per narration slot, keyed by file name without extension: `intro`, `arp.miss`, ... */
  narration: Record<string, string>;
}

export interface GlossaryEntry {
  title: string;
  body: string;
}

const LESSON_ID = /^[a-z0-9][a-z0-9-]*$/;
const GLOSSARY_DIR = "glossary";

/**
 * One directory per lesson: `lesson.json`, `scenario.json`, and a `narration/` folder of markdown.
 * A sibling `glossary/` folder holds one markdown file per term, shared by every lesson.
 */
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
    return { ...meta, scenario, narration: await this.markdownIn(join(this.dir, id, "narration")) };
  }

  /** Every term. A file's first line is `# Title`; the rest is the definition. */
  async glossary(): Promise<Record<string, GlossaryEntry>> {
    const files = await this.markdownIn(join(this.dir, GLOSSARY_DIR));
    return Object.fromEntries(
      Object.entries(files).map(([slug, text]) => {
        const [first = "", ...rest] = text.split("\n");
        return [slug, { title: first.replace(/^#\s*/, ""), body: rest.join("\n").trim() }];
      }),
    );
  }

  private async meta(id: string): Promise<LessonSummary | undefined> {
    if (!LESSON_ID.test(id) || id === GLOSSARY_DIR) return undefined;
    try {
      const { title, summary, show } = JSON.parse(
        await readFile(join(this.dir, id, "lesson.json"), "utf8"),
      );
      return {
        id,
        title: String(title),
        summary: String(summary ?? ""),
        show: { arp: Boolean(show?.arp), routes: Boolean(show?.routes) },
      };
    } catch {
      return undefined;
    }
  }

  /** Every `.md` in a directory, keyed by file name without extension. Missing directory: empty. */
  private async markdownIn(dir: string): Promise<Record<string, string>> {
    const files = (await readdir(dir).catch(() => [])).filter((f) => extname(f) === ".md").sort();
    const entries = await Promise.all(
      files.map(async (f) => [basename(f, ".md"), await readFile(join(dir, f), "utf8")] as const),
    );
    return Object.fromEntries(entries);
  }
}
