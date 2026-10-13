"use client";

import { useEffect, useRef, useState } from "react";
import { mount } from "../../skills/anatomy-2/viewer/explorer.js";
import "../../skills/anatomy-2/viewer/explorer.css";
import type { Explorer as ExplorerData } from "../../skills/anatomy-2/pipeline/explore.ts";

/** The skill's own explorer (viewer/explorer.js), the same renderer as the page `anatomy view` writes.
 * Colours and fonts come from the site's tokens through the --ax-* variables on .example. */
export function Explorer({ data, initialTab = "bom" }: { data: ExplorerData; initialTab?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const view = mount(el, data, { initialTab, compact: true, headingLevel: 3 });
    setReady(true);
    return () => view.destroy();
  }, [data, initialTab]);

  return (
    <div className="example-frame">
      {!ready && (
        <p className="example-loading" role="status">
          Loading the example run…
        </p>
      )}
      <noscript>
        <p className="example-loading">The example needs JavaScript. The same page opens offline with /anatomy-2 view.</p>
      </noscript>
      <div ref={ref} />
    </div>
  );
}
