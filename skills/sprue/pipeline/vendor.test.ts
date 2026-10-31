// three.js as the 3D view will have it (viewer/vendor/three/, made by scripts/vendor-three.mjs in Sprue's repo): each
// file vendor.json lists is there at its hash and nothing else is, the modules import only each other, by the names
// package.json gives them, each after the ones it imports (V8 lists each module's imports), its MIT notice is kept, and
// its GLTFLoader reads each example's previews/system.glb as formats.md says it is: a node per item in mm under a root
// that makes metres with y up, positions and no normals, the board wearing its picture, and a scene for each pose that
// draws parts along its own paths (Ponder's arm pulled straight out, its head moved onto the arm's end). Run them with
//   node --test skills/sprue/pipeline/vendor.test.ts

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import type { SystemCheck } from "./types.ts";

const SKILL = join(import.meta.dirname, "..");
const THREE = join(SKILL, "viewer", "vendor", "three");
const EXAMPLES = join(SKILL, "examples");

type Listed = { file: string; name?: string; from: string; sourceSha256: string; imports?: string[]; bytes: number; sha256: string };
type Manifest = { package: { name: string; version: string; tarball: string; integrity: string }; minifier: { name: string; version: string }; files: Listed[] };

const manifest = JSON.parse(readFileSync(join(THREE, "vendor.json"), "utf8")) as Manifest;
const modules = manifest.files.filter((f) => f.name);
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** The folder's files, but for a Finder's .DS_Store, which git ignores too. */
function filesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.name !== ".DS_Store").flatMap((e) =>
    e.isDirectory() ? filesIn(join(dir, e.name)) : [relative(THREE, join(dir, e.name)).split("\\").join("/")]);
}

