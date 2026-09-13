import type { RunResult } from "@lantern/engine";

export interface LessonSummary {
  id: string;
  title: string;
  summary: string;
  show: { arp: boolean; routes: boolean };
}

export interface Lesson extends LessonSummary {
  scenario: unknown;
  narration: Record<string, string>;
}

export type Glossary = Record<string, { title: string; body: string }>;

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
