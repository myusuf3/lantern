import { useEffect, useState } from "react";
import { api, type CapturesPage, type Glossary } from "./api.js";
import { Prose } from "./Prose.js";

const TOOLS = [
  {
    name: "Wireview, in your browser",
    href: "https://wireview.github.io/",
    note: "Wireshark's own dissectors compiled to WebAssembly. Nothing is uploaded; drop the file on the page.",
  },
  {
    name: "Wireshark, on your machine",
    href: "https://www.wireshark.org/",
    note: "The real thing. Open the file, then type `arp || icmp` in the filter bar.",
  },
];

/** The closing page: every scene's capture, and the ways to check them against real tools. */
export function Captures({ glossary }: { glossary: Glossary }) {
  const [page, setPage] = useState<CapturesPage>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    api
      .captures()
      .then(setPage)
      .catch((e: unknown) => setError(String(e)));
  }, []);
  if (error) return <p>Could not load the captures: {error}</p>;
  if (!page) return <p>Running every scene…</p>;
  return (
    <>
      <header className="masthead">
        <h1>The captures</h1>
      </header>
      <section className="captures">
        <Prose markdown={page.markdown} glossary={glossary} />
        <ul className="capture-list">
          {page.captures.map((c) => (
            <li
              key={`${c.lesson}/${c.scene}`}
              className="capture"
              aria-label={`capture: ${c.sceneTitle}`}
            >
              <div className="capture-head">
                <a href={`#${c.lesson}/${c.scene}`} className="capture-lesson">
                  {c.lessonTitle}
                </a>
                <span className="capture-scene">{c.sceneTitle}</span>
                <a
                  className="download"
                  href={api.pcapUrl(c.run)}
                  download={`lantern-${c.run}.pcap`}
                >
                  Download {c.frames.length} frames (.pcap)
                </a>
              </div>
              <ol className="frame-lines mono">
                {c.frames.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
        <h2>Check for yourself</h2>
        <ul className="tools">
          {TOOLS.map((t) => (
            <li key={t.href}>
              <a href={t.href} target="_blank" rel="noreferrer">
                {t.name}
              </a>
              <Prose markdown={t.note} glossary={glossary} />
            </li>
          ))}
          <li>
            <span className="tool-name">tshark, in a terminal</span>
            <pre className="mono">tshark -r lantern-{page.captures[0]?.run ?? "…"}.pcap</pre>
          </li>
        </ul>
      </section>
    </>
  );
}
