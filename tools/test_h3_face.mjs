// Explicit real-GPU smoke test. Input must be a short, benign H3 work with reference metadata.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(new URL("../h3-local-studio/package.json", import.meta.url));
const ts = require("typescript");
const root = new URL("../", import.meta.url);
globalThis.window = globalThis;
const source = await fs.readFile(new URL("h3-local-studio/lib/face-refine.ts", root), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText.replace('"./comfy"', JSON.stringify(new URL("h3-local-studio/lib/comfy.ts", root).href));
const { prepareFace, buildFaceWorkflow, runFace, DEFAULT_FACE_REFINE } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const filename = process.argv[2];
assert(filename && !filename.includes("/") && !filename.includes("\\"), "Pass a Studio output filename explicitly");
const metadata = JSON.parse(await fs.readFile(new URL(`ComfyUI/output/video/${filename}.h3.json`, root), "utf8"));
const video = { ...metadata, filename, subfolder: "video", type: "output" };
const settings = { ...DEFAULT_FACE_REFINE, strength: 0.3, select: process.argv.includes("--multi") ? "all_faces" : DEFAULT_FACE_REFINE.select, mode: process.argv.includes("--turbo") ? "turbo-8" : "native-20" };
const prepared = await prepareFace(video, settings, undefined, true);
assert(prepared.preview.shots.some((shot) => shot.faces));
const graphInput = prepared.targets ? { ...prepared, targetIndex: 0, currentSource: video, referenceFile: prepared.targets[0].referenceFile } : prepared;
const graph = buildFaceWorkflow(graphInput, video.prompt, video.cooldownSeconds, video.seed);
const info = await (await fetch("http://127.0.0.1:8188/object_info")).json();
for (const node of Object.values(graph)) {
  assert(info[node.class_type], `Missing node ${node.class_type}`);
  for (const key of Object.keys(info[node.class_type].input.required ?? {})) {
    assert(key in node.inputs || key === "ref_images", `${node.class_type} missing ${key}`);
  }
}
console.log(JSON.stringify({ prepared: prepared.sourceId, targets: prepared.targets, shots: prepared.preview.shots.map((shot) => ({ faces: shot.faces, frame: shot.frame })), contract: "passed" }));
await fs.writeFile(new URL("work/face-smoke-prepared.json", root), JSON.stringify(prepared, null, 2));
if (process.argv.includes("--run")) {
  const result = await runFace(video, settings, { stop: false }, console.log, prepared);
  await fs.writeFile(new URL("work/face-smoke-result.json", root), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
