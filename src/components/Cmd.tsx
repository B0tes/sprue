import { Fragment } from "react";

/** A command in running text or a table: it breaks between words only, never at a hyphen ("-oq",
 * "anatomy-2") or inside a path. The spaces sit between the no-wrap words, so the line can break there. */
export function Cmd({ children }: { children: string }) {
  const words = children.split(" ");
  return (
    <code className="cmd-text">
      {words.map((w, i) => (
        <Fragment key={i}>
          {i > 0 && " "}
          <span className="nw">{w}</span>
        </Fragment>
      ))}
    </code>
  );
}
