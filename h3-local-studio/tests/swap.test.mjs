import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { TURBO_LORA } from "../lib/comfy.ts";

const source = await readFile(new URL("../lib/swap.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText.replace('"./comfy"', JSON.stringify(new URL("../lib/comfy.ts", import.meta.url).href));
const { buildSwapWorkflow, buildSwapPrompt, swapDimensions, runSwap, SWAP_LORAS } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
const input = { sourceId: "a".repeat(32), sourceName: "source.mp4", sourceFile: "source.mp4", referenceFile: "head.png", width: 720, height: 1280, duration: 6, segments: [{ inputFile: "guide_0.mp4", keepFrames: 124 }, { inputFile: "guide_1.mp4", keepFrames: 20, length: 22 }] };
const options = { mode: "head", steps: 20, resolution: "p480", prompt: buildSwapPrompt("head"), strength: 1, seed: 42, cooldownSeconds: 5 };

test("both swap modes use aligned guides and the correct sampling path for 4/6/8/20 steps", () => {
  for (const mode of ["head", "character"]) for (const steps of [4, 6, 8, 20]) {
    const graph = buildSwapWorkflow(input, 0, { ...options, mode, steps });
    assert.equal(graph["2"].inputs.lora_name, SWAP_LORAS[mode]);
    assert.equal(graph["14"].class_type, "MiniMaxH3AddGuide");
    assert.equal(graph["14"].inputs.frame_idx, 0);
    assert.deepEqual(graph["14"].inputs.image, ["12", 0]);
    assert.deepEqual(graph["13"].inputs["ref_images.ref_image_0"], ["10", 0]);
    assert.equal(graph["13"].inputs.ref_videos, undefined);
    assert.equal(graph["18"].inputs.steps, steps);
    assert.deepEqual(graph["15"].inputs.conditioning, ["14", 0]);
    assert.match(graph["24"].inputs.filename_prefix, /^h3_swap_cache\/a+_seg0$/);
    if (steps === 20) {
      assert.equal(graph["25"], undefined);
      assert.equal(graph["16"].inputs.sampler_name, "res_multistep");
    } else {
      assert.equal(graph["25"].inputs.lora_name, TURBO_LORA);
      assert.equal(graph["25"].inputs.low_vram, true);
      assert.deepEqual(graph["2"].inputs.model, ["25", 0]);
      assert.equal(graph["16"].class_type, "MiniMaxH3TurboSampler");
      assert.equal(graph["17"].class_type, "H3CooledTurboSampler");
    }
  }
  assert.equal(buildSwapWorkflow(input, 0, options)["13"].inputs.length, 124);
  assert.equal(buildSwapWorkflow(input, 1, options)["13"].inputs.length, 22);
  assert.match(buildSwapPrompt("head"), /original body, clothing, accessories and all outfit changes/);
  assert.match(buildSwapPrompt("character", "person on the left"), /person on the left/);
  assert.match(buildSwapWorkflow(input, 0, { ...options, prompt: "My custom prompt", target: "the person on the left" })["13"].inputs.prompt, /Target selection: replace only the person on the left/);
  for (const resolution of ["p480", "p540", "native"]) {
    const [w, h] = swapDimensions(resolution, 720, 1280);
    assert(w < h); assert.equal(w % 32, 0); assert.equal(h % 32, 0);
  }
});

test("Akatz V1.5 uses reference video conditioning and native sampling without BFS guides or Turbo", () => {
  const prompt = buildSwapPrompt("akatz-v1.5", "the person on the left");
  assert.match(prompt, /the person on the left.*<Video 1>/);
  assert.match(prompt, /<Picture 1>/);
  assert.doesNotMatch(prompt, /Add Guide|body_swap/);
  const graph = buildSwapWorkflow(input, 0, { ...options, mode: "akatz-v1.5", prompt });
  assert.equal(graph["2"].inputs.lora_name, "h3_character_swap_v1.5.safetensors");
  assert.deepEqual(graph["2"].inputs.model, ["1", 0]);
  assert.deepEqual(graph["13"].inputs["ref_videos.ref_video_0"], ["12", 0]);
  assert.deepEqual(graph["13"].inputs["ref_images.ref_image_0"], ["10", 0]);
  assert.deepEqual(graph["15"].inputs.conditioning, ["13", 0]);
  assert.equal(graph["14"], undefined);
  assert.equal(graph["25"], undefined);
  assert.equal(graph["16"].inputs.sampler_name, "res_multistep");
  assert.equal(graph["17"].class_type, "H3CooledSampler");
  assert.equal(graph["18"].inputs.scheduler, "simple");
  assert.equal(graph["18"].inputs.steps, 20);
  for (const steps of [4, 6, 8]) assert.throws(() => buildSwapWorkflow(input, 0, { ...options, mode: "akatz-v1.5", steps }), /設定無效/);
});

test("Akatz jobs check their own LoRA, preserve settings and finish without requiring Turbo", async () => {
  const previous = globalThis.fetch;
  const saved = { ...options, mode: "akatz-v1.5", prompt: buildSwapPrompt("akatz-v1.5"), target: "the woman" };
  let prepared = false, submitted = false;
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    if (path.startsWith("/object_info")) return Response.json({ LoraLoaderModelOnly: { input: { required: { lora_name: [[SWAP_LORAS["akatz-v1.5"]]] } } } });
    if (path.endsWith("/prepare")) {
      prepared = true;
      assert.deepEqual(JSON.parse(init.body.get("settings")), { ...saved, width: 480, height: 864 });
      return Response.json({ ...input, segments: input.segments.slice(0, 1) });
    }
    if (path === "/prompt") {
      submitted = true;
      assert(prepared);
      const graph = JSON.parse(init.body).prompt;
      assert.deepEqual(graph["13"].inputs["ref_videos.ref_video_0"], ["12", 0]);
      assert.equal(graph["25"], undefined);
      return Response.json({ prompt_id: "akatz" });
    }
    if (path === "/history/akatz") return Response.json({ akatz: { status: { completed: true }, outputs: { "24": { images: [{ filename: `${input.sourceId}_seg0_00001_.mp4`, subfolder: "h3_swap_cache", type: "output" }] } } } });
    if (path.endsWith("/finish")) {
      assert(submitted);
      assert.equal(JSON.parse(init.body).results.length, 1);
      return Response.json({ filename: "akatz.mp4", swapMode: saved.mode, prompt: saved.prompt, steps: 20 });
    }
    throw new Error(path);
  };
  try {
    const completed = await runSwap(new File(["video"], "source.mp4"), new File(["image"], "reference.png"), input, saved, { stop: false }, () => {});
    assert.equal(completed.result.swapMode, "akatz-v1.5");
    assert.equal(completed.result.steps, 20);
  } finally { globalThis.fetch = previous; }
});

test("stop after current segment keeps completed work without submitting the next segment", async () => {
  const previous = globalThis.fetch;
  const control = { stop: false };
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname; calls.push(path);
    if (path.startsWith("/object_info")) return Response.json({ LoraLoaderModelOnly: { input: { required: { lora_name: [[SWAP_LORAS.head]] } } } });
    if (path.endsWith("/prepare")) return Response.json(input);
    if (path === "/prompt") return Response.json({ prompt_id: "one" });
    if (path === "/history/one") {
      control.stop = true;
      return Response.json({ one: { status: { completed: true }, outputs: { "24": { images: [{ filename: `${input.sourceId}_seg0_00001_.mp4`, subfolder: "h3_swap_cache", type: "output" }] } } } });
    }
    if (path.endsWith("/finish")) {
      assert.equal(JSON.parse(init.body).results.length, 1);
      return Response.json({ filename: "partial.mp4", swapCompletedSegments: 1, swapTotalSegments: 2 });
    }
    throw new Error(path);
  };
  try {
    const completed = await runSwap(new File(["video"], "source.mp4"), new File(["image"], "head.png"), input, options, control, () => {});
    assert.equal(completed.result.swapCompletedSegments, 1);
    assert.equal(calls.filter((path) => path === "/prompt").length, 1);
  } finally { globalThis.fetch = previous; }
});

test("missing LoRA and invalid settings fail before uploading video or submitting GPU work", async () => {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return Response.json({}); };
  try {
    const video = new File(["video"], "source.mp4"), image = new File(["image"], "head.png");
    await assert.rejects(runSwap(video, image, input, { ...options, steps: 7 }, { stop: false }, () => {}), /設定無效/);
    assert.equal(calls.length, 0);
    await assert.rejects(runSwap(video, image, input, options, { stop: false }, () => {}), /尚未安裝/);
    assert.equal(calls.length, 1);
  } finally { globalThis.fetch = previous; }
});
