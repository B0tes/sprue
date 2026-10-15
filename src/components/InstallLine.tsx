"use client";

import { useEffect, useState } from "react";
import { Code } from "./Code";

/** The one-line install from the zip this site serves. Once the page has loaded it names the zip by the page's
 * own https address, so a preview names its own zip. A local http page keeps the production address. */
export function InstallLine({ site, label = "Terminal" }: { site: string; label?: string }) {
  const [origin, setOrigin] = useState(site);
  useEffect(() => {
    // The address the page came from (a preview serves its own zip), but never a local http one.
    if (window.location.protocol === "https:") setOrigin(window.location.origin);
  }, []);
  return (
    <Code
      label={label}
      code={`curl -fsSL ${origin}/anatomy-2.zip -o /tmp/anatomy-2.zip && unzip -oq /tmp/anatomy-2.zip -d ~/.claude/skills`}
    />
  );
}
