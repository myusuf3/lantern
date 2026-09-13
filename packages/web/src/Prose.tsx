import { useState } from "react";
import type { Glossary } from "./api.js";
import { parseProse } from "./markdown.js";

interface ProseProps {
  markdown: string;
  glossary: Glossary;
}

/** Narration paragraphs. Marked terms are buttons; clicking one opens its definition beneath it. */
export function Prose({ markdown, glossary }: ProseProps) {
  const [open, setOpen] = useState<string | undefined>();
  // Keys are character offsets into the markdown: stable, unique, and not array indexes.
  let offset = 0;
  return (
    <div className="prose">
      {parseProse(markdown).map((paragraph) => (
        <p key={`p${offset}`}>
          {paragraph.map((token) => {
            const key = `t${offset}`;
            offset += "code" in token ? token.code.length + 2 : token.text.length;
            if ("code" in token) return <code key={key}>{token.code}</code>;
            if (!("term" in token)) return <span key={key}>{token.text}</span>;
            const entry = glossary[token.term];
            if (!entry) return <span key={key}>{token.text}</span>;
            const isOpen = open === key;
            return (
              <span key={key} className="term-wrap">
                <button
                  type="button"
                  className={`term${isOpen ? " term-open" : ""}`}
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? undefined : key)}
                >
                  {token.text}
                </button>
                {isOpen && (
                  <span role="dialog" aria-label={entry.title} className="term-pop">
                    <strong>{entry.title}</strong>
                    <span>{entry.body}</span>
                  </span>
                )}
              </span>
            );
          })}
        </p>
      ))}
    </div>
  );
}