test("three.js 0.186.1 is vendored whole: each file vendor.json lists, at its hash, and no other", () => {
  assert.deepEqual(manifest.package.name + "@" + manifest.package.version, "three@0.186.1");
  assert.match(manifest.package.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
  assert.deepEqual(modules.map((m) => m.name), ["three/core", "three", "three/addons/utils/BufferGeometryUtils.js",
    "three/addons/utils/SkeletonUtils.js", "three/addons/controls/OrbitControls.js", "three/addons/loaders/GLTFLoader.js"]);
  for (const f of manifest.files) {
    const bytes = readFileSync(join(THREE, f.file));
    assert.equal(bytes.length, f.bytes, `${f.file}: its size is not vendor.json's`);
    assert.equal(sha256(bytes), f.sha256, `${f.file}: its hash is not vendor.json's; run node scripts/vendor-three.mjs`);
  }
  assert.deepEqual(filesIn(THREE).sort(), [...manifest.files.map((f) => f.file), "package.json", "vendor.json"].sort());
});

test("the modules import only each other, by the names package.json maps to their files, each after what it imports", () => {
  const pkg = JSON.parse(readFileSync(join(THREE, "package.json"), "utf8"));
  assert.equal(pkg.name, "three");
  assert.equal(pkg.type, "module");
  assert.deepEqual(pkg.exports, Object.fromEntries(modules.map((m) => ["." + m.name!.slice("three".length), `./${m.file}`])));
  // V8's own list of each module's static imports and re-exports, which a comment or a string can't fool.
  const listed = JSON.parse(execFileSync(process.execPath, ["--experimental-vm-modules", "--no-warnings", "--input-type=module", "-e",
    `import vm from "node:vm"; import { readFileSync } from "node:fs";
     const files = JSON.parse(process.env.FILES);
     console.log(JSON.stringify(files.map((f) => new vm.SourceTextModule(readFileSync(f, "utf8"), { identifier: f }).dependencySpecifiers)));`],
  { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "", FILES: JSON.stringify(modules.map((m) => join(THREE, m.file))) } })) as string[][];
  const before = new Set<string>();
  for (const [i, m] of modules.entries()) {
    assert.deepEqual(listed[i], m.imports, `${m.file}: its imports are not vendor.json's`);
    for (const s of listed[i]) assert.ok(before.has(s), `${m.file} imports ${s}, which is not vendored before it`);
    const code = readFileSync(join(THREE, m.file), "utf8");
    assert.doesNotMatch(code, /\bimport\s*\(/, `${m.file} imports a module as it runs, which a page can't map`);
    before.add(m.name!);
  }
});

test("its MIT notice is kept: the package's LICENSE, the builds' @license headers and a NOTICE line", () => {
  const license = readFileSync(join(THREE, "LICENSE"), "utf8");
  assert.match(license, /^The MIT License\n\nCopyright © 2010-2026 three\.js authors\n/);
  assert.match(license, /The above copyright notice and this permission notice shall be included in\nall copies/);
  for (const file of ["three.core.js", "three.module.js"]) {
    assert.match(readFileSync(join(THREE, file), "utf8"), /^\/\*\*\n \* @license\n \* Copyright 2010-2026 Three\.js Authors\n \* SPDX-License-Identifier: MIT\n \*\//, file);
  }
  const notice = readFileSync(join(SKILL, "NOTICE"), "utf8");
  assert.match(notice, /viewer\/vendor\/three\/[^]*three\.js 0\.186\.1[^]*MIT/);
});

test("the vendored GLTFLoader reads each example's model: a node per item in mm, metres with y up, the board's picture", async () => {
  // Node has no window or image decoder; GLTFLoader reads URL off `self`, and the picture needs only its size here.
  const g = globalThis as Record<string, unknown>;
  g.self ??= globalThis;
  const images: { width: number; height: number }[] = [];
  g.createImageBitmap = async (blob: Blob) => {
    const png = Buffer.from(await blob.arrayBuffer());
    assert.equal(png.subarray(1, 4).toString("latin1"), "PNG");
    const image = { width: png.readUInt32BE(16), height: png.readUInt32BE(20), close() {} };
    images.push(image);
    return image;
  };
  const { GLTFLoader } = await import(pathToFileURL(join(THREE, "addons", "loaders", "GLTFLoader.js")).href);
  const { Vector3 } = await import(pathToFileURL(join(THREE, "three.module.js")).href);

  const slugs = readdirSync(EXAMPLES).filter((s) => existsSync(join(EXAMPLES, s, "previews", "system.glb")));
  for (const slug of ["macropad", "ponder"]) assert.ok(slugs.includes(slug), `${slug} has no previews/system.glb`);
  for (const slug of slugs) {
    const system = JSON.parse(readFileSync(join(EXAMPLES, slug, "system.json"), "utf8")) as SystemCheck;
    const glb = readFileSync(join(EXAMPLES, slug, system.model!.file));
    const said: string[] = [], { error, warn } = console;
    console.error = console.warn = (...a: unknown[]) => void said.push(a.join(" "));
    images.length = 0;
    let gltf;
    try {
      gltf = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), "");
    } finally {
      Object.assign(console, { error, warn });
    }
    assert.deepEqual(said, [], `${slug}: GLTFLoader complained`);
    assert.equal(gltf.asset.extras.inputs, system.model!.inputs, `${slug}: the model's inputs are not system.json's`);

    assert.equal(gltf.scene.children.length, 1, slug);
    const root = gltf.scene.children[0];
    assert.equal(root.name, slug);
    // A point 10 mm along x, 20 along y and 30 up is 0.01 m along x, 0.03 up and 0.02 towards the viewer's back.
    const p = new Vector3(10, 20, 30).applyMatrix4(root.matrix).toArray().map((v: number) => +v.toFixed(9));
    assert.deepEqual(p, [0.01, 0.03, -0.02], `${slug}: the root does not make mm with z up metres with y up`);
    assert.deepEqual(root.children.map((c: { name: string }) => c.name), (system.items ?? []).map((i) => i.id), slug);

    let triangles = 0;
    for (const [i, mesh] of root.children.entries()) {
      const item = system.items![i];
      assert.ok(mesh.isMesh, `${slug} ${item.id}: not a mesh`);
      triangles += mesh.geometry.index.count / 3;
      assert.equal(mesh.geometry.attributes.normal, undefined, `${slug} ${item.id}: the model has no normals, the view makes them`);
      // So a view must turn flat shading off after computeVertexNormals, as formats.md says.
      assert.equal(mesh.material.flatShading, true, `${slug} ${item.id}`);
      // Its kind's: cad, envelope or path (a part drawn along one), or the board's own, wearing its picture.
      const material = mesh.material.map ? `board ${item.id}` : item.model;
      assert.equal(mesh.material.name, material, `${slug} ${item.id}`);
      // Its box in the frame's mm, the node's own move, turn and scale with it, is the box system.json gives, within the
      // 0.25 mm formats.md lets a round face's facets stray.
      mesh.geometry.computeBoundingBox();
      mesh.updateMatrix();
      const { min, max } = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrix);
      assert.ok(item.bbox, `${slug} ${item.id}: system.json gives no box`);
      for (const [k, axis] of ["x", "y", "z"].entries()) {
        const off = Math.max(Math.abs(min[axis] - item.bbox[k]), Math.abs(max[axis] - item.bbox[k + 3]));
        assert.ok(off <= 0.3, `${slug} ${item.id}: its mesh is ${off.toFixed(2)} mm off its box along ${axis}`);
      }
    }
    assert.equal(triangles, system.model!.triangles, `${slug}: the triangles are not system.json's`);
    // Each pose that draws parts along its own paths has a scene of them after the default one, turned as the frame is.
    // GLTFLoader renames them (a space becomes _, a name used before gets _1), keeping a node's own name in userData.
    const scened = (system.poses ?? []).filter((p) => p.scene !== null);
    assert.deepEqual(scened.map((p) => p.scene), scened.map((_, k) => k + 1), `${slug}: the poses' scenes, in order`);
    assert.deepEqual(gltf.parser.json.scenes.map((x: { name?: string }) => x.name ?? null), [null, ...scened.map((p) => p.name)], `${slug}: the scenes' names`);
    assert.equal(gltf.scenes.length, scened.length + 1, slug);
    for (const pose of scened) {
      const scene: { children: (typeof root)[] } = gltf.scenes[pose.scene!];
      assert.equal(scene.children.length, 1, `${slug} ${pose.name}`);
      const own = scene.children[0];
      assert.equal(own.userData.name, `${slug} · ${pose.name}`);
      assert.deepEqual(own.matrix.toArray(), root.matrix.toArray(), `${slug} ${pose.name}: not turned as the frame is`);
      assert.deepEqual(own.children.map((c: { userData: { name: string } }) => c.userData.name), pose.drawn.map((d) => d.id), `${slug} ${pose.name}`);
      for (const [i, mesh] of own.children.entries()) {
        const id = pose.drawn[i].id;
        assert.equal(mesh.material.name, "path", `${slug} ${pose.name} ${id}`);
        mesh.geometry.computeBoundingBox();
        mesh.updateMatrix();
        const { min, max } = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrix);
        const box = pose.drawn[i].bbox!;
        for (const [k, axis] of ["x", "y", "z"].entries()) {
          const off = Math.max(Math.abs(min[axis] - box[k]), Math.abs(max[axis] - box[k + 3]));
          assert.ok(off <= 0.3, `${slug} ${pose.name} ${id}: its mesh is ${off.toFixed(2)} mm off its box along ${axis}`);
        }
      }
    }
    if (slug === "ponder") {
      // Pulled straight out, the arm runs level out of the base coupling's top and the head, moved, stands upright with
      // its back on the arm's end, its middle on the arm's line, where the stability gate weighs it, and its front (the
      // lens's LED, the mics) facing on along the arm.
      const straight = system.poses!.filter((p) => p.name.startsWith("arm pulled straight out "));
      assert.deepEqual(straight.map((p) => p.name.slice(24)), ["forward", "backward", "right", "left"]);
      const { Matrix4, Box3 } = await import(pathToFileURL(join(THREE, "three.module.js")).href);
      const mid = (a: number, b: number) => (a + b) / 2;
      for (const pose of straight) {
        const [x0, y0, z0, x1, y1, z1] = pose.drawn.find((d) => d.id === "arm")!.bbox!;
        const moved = new Matrix4().set(...pose.moved!.flat());
        const boxOf = (ids: string[]) => {
          const box = new Box3();
          for (const mesh of root.children.filter((c: { name: string }) => ids.includes(c.name))) {
            mesh.updateMatrix();
            box.union(new Box3().setFromBufferAttribute(mesh.geometry.clone().applyMatrix4(mesh.matrix).applyMatrix4(moved).attributes.position));
          }
          assert.ok(!box.isEmpty(), `${pose.name}: no ${ids.join(", ")}`);
          return box;
        };
        const head = boxOf(["head-upper", "head-lower"]);
        const { min, max } = head;
        const [along, sign] = { forward: ["y", 1], backward: ["y", -1], right: ["x", 1], left: ["x", -1] }[pose.name.slice(24)] as ["x" | "y", number];
        const end = along === "y" ? (sign > 0 ? y1 : y0) : (sign > 0 ? x1 : x0);
        const back = sign > 0 ? min[along] : max[along];
        assert.ok(Math.abs(back - end) < 0.5, `${pose.name}: the head's back is at ${back.toFixed(2)}, the arm ends at ${end.toFixed(2)}`);
        const across = along === "y" ? "x" : "y";
        const arm = { x: mid(x0, x1), y: mid(y0, y1), z: mid(z0, z1) };
        for (const axis of [across, "z"] as const) {
          const off = mid(min[axis], max[axis]) - arm[axis];
          assert.ok(Math.abs(off) < 0.5, `${pose.name}: the head's middle is ${off.toFixed(2)} mm off the arm's line along ${axis}`);
        }
        // The shell is the same box turned half round, so its parts say which way it faces: the front's ahead of its
        // middle, the upper half above the lower, and the camera board on the head's +x, a quarter turn from its front.
        const centre = (box: typeof head, axis: "x" | "y" | "z") => mid(box.min[axis], box.max[axis]);
        const ahead = (centre(boxOf(["ledcam", "mic1"]), along) - centre(head, along)) * sign;
        assert.ok(ahead > 5, `${pose.name}: the head's front is ${ahead.toFixed(2)} mm ahead of its middle along the arm`);
        assert.ok(centre(boxOf(["head-upper"]), "z") > centre(boxOf(["head-lower"]), "z") + 5, `${pose.name}: the head is upside down`);
        const [side, way] = { forward: ["x", 1], backward: ["x", -1], right: ["y", -1], left: ["y", 1] }[pose.name.slice(24)] as ["x" | "y", number];
        const turned = (centre(boxOf(["cam"]), side) - centre(head, side)) * way;
        assert.ok(turned > 5, `${pose.name}: the camera board is ${turned.toFixed(2)} mm toward the head's +x side`);
      }
    }
  }
});
