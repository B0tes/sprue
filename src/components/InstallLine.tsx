"use client";

import { useEffect, useState } from "react";
import { Code } from "./Code";

/** The one-line install from the zip this site serves. It names the zip by this page's own address once
 * the page has loaded, so the line is right wherever the site is hosted (a preview, localhost, the real domain). */
export function InstallLine({ site, label = "Terminal" }: { site: string; label?: string }) {
  const [origin, setOrigin] = useState(site);
  useEffect(() => {
    if (/^https?:\/\//.test(window.location.origin)) setOrigin(window.location.origin);
  }, []);
  return (
    <Code
      label={label}
      code={`curl -fsSL ${origin}/anatomy-2.zip -o /tmp/anatomy-2.zip && unzip -oq /tmp/anatomy-2.zip -d ~/.claude/skills`}
    />
  );
}
