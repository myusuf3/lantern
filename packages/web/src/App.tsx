import type { FrameRecord } from "@lantern/engine";
import { useEffect, useMemo, useState } from "react";
import { api, type Glossary, type Lesson, type Run } from "./api.js";
import { frameLabel, headersOf } from "./frames.js";
import { Prose } from "./Prose.js";
import { Scene } from "./Scene.js";
import { arpTableAt, turnsOf } from "./steps.js";

/** Pause between steps when the reader presses play rather than stepping. */
export const PLAY_STEP_MS = 1800;
const LESSON_ID = "01-two-hosts";

export function App() {
  const [lesson, setLesson] = useState<Lesson>();
  const [glossary, setGlossary] = useState<Glossary>({});
  const [run, setRun] = useState<Run>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    Promise.all([api.lesson(LESSON_ID), api.glossary()])
      .then(async ([l, g]) => {
        setLesson(l);
        setGlossary(g);
        setRun(await api.run(l.scenario));
      })
      .catch((e: unknown) => setError(String(e)));
  }, []);

  if (error) return <main className="page">Could not load the lesson: {error}</main>;
  if (!lesson || !run) return <main className="page">Loading…</main>;
  return <LessonView lesson={lesson} glossary={glossary} run={run} />;
}

interface LessonViewProps {
  lesson: Lesson;
  glossary: Glossary;
  run: Run;
}

function LessonView({ lesson, glossary, run }: LessonViewProps) {
  const turns = useMemo(() => turnsOf(run.events), [run]);
  // -1 is the intro, turns.length is the outro.
  const [step, setStep] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const atIntro = step < 0;
  const atOutro = step >= turns.length;
  const turn = turns[step];

  // Advance on a timer while playing; the timer is re-armed each time `step` changes.
  useEffect(() => {
    if (!playing) return;
    if (step >= turns.length) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setStep(step + 1), PLAY_STEP_MS);
    return () => clearTimeout(t);
  }, [playing, step, turns.length]);

  const arpTables = useMemo(() => {
    if (!lesson.show.arp) return undefined;
    const at = Math.min(step, turns.length - 1);
    return Object.fromEntries(
      run.network.nodes
        .filter((n) => n.kind !== "switch")
        .map((n) => [n.id, arpTableAt(run, turns, n.id, at)]),
    );
  }, [lesson, run, turns, step]);

  const frameId = turn?.arriving?.frame ?? turn?.sent;
  const frame: FrameRecord | undefined = frameId ? run.frames[frameId] : undefined;
  const inFlight =
    turn?.arriving && frame
      ? {
          link: turn.arriving.link,
          from: turn.arriving.from,
          label: frameLabel(frame),
          key: `${step}`,
        }
      : undefined;

  const slots = atIntro
    ? ["intro"]
    : atOutro
      ? ["outro"]
      : [...new Set(turn?.events.map((e) => e.kind))];
  const narration = slots.flatMap((slot) => {
    const md = lesson.narration[slot];
    return md ? [{ slot, md }] : [];
  });

  return (
    <div className="page">
      <header className="masthead">
        <h1>{lesson.title}</h1>
        <p className="summary">{lesson.summary}</p>
      </header>

      <Scene
        network={run.network}
        arpTables={arpTables}
        activeNode={turn?.node}
        inFlight={inFlight}
      />

      <section className="panel">
        <div className="narration">
          {narration.map(({ slot, md }) => (
            <Prose key={`${step}:${slot}`} markdown={md} glossary={glossary} />
          ))}
          {atOutro && (
            <a className="download" href={api.pcapUrl(run.id)} download={`lantern-${run.id}.pcap`}>
              Download the capture (.pcap)
            </a>
          )}
        </div>
        {frame && <FrameInspector frame={frame} glossary={glossary} />}
      </section>

      <footer className="stepper">
        {atIntro ? (
          <button type="button" className="primary" onClick={() => setStep(0)}>
            Send ping
          </button>
        ) : (
          <>
            <span className="progress">
              {atOutro ? "Done" : `Step ${step + 1} of ${turns.length}`}
            </span>
            <div className="transport">
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={step <= 0}
              >
                Back
              </button>
              <button type="button" onClick={() => setPlaying((p) => !p)} disabled={atOutro}>
                {playing ? "Pause" : "Play"}
              </button>
              <button
                type="button"
                onClick={() => setStep((s) => Math.min(turns.length, s + 1))}
                disabled={atOutro}
              >
                Next
              </button>
            </div>
            <span className="clock mono">{turn ? `t = ${turn.t_us} µs` : ""}</span>
          </>
        )}
      </footer>
    </div>
  );
}

function FrameInspector({ frame, glossary }: { frame: FrameRecord; glossary: Glossary }) {
  const [open, setOpen] = useState<string | undefined>();
  return (
    <div className="inspector" data-testid="frame-inspector">
      <div className="inspector-title">{frameLabel(frame)}</div>
      {headersOf(frame).map((block) => (
        <div key={block.name} className="header-block">
          <div className="header-name">{block.name}</div>
          <dl>
            {block.fields.map((f) => {
              const entry = f.term ? glossary[f.term] : undefined;
              const key = `${block.name}-${f.name}`;
              return (
                <div key={key} className="field">
                  <dt>
                    {entry ? (
                      <button
                        type="button"
                        className={`term${open === key ? " term-open" : ""}`}
                        onClick={() => setOpen(open === key ? undefined : key)}
                      >
                        {f.name}
                      </button>
                    ) : (
                      f.name
                    )}
                  </dt>
                  <dd className="mono">
                    {f.value}
                    {f.note && <span className="note">{f.note}</span>}
                  </dd>
                  {entry && open === key && (
                    <div role="dialog" aria-label={entry.title} className="term-pop term-pop-field">
                      <strong>{entry.title}</strong>
                      <span>{entry.body}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </dl>
        </div>
      ))}
    </div>
  );
}
