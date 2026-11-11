// Where a person who built one of Sprue's worked examples tells how it went: a build report, an issue form on Sprue's
// own GitHub repo (.github/ISSUE_TEMPLATE/build-report.yml), the gallery's first step (research/gallery.md, 3.1). The
// form lives on GitHub, so GitHub holds the accounts, the moderation and the files; Sprue only links to it, from the
// product page and the site, for a product that is one of its examples or a copy of one (`/sprue example`).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Sprue's repository, where the build-report form is. */
export const REPO = "https://github.com/B0tes/sprue";
/** The form's file in .github/ISSUE_TEMPLATE/, as GitHub's `template=` names it. */
export const REPORT_FORM = "build-report.yml";

const EXAMPLES = join(import.meta.dirname, "..", "examples");

/** The skill's example this product is, or a copy of (`cp -R` of examples/<slug>, which `/sprue example` makes): the
 * same slug and the same brief in request.json. A product of the person's own is none, even with an example's name. */
export function exampleOf(dir: string, slug: string, examples = EXAMPLES): string | undefined {
  if (!/^[\w-]+$/.test(slug)) return undefined;
  const brief = (path: string): string | undefined => {
    try {
      const r = JSON.parse(readFileSync(path, "utf8")) as { brief?: unknown };
      return typeof r?.brief === "string" ? r.brief : undefined;
    } catch {
      return undefined;
    }
  };
  const theirs = join(examples, slug, "request.json");
  if (!existsSync(theirs)) return undefined;
  const a = brief(join(dir, "request.json")), b = brief(theirs);
  return a !== undefined && a === b ? slug : undefined;
}

/** The build-report form, with the product filled in. */
export const reportUrl = (example: string) =>
  `${REPO}/issues/new?template=${REPORT_FORM}&product=${encodeURIComponent(example)}`;

/** What the product page and the site may link to: the form, on Sprue's repo, and nothing else. */
export const isReportUrl = (url: unknown): url is string =>
  typeof url === "string" && url.startsWith(`${REPO}/issues/new?template=${REPORT_FORM}&product=`) && /^[\w:/.?=&%-]+$/.test(url);
