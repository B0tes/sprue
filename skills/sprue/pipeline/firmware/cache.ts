// What the firmware in the loop (fil.ts) runs on, fetched once into a cache and pinned: none of it is a dependency
// of the skill, and none of it is a fab's. Each piece is checked against the sha256 below every time it is used, so
// a changed upload, a tampered cache or a half-written download is refused, not run:
//   CircuitPython 10.3.1 for the Raspberry Pi Pico, the UF2 Adafruit publishes (a 10.4.0 alpha exists, so the version
//     is pinned, not "latest");
//   KMK, the keyboard firmware the generated code.py runs on, at one commit (its kmk/ folder, which is what goes onto
//     CIRCUITPY), fetched with git;
//   rp2040js 1.4.0, the RP2040 emulator, the npm package's tarball (it has no dependencies of its own);
//   the RP2040's boot ROM (revision B1), which rp2040js's own demo carries as a TypeScript file of hex words: it is
//     read as text and its words parsed, never imported or run.
// The cache is ~/.cache/sprue/firmware/ (or $XDG_CACHE_HOME/sprue, or $SPRUE_CACHE). With SPRUE_OFFLINE=1
// nothing is downloaded: what is not in the cache is reported missing, and the firmware layer stays unverified.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { gunzipSync } from "node:zlib";
import { guardNetwork } from "../pcb/order.ts";

export const PINNED = {
  circuitpython: {
    name: "CircuitPython 10.3.1 for the Raspberry Pi Pico",
    version: "10.3.1",
    url: "https://adafruit-circuit-python.s3.amazonaws.com/bin/raspberry_pi_pico/en_US/adafruit-circuitpython-raspberry_pi_pico-en_US-10.3.1.uf2",
    sha256: "1e3134de1f2ea2bd1d46019e90781fa5bd95ea518b6665717cb256a9327a563a",
  },
  kmk: {
    name: "KMK at commit 8afe569",
    repo: "https://github.com/KMKfw/kmk_firmware.git",
    commit: "8afe56905af4df3b9e4dcb0a21b670a1bd3aab18",
    /** treeDigest() of its kmk/ folder. */
    sha256: "eca0b4513552bdf2076cc57c893cd4c30ccbbdb71d15b9801fc7ff6acff84cbb",
  },
  rp2040js: {
    name: "rp2040js 1.4.0",
    version: "1.4.0",
    url: "https://registry.npmjs.org/rp2040js/-/rp2040js-1.4.0.tgz",
    sha256: "54796fe7607f61057465a4f38d144d357681bd7067d8191f25819d291f9d1b2c",
    /** treeDigest() of the files in it. */
    files: "cc0c82e2eee8668ea439ea84643aa5b24aa18239c66db864bd512326ad62a0ba",
  },
  bootrom: {
    name: "the RP2040 boot ROM B1, from rp2040js 1.4.0's demo",
    url: "https://raw.githubusercontent.com/wokwi/rp2040js/a304c7486f329dae64be5f65baf28795d62ceb95/demo/bootrom.ts",
    sha256: "99f8a1f813ce3aa9415884de3fb6c5b962d3c6fa0394b05413ad3c7b3c39ec62",
  },
} as const;

/** Where each piece is once it is cached and checked. */
export type Tools = { dir: string; uf2: string; kmk: string; rp2040js: string; bootrom: string };
export type ToolsRun = { ok: true; tools: Tools; fetched: string[] } | { ok: false; message: string };

export const cacheDir = () =>
  process.env.SPRUE_CACHE || join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "sprue");

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const host = (url: string) => new URL(url).host;

/** Every file under `dir`, as paths relative to it with "/", sorted. */
function walk(dir: string, base = dir): string[] {
  return readdirSync(dir).sort().flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p, base) : [relative(base, p).split("\\").join("/")];
  });
}

/** One sha256 for a folder: of each file's sha256 and path, a line each, in path order. It does not depend on how the
 * folder was fetched (a git checkout, a tarball), only on what is in it. */
