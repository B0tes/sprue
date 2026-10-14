import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Our emblem: an isometric soldering iron a hair above a pin on a circuit board, drawn with the kit's iso-* classes in
 * src/components/emblem.svg. It is read when the page is built and inlined, so the page's --anatomy-* colours theme it
 * (the .emblem rule in globals.css) in light and dark. Its ids get a prefix, so the two copies on the page don't clash. */
const FILE = join(process.cwd(), "src", "components", "emblem.svg");

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (all, hex?: string, dec?: string, name?: string) =>
    hex ? String.fromCodePoint(parseInt(hex, 16)) : dec ? String.fromCodePoint(Number(dec)) : (ENTITIES[name!.toLowerCase()] ?? all),
  );

/** At-rules that can't sit inside a style rule: @keyframes and @property are lifted out (they are global, and both
 * copies define the same ones); @font-face is dropped, since the emblem loads nothing. */
function splitAtRules(css: string): { lifted: string; rest: string } {
  let lifted = "";
  let rest = "";
  let i = 0;
  const at = /@(-webkit-keyframes|keyframes|property|font-face)\b/gi;
  for (let m = at.exec(css); m; m = at.exec(css)) {
    const open = css.indexOf("{", m.index);
    if (open < 0) break;
    let depth = 0;
    let end = open;
    for (; end < css.length; end++) {
      if (css[end] === "{") depth++;
      else if (css[end] === "}" && --depth === 0) break;
    }
    rest += css.slice(i, m.index);
    if (m[1].toLowerCase() !== "font-face") lifted += css.slice(m.index, end + 1);
    i = end + 1;
    at.lastIndex = i;
  }
  return { lifted, rest: rest + css.slice(i) };
}

/** The drawing's own <style>, kept but held to this copy: every rule is nested under the copy's wrapper, so nothing in
 * it can restyle the rest of the page (the hero figure uses the same iso-* classes). */
function scopeStyle(body: string, scope: string): string {
  const css = decode(body.replace(/<!\[CDATA\[|\]\]>/g, ""))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@(?:import|namespace|charset)\b[^;]*;?/gi, "");
  const { lifted, rest } = splitAtRules(css);
  const out = `${lifted}${scope}{${rest}}`;
  return `<style>${out.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</style>`;
}

/** The SVG with nothing that runs, nothing that loads and nothing that takes focus, its ids prefixed, its own styles
 * scoped to it, and hidden from assistive tech (the emblem is decoration; a caption, when there is one, says what it
 * shows). */
function clean(raw: string, prefix: string): string | undefined {
  const start = raw.search(/<svg\b/i);
  const end = raw.toLowerCase().lastIndexOf("</svg>");
  if (start < 0 || end < start) return undefined;
  const ref = (id: string) => `${prefix}-${id}`;
  const styles: string[] = [];
  return (
    raw
      .slice(start, end + "</svg>".length)
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(script|foreignObject|title|desc)\b[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<(script|style|foreignObject)\b[^>]*\/>/gi, "")
      // Set the styles aside (as placeholders) while the markup is cleaned; they are scoped and put back at the end.
      .replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_, body: string) => `\u0000style${styles.push(body) - 1}\u0000`)
      .replace(/<(?:set|animate)\b[^>]*attributeName\s*=\s*["'](?:xlink:)?href["'][^>]*>/gi, "")
      .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/\stabindex\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      // Only references inside the drawing survive; anything that would load or link elsewhere goes.
      .replace(/\s(?:xlink:)?href\s*=\s*(["'])(?!#)[^"']*\1/gi, "")
      .replace(/url\(\s*(?!["']?#)[^)]*\)/gi, "none")
      .replace(/\sid\s*=\s*(["'])([^"']+)\1/g, (_, q: string, id: string) => ` id=${q}${ref(id)}${q}`)
      .replace(/(\s(?:xlink:)?href\s*=\s*["'])#([^"']+)(["'])/g, (_, a: string, id: string, q: string) => `${a}#${ref(id)}${q}`)
      .replace(/url\(\s*(["']?)#([^)"'\s]+)\1\s*\)/g, (_, q: string, id: string) => `url(${q}#${ref(id)}${q})`)
      .replace(/<svg\b([^>]*)>/i, (_, attrs: string) => {
        // The kit's own .iso class and data-theme would set its palette on the svg itself, over the page's.
        const kept = attrs
          .replace(/\s(?:role|aria-[a-z]+|width|height|focusable|data-theme)\s*=\s*(?:"[^"]*"|'[^']*')/gi, "")
          .replace(/(\sclass\s*=\s*["'])([^"']*)/i, (_, a: string, c: string) => a + c.split(/\s+/).filter((t) => t && t !== "iso").join(" "));
        return `<svg${kept} aria-hidden="true" focusable="false">`;
      })
      .replace(/\u0000style(\d+)\u0000/g, (_, n: string) => {
        // The same cleaning for what the styles load and point at: nothing outside, and this copy's ids.
        const body = styles[Number(n)]
          .replace(/url\(\s*(?!["']?#)[^)]*\)/gi, "none")
          .replace(/url\(\s*(["']?)#([^)"'\s]+)\1\s*\)/g, (_, q: string, id: string) => `url(${q}#${ref(id)}${q})`);
        return scopeStyle(body, `[data-emblem="${prefix}"]`);
      })
  );
}

function load(prefix: string): string | undefined {
  try {
    return clean(readFileSync(FILE, "utf8"), prefix);
  } catch {
    return undefined;
  }
}

/** The emblem, or nothing when the file isn't there. `id` prefixes its ids and must differ per copy. */
export function Emblem({ id, className, caption }: { id: string; className?: string; caption?: string }) {
  const svg = load(id);
  if (!svg) return null;
  const art = <div className="emblem-art" data-emblem={id} aria-hidden="true" inert dangerouslySetInnerHTML={{ __html: svg }} />;
  const cls = className ? `emblem ${className}` : "emblem";
  if (!caption)
    return (
      <div className={cls} aria-hidden="true">
        {art}
      </div>
    );
  return (
    <figure className={cls}>
      {art}
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
