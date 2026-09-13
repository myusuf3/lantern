import type { RunResult } from "@lantern/engine";

export interface LessonSummary {
  id: string;
  title: string;
  summary: string;
  show: { arp: boolean; routes: boolean };
}

export interface Scene {
  id: string;
  title: string;
  scenario: unknown;
  /** Slots keyed by event kind, or `kind@node` for one node's version of it. */
  narration: Record<string, string>;
}

export interface Lesson extends LessonSummary {
  scenes: Scene[];
}

export type Glossary = Record<string, { title: string; body: string }>;

export interface Capture {
  lesson: string;
  lessonTitle: string;
  scene: string;
  sceneTitle: string;
  run: string;
  frames: string[];
}

export interface CapturesPage {
  markdown: string;
  captures: Capture[];
}

export interface Run extends RunResult {
  id: string;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  lessons: () => getJson<LessonSummary[]>("/api/lessons"),
  lesson: (id: string) => getJson<Lesson>(`/api/lessons/${id}`),
  glossary: () => getJson<Glossary>("/api/glossary"),
  captures: () => getJson<CapturesPage>("/api/captures"),
  home: () => getJson<{ markdown: string }>("/api/home"),
  pcapUrl: (runId: string) => `/api/runs/${runId}/pcap`,
  run: async (scenario: unknown): Promise<Run> => {
    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(scenario),
    });
    if (!res.ok) throw new Error(`run failed: ${res.status}`);
    return (await res.json()) as Run;
  },
};
