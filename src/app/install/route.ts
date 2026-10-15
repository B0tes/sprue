import { SITE } from "@/lib/site";

// `curl -fsSL <site>/install | sh`: the one-line install while the repo is private. It fetches the zip this site
// serves (built from skills/sprue/ before each build) and puts it in ~/.claude/skills/sprue, replacing an
// older copy so files dropped upstream go too, and removes the copy an installer before the rename put in
// ~/.claude/skills/distinta. It names the zip on the address it was fetched from, so a preview's
// script installs that preview's skill; SPRUE_SITE overrides it.
const script = (site: string) => `#!/bin/sh
# Installs Sprue, a Claude Code skill for hardware, into ~/.claude/skills/sprue.
# Run it again to update.
set -eu
site="\${SPRUE_SITE:-${site}}"
skills="\${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
for tool in curl unzip; do
  command -v "$tool" >/dev/null 2>&1 || { echo "sprue: this needs $tool" >&2; exit 1; }
done
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$site/sprue.zip" -o "$tmp/sprue.zip"
unzip -q "$tmp/sprue.zip" -d "$tmp"
mkdir -p "$skills"
rm -rf "$skills/sprue"
mv "$tmp/sprue" "$skills/sprue"
# Sprue was called Distinta, and the installer then put it in $skills/distinta: that copy would still answer
# /distinta, with the old checks.
if grep -q '^name: distinta$' "$skills/distinta/SKILL.md" 2>/dev/null; then
  rm -rf "$skills/distinta"
  echo "sprue: removed $skills/distinta, Sprue's old copy under its old name"
fi
if ! command -v node >/dev/null 2>&1; then
  echo "sprue: installed, but it needs Node 22.15 or newer and node is not on your PATH" >&2
elif ! node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 15) ? 0 : 1)'; then
  echo "sprue: installed, but it needs Node 22.15 or newer (you have $(node -v))" >&2
fi
echo "Installed Sprue in $skills/sprue. Restart Claude Code, then type /sprue and describe a product."
`;

export function GET(request: Request) {
  // Behind Vercel the request URL carries the public https host; a local dev server names the production site.
  const url = new URL(request.url);
  const site = url.protocol === "https:" ? url.origin : SITE;
  return new Response(script(site), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" } });
}
