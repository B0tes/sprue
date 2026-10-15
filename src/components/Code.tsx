import { CopyButton } from "./CopyButton";

/** Each word of a command in its own box, so a narrow screen breaks the line between words, never after the
 * hyphen in "-oq" or "sprue". A word longer than the line still breaks inside itself. */
function words(text: string) {
  return text.split(/( +|\n)/).map((w, i) => (w.trim() ? <span key={i} className="tok">{w}</span> : w));
}

/** A code block with a label and a copy button. The copy button copies every line, so a block holds only
 * commands meant to run together. Commands wrap on narrow screens instead of hiding off the edge; output
 * keeps its columns and scrolls, with a shadow at the edge that has more. */
export function Code({ label, code, output = false }: { label: string; code: string; output?: boolean }) {
  const text = code.replace(/^\n+|\n+$/g, "");
  return (
    <figure className={output ? "code code-out" : "code"}>
      <figcaption className="code-bar">
        <span>{label}</span>
        {!output && <CopyButton text={text} what={`${label.toLowerCase()} commands`} />}
      </figcaption>
      <div className="code-scroll" tabIndex={output ? 0 : undefined}>
        <pre>
          <code>{output ? text : words(text)}</code>
        </pre>
      </div>
    </figure>
  );
}

/** Prompts to type into Claude Code, one per row, each with its own copy button. */
export function Prompts({ items }: { items: { prompt: string; note?: string }[] }) {
  return (
    <ul className="prompts">
      {items.map(({ prompt, note }) => (
        <li key={prompt}>
          <div>
            <code>{prompt}</code>
            {note && <span className="prompt-note">{note}</span>}
          </div>
          <CopyButton text={prompt} what={`“${prompt}”`} />
        </li>
      ))}
    </ul>
  );
}
