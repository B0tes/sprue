"use client";

import { useEffect, useState } from "react";

export type LegendItem = { id: string; n?: string; title: string };

/** A section is the current one once its top passes this far down the window. */
const LINE = 0.35;

/** The section index in the left margin on a wide screen, like a book's running contents: real #anchors (so it works
 * before and without the script), with the section you are reading marked. The page makes room for it beside the
 * worked example (globals.css, .legend-rail), so it stays in view the whole way down. Below the rail's width the page
 * shows its inline Contents list instead. */
export function Legend({ items, label = "Contents" }: { items: LegendItem[]; label?: string }) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const sections = items.map((x) => document.getElementById(x.id)).filter((s): s is HTMLElement => s !== null);
    if (!sections.length) return;
    const atEnd = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;

    // The current section: the last one whose top is above the line; the last of all at the very bottom of the page.
    const pick = () => {
      if (atEnd()) return setActive(sections[sections.length - 1].id);
      const line = window.innerHeight * LINE;
      let id: string | null = null;
      for (const s of sections) if (s.getBoundingClientRect().top <= line) id = s.id;
      setActive(id);
    };
    // Checked on every frame the page scrolls or resizes (nine rects, at most once a frame), and when the page's
    // height changes under a still reader (the worked example mounting). An IntersectionObserver band misses a
    // section top that drifts across the line while the section is already in the band, as slow trackpad scrolls do.
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        pick();
      });
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(document.body);
    pick();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [items]);

  return (
    <nav className="legend" aria-label={label}>
      <p className="legend-h" aria-hidden="true">
        {label}
      </p>
      <ol>
        {items.map((x) => (
          <li key={x.id}>
            <a href={`#${x.id}`} aria-current={active === x.id ? "location" : undefined} onClick={() => setActive(x.id)}>
              <span className="legend-n" aria-hidden={x.n ? undefined : "true"}>
                {x.n ?? ""}
              </span>
              <span>{x.title}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
