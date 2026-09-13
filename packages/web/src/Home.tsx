import { useEffect, useState } from "react";
import { api, type Glossary, type LessonSummary } from "./api.js";
import { Prose } from "./Prose.js";

interface HomeProps {
  lessons: LessonSummary[];
  glossary: Glossary;
  onStart: (lessonId: string) => void;
}

/** Opacities for the blurred last step of the path, which is revealed at the end. */
const BLUR = [0.5, 0, 0.3, 0.2, 0.9, 1, 0, 0.05, 0, 0.1, 0, 0.6, 0.15, 0.4].map((opacity, i) => ({
  id: `cell-${i}`,
  opacity,
}));

/** The landing page: what this site is, and the path through it. */
export function Home({ lessons, glossary, onStart }: HomeProps) {
  const [markdown, setMarkdown] = useState<string>();
  useEffect(() => {
    api
      .home()
      .then((h) => setMarkdown(h.markdown))
      .catch(() => setMarkdown(""));
  }, []);
  const first = lessons[0];
  return (
    <div className="home">
      <img
        className="hero"
        src="/oneframe.jpg"
        alt="One frame at a time: a laptop and a server joined by a cable"
      />
      <h1 className="home-title">One frame at a time</h1>
      <p className="home-kicker">How packets move through a network, watched one step at a time.</p>
      {markdown !== undefined && <Prose markdown={markdown} glossary={glossary} />}
      <ol className="path">
        {lessons.map((l) => (
          <li key={l.id}>
            <a href={`#${l.id}`}>
              <span className="path-title">{l.title}</span>
              <span className="path-summary">{l.summary}</span>
            </a>
          </li>
        ))}
        <li aria-hidden="true" className="path-hidden">
          <span className="path-blur">
            {BLUR.map((cell) => (
              <i key={cell.id} style={{ opacity: cell.opacity }} />
            ))}
          </span>
        </li>
      </ol>
      {first && (
        <button type="button" className="primary start" onClick={() => onStart(first.id)}>
          Start with lesson 1
        </button>
      )}
    </div>
  );
}
