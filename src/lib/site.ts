/** Where the site is served. On Vercel the production domain comes from the build; set NEXT_PUBLIC_SITE_URL
 * to override. Used for share cards and as the first guess for the install line (which then uses the
 * address the page was actually loaded from). */
export const SITE =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://anatomy-2.vercel.app");

/** The GitHub repo is public with the skill on main (since 2026-10-15), so the page leads with
 * `npx skills add <REPO> -g` and shows the GitHub links. Set to false to lead with
 * `curl -fsSL <site>/install | sh` (src/app/install/route.ts) instead, which fetches the zip this site serves. */
export const REPO_PUBLIC = true;

/** owner/name on GitHub. It was B0tes/anatomy-2 until 2026-10-15; GitHub redirects the old name. */
export const REPO = "B0tes/sprue";
export const GITHUB = `https://github.com/${REPO}`;
/** The one-line installs, by where the skill comes from. */
export const NPX_INSTALL = `npx skills add ${REPO} -g`;
export const installLine = (origin: string) => `curl -fsSL ${origin}/install | sh`;
export const ANATOMY = "https://skills.wheresryan.sh/anatomy";
export const BUILD123D = "https://github.com/gumyr/build123d";

export const TITLE = "Sprue: from idea to buildable product";
export const DESCRIPTION =
  "A Claude Code skill that takes a one-line hardware idea to a design, CAD, an interactive drawing, a bill of materials, engineer checks, offers from real suppliers, a quote with shipping and a build plan, with a yes from you after each stage.";
