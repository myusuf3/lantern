import type { FrameRecord } from "@lantern/engine";
import { useEffect, useMemo, useState } from "react";
import {
  api,
  type Glossary,
  type Lesson,
  type LessonSummary,
  type Run,
  type Scene as SceneData,
} from "./api.js";
import { Captures } from "./Captures.js";
import { cableLabel, frameLabel, headersOf } from "./frames.js";
import { Home } from "./Home.js";
import { Prose } from "./Prose.js";
import { Scene } from "./Scene.js";
import { arpTableAt, macTableAt, routeUsedIn, turnsOf } from "./steps.js";

/** The hashes of the two standalone pages. */
const HOME = "home";
const CAPTURES = "captures";

/** How long play holds each step. The ring around the Play button fills over the same time. */
export const PLAY_STEP_MS = 10_000;

/** `#lesson-id/scene-id` in the URL keeps the reader's place across reloads. */
function readHash(): { lesson?: string; scene?: string } {
  const [lesson, scene] = window.location.hash.replace(/^#/, "").split("/");
  return { ...(lesson ? { lesson } : {}), ...(scene ? { scene } : {}) };
}

export function App() {
  const [lessons, setLessons] = useState<LessonSummary[]>();
  const [glossary, setGlossary] = useState<Glossary>({});
  const [place, setPlace] = useState(readHash);
  const [lesson, setLesson] = useState<Lesson>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    Promise.all([api.lessons(), api.glossary()])
      .then(([l, g]) => {
        setLessons(l);
        setGlossary(g);
      })
      .catch((e: unknown) => setError(String(e)));
    const onHash = () => setPlace(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const atCaptures = place.lesson === CAPTURES;
  const atHome = place.lesson === undefined || place.lesson === HOME;
  const lessonId = atCaptures || atHome ? undefined : place.lesson;
  useEffect(() => {
    if (!lessonId) return;
    setLesson(undefined);
    api
      .lesson(lessonId)
      .then(setLesson)
      .catch((e: unknown) => setError(String(e)));
  }, [lessonId]);

  const go = (nextLesson: string, nextScene?: string) => {
    window.location.hash = nextScene ? `${nextLesson}/${nextScene}` : nextLesson;
    setPlace({ lesson: nextLesson, ...(nextScene ? { scene: nextScene } : {}) });
  };

  if (error) return <main className="page">Could not load the lesson: {error}</main>;
  if (!lessons) return <main className="page">Loading…</main>;
  // Plain fragment links: the hashchange listener above turns them into navigation.
  const nav = (
    <nav className="lessons" aria-label="Lessons">
      <a href={`#${HOME}`} className={`site${atHome ? " current" : ""}`}>
        One frame at a time
      </a>
      {lessons.map((l) => (
        <a
          key={l.id}
          href={`#${l.id}`}
          className={!atCaptures && l.id === lessonId ? "current" : ""}
        >
          {l.title}
        </a>
      ))}
    </nav>
  );
  if (atHome) {
    return (
      <div className="page">
        {nav}
        <Home lessons={lessons} glossary={glossary} onStart={(id) => go(id)} />
      </div>
    );
  }
  if (atCaptures) {
    return (
      <div className="page">
        {nav}
        <Captures glossary={glossary} />
      </div>
    );
  }
  if (!lesson) return <main className="page">Loading…</main>;
  const sceneIndex = Math.max(
    0,
    lesson.scenes.findIndex((s) => s.id === place.scene),
  );
  const scene = lesson.scenes[sceneIndex];
  if (!scene) return <main className="page">This lesson has no scenes yet.</main>;
  const nextScene = lesson.scenes[sceneIndex + 1];
  const nextLesson = lessons[lessons.findIndex((l) => l.id === lesson.id) + 1];
  const following = nextScene
    ? { label: `Next scene: ${nextScene.title}`, hash: `#${lesson.id}/${nextScene.id}` }
    : nextLesson
      ? { label: `Next lesson: ${nextLesson.title}`, hash: `#${nextLesson.id}` }
      : { label: "One more thing", hash: `#${CAPTURES}` };

  return (
    <div className="page">
      {nav}
      <header className="masthead">
        <h1>{lesson.title}</h1>
        <p className="summary">{lesson.summary}</p>
        {lesson.scenes.length > 1 && (
          <p className="scenes">
            {lesson.scenes.map((s, i) => (
              <button
                type="button"
                key={s.id}
                className={i === sceneIndex ? "current" : ""}
                onClick={() => go(lesson.id, s.id)}
              >
                Scene {i + 1}: {s.title}
              </button>
            ))}
          </p>
        )}
      </header>
      <SceneView
        key={`${lesson.id}/${scene.id}`}
        lesson={lesson}
        scene={scene}
        glossary={glossary}
        following={following}
      />
    </div>
  );
}

interface SceneViewProps {
  lesson: Lesson;
  scene: SceneData;
  glossary: Glossary;
  /** Where the reader goes after the outro: the next scene, the next lesson, or the reveal. */
  following: { label: string; hash: string };
}

function SceneView({ lesson, scene, glossary, following }: SceneViewProps) {
  const [run, setRun] = useState<Run>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    api
      .run(scene.scenario)
      .then(setRun)
      .catch((e: unknown) => setError(String(e)));
  }, [scene]);
  if (error) return <p>Could not simulate this scene: {error}</p>;
  if (!run) return <p>Simulating…</p>;
  return (
    <Stepper
      show={lesson.show}
      narration={scene.narration}
      glossary={glossary}
      run={run}
      following={following}
    />
  );
}

