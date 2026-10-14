"use client";

import { useEffect, useState } from "react";
import { Code } from "./Code";
import { installLine } from "@/lib/site";

/** The one-line install from this site: `curl -fsSL <site>/install | sh` fetches the zip it serves. Once the page has
 * loaded it names the page's own https address, so a preview's line runs its own script. A local http page keeps the
 * production address. */
export function InstallLine({ site, label = "Terminal" }: { site: string; label?: string }) {
  const [origin, setOrigin] = useState(site);
  useEffect(() => {
    // The address the page came from (a preview serves its own zip), but never a local http one.
    if (window.location.protocol === "https:") setOrigin(window.location.origin);
  }, []);
  return (
    <Code
      label={label}
      code={installLine(origin)}
    />
  );
}
