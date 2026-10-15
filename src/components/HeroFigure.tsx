"use client";

import { useEffect, useRef } from "react";

/** The worked example's figure, still, for the top of the page: the same figure.svg the live card loads (so the
 * browser fetches it once), cropped to the drawing. Its clip path ids get a prefix, so they never clash with the
 * live card's copy further down. */
export function HeroFigure({ src, viewBox, width, height, label }: { src: string; viewBox: string; width: number; height: number; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    fetch(src)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((svg) => {
        if (!alive || !ref.current) return;
        ref.current.innerHTML = svg
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/\son\w+="[^"]*"/gi, "")
          .replace(/\s(?:xlink:)?href="[^"]*"/gi, "")
          .replace(/\sid="([^"]+)"/g, ' id="hero-$1"')
          .replace(/url\(#([^)]+)\)/g, "url(#hero-$1)")
          .replace(/viewBox="[^"]*"/, `viewBox="${viewBox}"`)
          .replace(/\srole="img"/, "")
          .replace(/\saria-label="[^"]*"/, ' aria-hidden="true" focusable="false"');
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [src, viewBox]);
  return <div ref={ref} className="fig-art" role="img" aria-label={label} style={{ aspectRatio: `${width} / ${height}` }} />;
}