interface StepperProps {
  show: Lesson["show"];
  narration: Record<string, string>;
  glossary: Glossary;
  run: Run;
  /** Where the reader goes after the outro: the next scene, the next lesson, or the reveal. */
  following: { label: string; hash: string };
}

function Stepper({ show, narration, glossary, run, following }: StepperProps) {
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

  const shown = Math.min(step, turns.length - 1);
  const arpTables = useMemo(
    () =>
      Object.fromEntries(
        run.network.nodes
          .filter((n) => n.kind !== "switch")
          .map((n) => [n.id, arpTableAt(run, turns, n.id, shown)]),
      ),
    [run, turns, shown],
  );
  const macTables = useMemo(
    () =>
      Object.fromEntries(
        run.network.nodes
          .filter((n) => n.kind === "switch")
          .map((n) => [n.id, macTableAt(turns, n.id, shown)]),
      ),
    [run, turns, shown],
  );

  const frameId = turn?.arrivals[0]?.frame ?? turn?.sent;
  const frame: FrameRecord | undefined = frameId ? run.frames[frameId] : undefined;
  const inFlight = (turn?.arrivals ?? []).flatMap((a) => {
    const f = run.frames[a.frame];
    return f
      ? [{ link: a.link, from: a.from, label: cableLabel(f), key: `${step}:${a.link}` }]
      : [];
  });

  // A `seq-N` slot speaks once, on step N. Then one slot per event kind in the turn, where a
  // node-specific slot wins over the plain one.
  const slots = atIntro
    ? ["intro"]
    : atOutro
      ? ["outro"]
      : [`seq-${step + 1}`, ...new Set(turn?.events.map((e) => e.kind))];
  const prose = slots.flatMap((slot) => {
    const specific = turn?.nodes
      .map((n) => narration[`${slot}@${n}`])
      .find((md) => md !== undefined);
    const md = specific ?? narration[slot];
    return md ? [{ slot, md }] : [];
  });

  return (
    <>
      <Scene
        network={run.network}
        show={show}
        arpTables={arpTables}
        macTables={macTables}
        activeNodes={turn?.nodes ?? []}
        activeRoute={routeUsedIn(turn)}
        inFlight={inFlight}
      />

      <section className="panel">
        <div className="narration">
          {prose.map(({ slot, md }) => (
            <Prose key={`${step}:${slot}`} markdown={md} glossary={glossary} />
          ))}
          {atOutro && (
            <div className="outro-actions">
              <a className="download" href={following.hash}>
                {following.label}
              </a>
            </div>
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
              <button
                type="button"
                className={playing ? "playing" : ""}
                onClick={() => setPlaying((p) => !p)}
                disabled={atOutro}
              >
                {playing ? "Pause" : "Play"}
                {playing && (
                  <svg className="play-ring" aria-hidden="true" key={step}>
                    <rect pathLength="100" style={{ animationDuration: `${PLAY_STEP_MS}ms` }} />
                  </svg>
                )}
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
    </>
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
