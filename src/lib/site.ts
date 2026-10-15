/** Where the site is served. On Vercel the production domain comes from the build; set NEXT_PUBLIC_SITE_URL
 * to override. Used for share cards and as the first guess for the install line (which then uses the
 * address the page was actually loaded from). */
export const SITE =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://anatomy-2.vercel.app");

/** The GitHub repo is private, and the skill isn't on main yet, so `npx skills add` and the GitHub links
 * only work for Tobias. Set this to true once the repo is public with the skill on main: the page then
 * leads with `npx skills add B0tes/anatomy-2 -g` and shows the GitHub links. */
export const REPO_PUBLIC = false;

export const GITHUB = "https://github.com/B0tes/anatomy-2";
export const ANATOMY = "https://skills.wheresryan.sh/anatomy";
export const BUILD123D = "https://github.com/gumyr/build123d";

export const TITLE = "Anatomy 2.0: from idea to buildable product";
export const DESCRIPTION =
  "A Claude Code skill that takes a one-line hardware idea to a design, CAD, an interactive drawing, a bill of materials, engineer checks, offers from real suppliers, a quote with shipping and a build plan, with a yes from you after each stage.";
