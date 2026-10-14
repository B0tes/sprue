import { SITE } from "@/lib/site";

// `curl -fsSL <site>/install | sh`: the one-line install while the repo is private. It fetches the zip this site
// serves (built from skills/distinta/ before each build) and puts it in ~/.claude/skills/distinta, replacing an
// older copy so files dropped upstream go too. It names the zip on the address it was fetched from, so a preview's
// script installs that preview's skill; DISTINTA_SITE overrides it.
const script = (site: string) => `#!/bin/sh
# Installs Distinta, a Claude Code skill for hardware, into ~/.claude/skills/distinta.
# Run it again to update.
set -eu
site="\${DISTINTA_SITE:-${site}}"
skills="\${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
for tool in curl unzip; do
  command -v "$tool" >/dev/null 2>&1 || { echo "distinta: this needs $tool" >&2; exit 1; }
done
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$site/distinta.zip" -o "$tmp/distinta.zip"
unzip -q "$tmp/distinta.zip" -d "$tmp"
mkdir -p "$skills"
rm -rf "$skills/distinta"
mv "$tmp/distinta" "$skills/distinta"
if ! command -v node >/dev/null 2>&1; then
  echo "distinta: installed, but it needs Node 22.6 or newer and node is not on your PATH" >&2
elif ! node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 6) ? 0 : 1)'; then
  echo "distinta: installed, but it needs Node 22.6 or newer (you have $(node -v))" >&2
fi
echo "Installed Distinta in $skills/distinta. Restart Claude Code, then type /distinta and describe a product."
`;

export function GET(request: Request) {
  // Behind Vercel the request URL carries the public https host; a local dev server names the production site.
  const url = new URL(request.url);
  const site = url.protocol === "https:" ? url.origin : SITE;
  return new Response(script(site), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" } });
}