export function treeDigest(dir: string): string {
  return sha256(walk(dir).map((f) => `${sha256(readFileSync(join(dir, f)))}  ${f}\n`).join(""));
}

/** The regular files in a tar archive (ustar, with pax path records), by path. */
export function untar(tar: Uint8Array): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const text = (a: number, n: number) => new TextDecoder().decode(tar.subarray(a, a + n)).split("\0")[0];
  let at = 0, longName: string | undefined;
  while (at + 512 <= tar.length && tar[at] !== 0) {
    const size = parseInt(text(at + 124, 12).trim() || "0", 8), type = String.fromCharCode(tar[at + 156] || 48);
    const prefix = text(at + 345, 155), name = longName ?? (prefix ? `${prefix}/${text(at, 100)}` : text(at, 100));
    const data = tar.subarray(at + 512, at + 512 + size);
    longName = undefined;
    if (type === "x") longName = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(new TextDecoder().decode(data))?.[1];
    else if (type === "0" || type === "7") files.set(name, data);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** Fills a fresh folder next to `dest` and, if `write` says it is good, moves it into place: a run that stops half
 * way, or a download that is not the one pinned, leaves no half-written cache behind. */
function install(dest: string, write: (tmp: string) => boolean) {
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = mkdtempSync(`${dest}.part-`);
  try {
    if (!write(tmp)) return;
    rmSync(dest, { recursive: true, force: true });
    renameSync(tmp, dest);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function download(url: string): Promise<Uint8Array> {
  guardNetwork();
  const r = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`${host(url)} answered ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

/** Why a fetch failed, in a few words: the network's own error when there is one ("getaddrinfo ENOTFOUND ..."). */
const why = (error: unknown) => (error instanceof Error ? ((error.cause as Error | undefined)?.message ?? error.message) : String(error));

/** A message for a download that failed: what, from where and why, and what to do. */
const unreachable = (what: string, where: string, why: string) =>
  `${what} is not in the cache and could not be fetched from ${where} (${why}): connect to the internet once and run it again; it is kept in ${cacheDir()}/firmware`;

/** The pinned pieces, from the cache, fetching what is missing or does not match its pin. */
export async function ensureTools({ offline = process.env.SPRUE_OFFLINE === "1" } = {}): Promise<ToolsRun> {
  const dir = join(cacheDir(), "firmware");
  const tools: Tools = {
    dir, uf2: join(dir, `circuitpython-${PINNED.circuitpython.version}-raspberry_pi_pico.uf2`),
    kmk: join(dir, `kmk-${PINNED.kmk.commit.slice(0, 7)}`, "kmk"), rp2040js: join(dir, `rp2040js-${PINNED.rp2040js.version}`),
    bootrom: join(dir, "rp2040-bootrom-b1.ts"),
  };
  const fetched: string[] = [];
  const offlineMessage = (what: string) =>
    `${what} is not in the cache (${dir}) and SPRUE_OFFLINE=1 says not to fetch it: run once without it, online`;

  // The two single files: kept as downloaded, checked by their sha256.
  for (const [path, pin] of [[tools.uf2, PINNED.circuitpython], [tools.bootrom, PINNED.bootrom]] as const) {
    if (existsSync(path) && sha256(readFileSync(path)) === pin.sha256) continue;
    if (offline) return { ok: false, message: offlineMessage(pin.name) };
    let data: Uint8Array;
    try {
      data = await download(pin.url);
    } catch (error) {
      return { ok: false, message: unreachable(pin.name, host(pin.url), why(error)) };
    }
    if (sha256(data) !== pin.sha256)
      return { ok: false, message: `${pin.name} from ${host(pin.url)} is not the file pinned (sha256 ${sha256(data).slice(0, 12)}, pinned ${pin.sha256.slice(0, 12)}), so it is not used: report it` };
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${path}.part`, data);
    renameSync(`${path}.part`, path);
    fetched.push(pin.name);
  }

  // rp2040js: the tarball is checked by its sha256 when it is fetched, and the files unpacked from it by their digest
  // every time.
  const rp = PINNED.rp2040js;
  if (!existsSync(tools.rp2040js) || treeDigest(tools.rp2040js) !== rp.files) {
    if (offline) return { ok: false, message: offlineMessage(rp.name) };
    let tgz: Uint8Array;
    try {
      tgz = await download(rp.url);
    } catch (error) {
      return { ok: false, message: unreachable(rp.name, host(rp.url), why(error)) };
    }
    if (sha256(tgz) !== rp.sha256)
      return { ok: false, message: `${rp.name} from ${host(rp.url)} is not the tarball pinned (sha256 ${sha256(tgz).slice(0, 12)}, pinned ${rp.sha256.slice(0, 12)}), so it is not used: report it` };
    let got = "";
    install(tools.rp2040js, (tmp) => {
      for (const [name, data] of untar(gunzipSync(tgz))) {
        if (!name.startsWith("package/") || name.split("/").includes("..")) continue;
        mkdirSync(dirname(join(tmp, name.slice(8))), { recursive: true });
        writeFileSync(join(tmp, name.slice(8)), data);
      }
      got = treeDigest(tmp);
      return got === rp.files;
    });
    if (got !== rp.files)
      return { ok: false, message: `${rp.name}'s files, unpacked, are not the ones pinned (digest ${got.slice(0, 12)}, pinned ${rp.files.slice(0, 12) || "none"}), so they are not used: report it` };
    fetched.push(rp.name);
  }

  // KMK: one commit, fetched by its hash with git, and its kmk/ folder held to the digest pinned.
  const kmk = PINNED.kmk;
  if (!existsSync(tools.kmk) || treeDigest(tools.kmk) !== kmk.sha256) {
    if (offline) return { ok: false, message: offlineMessage(kmk.name) };
    // git that is there but does not run (macOS's /usr/bin/git without the Command Line Tools) is not a network
    // failure: say so before fetching.
    const there = spawnSync("git", ["--version"], { encoding: "utf8", timeout: 60_000 });
    if (there.error) return { ok: false, message: `${kmk.name} is not in the cache, and git, which fetches it, is not installed: install git and run it again` };
    if (there.status !== 0)
      return { ok: false, message: `${kmk.name} is not in the cache, and git, which fetches it, does not run (${(there.stderr || "").trim().split("\n")[0] || `exit status ${there.status}`}): on macOS, install the Command Line Tools (xcode-select --install), then run it again` };
    mkdirSync(dir, { recursive: true });
    const tmp = mkdtempSync(join(dir, "kmk-git-"));
    try {
      const git = (...args: string[]) => spawnSync("git", ["-C", tmp, ...args], { encoding: "utf8", timeout: 180_000 });
      const steps = [["init", "-q"], ["fetch", "-q", "--depth", "1", kmk.repo, kmk.commit], ["-c", "advice.detachedHead=false", "-c", "core.autocrlf=false", "checkout", "-q", "FETCH_HEAD"]];
      for (const s of steps) {
        const r = git(...s);
        if (r.error) return { ok: false, message: `${kmk.name} is not in the cache, and git, which fetches it, is not installed: install git and run it again` };
        if (r.status !== 0) return { ok: false, message: unreachable(kmk.name, host(kmk.repo), (r.stderr || "").trim().split("\n").at(-1) || `git ${s[0]} failed`) };
      }
      const head = git("rev-parse", "HEAD").stdout.trim();
      if (head !== kmk.commit) return { ok: false, message: `git fetched ${head.slice(0, 7)} for ${kmk.name}, so it is not used: report it` };
      const got = treeDigest(join(tmp, "kmk"));
      if (got !== kmk.sha256) return { ok: false, message: `${kmk.name}'s kmk folder is not the one pinned (digest ${got.slice(0, 12)}, pinned ${kmk.sha256.slice(0, 12) || "none"}), so it is not used: report it` };
      install(dirname(tools.kmk), (dest) => {
        renameSync(join(tmp, "kmk"), join(dest, "kmk"));
        return true;
      });
      fetched.push(kmk.name);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  return { ok: true, tools, fetched };
}
