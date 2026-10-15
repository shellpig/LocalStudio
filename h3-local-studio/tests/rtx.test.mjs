import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { createGenerationQueue } from "../lib/generation-queue.ts";

const source = await readFile(new URL("../lib/rtx.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText.replace('"./comfy"', JSON.stringify(new URL("../lib/comfy.ts", import.meta.url).href));
const { runRTX, prepareRTX } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);

test("RTX holds the shared queue until completion before the next H3 task starts", async () => {
  const previous = globalThis.fetch;
  let release;
  let reachedHistory;
  const historyStarted = new Promise((resolve) => { reachedHistory = resolve; });
  const finished = new Promise((resolve) => { release = resolve; });
  let queueFinished;
  const drained = new Promise((resolve) => { queueFinished = resolve; });
  const events = [];
  let jobs;
  const queue = createGenerationQueue((value) => { jobs = value; });
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path.startsWith("/object_info")) return Response.json({ H3StudioRTX: {} });
    if (path === "/prompt") { events.push("RTX submitted"); return Response.json({ prompt_id: "queued" }); }
    reachedHistory();
    await finished;
    return Response.json({ queued: { outputs: { "1": { images: [{ filename: "saved.mp4" }] } } } });
  };
  try {
    queue.add("RTX · 補幀 3 倍", async (status) => {
      await runRTX({ filename: "source.mp4" }, "fps", 3, status, { sourceId: "d".repeat(32) });
      events.push("RTX complete");
    });
    queue.add("H3 next", async () => { events.push("H3 starts"); queueFinished(); });
    await historyStarted;
    assert.deepEqual(jobs.map((job) => job.status), ["running", "waiting"]);
    assert.deepEqual(events, ["RTX submitted"]);
    release();
    await drained;
    assert.deepEqual(events, ["RTX submitted", "RTX complete", "H3 starts"]);
  } finally { release(); globalThis.fetch = previous; }
});

test("source inspection preserves fractional fps and execution reuses the inspected upload", async () => {
  const previous = globalThis.fetch;
  const input = { sourceId: "c".repeat(32), width: 1280, height: 720, fps: 781001 / 2606, duration: 49.3 };
  let preparations = 0;
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/prepare")) {
      preparations += 1;
      assert(init.body instanceof FormData);
      return Response.json(input);
    }
    if (path.startsWith("/object_info")) return Response.json({ H3StudioRTX: {} });
    if (path === "/prompt") {
      assert.equal(JSON.parse(init.body).prompt["1"].inputs.source_id, input.sourceId);
      return Response.json({ prompt_id: "inspected" });
    }
    return Response.json({ inspected: { outputs: { "1": { images: [{ filename: "saved.mp4" }] } } } });
  };
  try {
    const file = new File(["video"], "test.mp4");
    const prepared = await prepareRTX(file);
    assert.deepEqual(prepared, input);
    await runRTX(file, "upscale", 2, () => {}, prepared);
    assert.equal(preparations, 1, "must not upload the file again when starting RTX");
  } finally { globalThis.fetch = previous; }
});

test("RTX submits one queued operation and returns saved fps, geometry and source metadata", async () => {
  const previous = globalThis.fetch;
  for (const [operation, multiplier] of [["fps", 3], ["upscale", 4]]) {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      const path = new URL(url).pathname; calls.push(path);
      if (path.startsWith("/object_info")) return Response.json({ H3StudioRTX: {} });
      if (path.endsWith("/prepare")) {
        assert.equal(JSON.parse(init.body).source.filename, "source.mp4");
        return Response.json({ sourceId: "a".repeat(32) });
      }
      if (path === "/prompt") {
        assert.deepEqual(JSON.parse(init.body).prompt["1"], { class_type: "H3StudioRTX", inputs: { source_id: "a".repeat(32), operation, multiplier } });
        return Response.json({ prompt_id: "rtx" });
      }
      if (path === "/history/rtx") return Response.json({ rtx: { outputs: { "1": { images: [{ filename: "saved.mp4", rtxOperation: operation, rtxMultiplier: multiplier, fps: 72, width: 480, height: 640 }] } } } });
      throw new Error(path);
    };
    try {
      const result = await runRTX({ filename: "source.mp4", subfolder: "video", type: "output" }, operation, multiplier, () => {});
      assert.equal(result.rtxOperation, operation);
      assert.equal(result.rtxMultiplier, multiplier);
      assert.equal(result.fps, 72);
      assert.equal(result.promptId, "rtx");
      assert.equal(calls.filter((path) => path === "/prompt").length, 1);
    } finally { globalThis.fetch = previous; }
  }
});

test("RTX rejects unsupported multipliers before upload and reports missing installation", async () => {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return Response.json({}); };
  try {
    const file = new File(["video"], "source.mp4");
    for (const [operation, multiplier] of [["fps", 1], ["fps", 17], ["fps", 2.5], ["upscale", 16], ["other", 2]]) {
      await assert.rejects(runRTX(file, operation, multiplier, () => {}), /無效/);
    }
    assert.equal(calls.length, 0);
    await assert.rejects(runRTX(file, "fps", 2, () => {}), /重新啟動/);
    assert.equal(calls.length, 1);
  } finally { globalThis.fetch = previous; }
});

test("RTX uploads a File and surfaces SDK errors from ComfyUI history", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    if (path.startsWith("/object_info")) return Response.json({ H3StudioRTX: {} });
    if (path.endsWith("/prepare")) {
      assert(init.body instanceof FormData);
      assert.equal(init.body.get("video").name, "test.mp4");
      return Response.json({ sourceId: "b".repeat(32) });
    }
    if (path === "/prompt") return Response.json({ prompt_id: "failed" });
    return Response.json({ failed: { status: { status_str: "error", messages: [["execution_error", { exception_message: "RTX GPU unavailable" }]] } } });
  };
  try {
    await assert.rejects(runRTX(new File(["video"], "test.mp4"), "upscale", 2, () => {}), /RTX GPU unavailable/);
  } finally { globalThis.fetch = previous; }
});
