import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { createGenerationQueue } from "../lib/generation-queue.ts";

const source = await readFile(new URL("../lib/vosr.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
  .replace('"./comfy"', JSON.stringify(new URL("../lib/comfy.ts", import.meta.url).href))
  .replace('"./rtx"', JSON.stringify(new URL("../lib/rtx.ts", import.meta.url).href));
const rtx = await readFile(new URL("../lib/rtx.ts", import.meta.url), "utf8");
const rtxJs = ts.transpileModule(rtx, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText.replace('"./comfy"', JSON.stringify(new URL("../lib/comfy.ts", import.meta.url).href));
const rtxUrl = `data:text/javascript;base64,${Buffer.from(rtxJs).toString("base64")}`;
const moduleJs = js.replace(JSON.stringify(new URL("../lib/rtx.ts", import.meta.url).href), JSON.stringify(rtxUrl));
const { prepareVOSR, runVOSR, vosrPreview } = await import(`data:text/javascript;base64,${Buffer.from(moduleJs).toString("base64")}`);
const input = { sourceId: "a".repeat(32), sourceName: "source.mp4", sourceFile: "source.mp4", width: 608, height: 352, fps: 24, duration: 5.167 };

test("missing installation stops before uploads; redo restores the cached original while a new pass uses the selected product", async () => {
  const previous = globalThis.fetch, calls = [];
  globalThis.fetch = async (url) => { calls.push(new URL(url).pathname); return Response.json({ ready: false, missing: ["model"] }); };
  try {
    await assert.rejects(prepareVOSR(new File(["video"], "source.mp4")), /尚未就緒/);
    assert.deepEqual(calls, ["/h3-studio/vosr/status"]);
    calls.length = 0;
    const product = { filename: "refined.mp4", subfolder: "video", type: "output", vosrRefined: true, vosrSourceId: input.sourceId };
    globalThis.fetch = async (url, init) => {
      const path = new URL(url).pathname; calls.push(path);
      if (path.endsWith("/status")) return Response.json({ ready: true });
      if (path.endsWith("/restore")) { assert.equal(JSON.parse(init.body).sourceId, input.sourceId); return Response.json(input); }
      if (path.endsWith("/prepare")) { assert.equal(JSON.parse(init.body).source.filename, "refined.mp4"); return Response.json(input); }
      throw new Error(path);
    };
    assert.deepEqual(await prepareVOSR(product, true), input);
    assert(!calls.includes("/h3-studio/rtx/prepare"));
    await prepareVOSR(product);
    assert.equal(calls.at(-1), "/h3-studio/rtx/prepare");
    const preview = new URL(vosrPreview(input));
    assert.equal(preview.searchParams.get("type"), "input");
    assert.equal(preview.searchParams.get("subfolder"), `h3_rtx/${input.sourceId}`);
  } finally { globalThis.fetch = previous; }
});

test("VOSR owns the queue through worker completion and restores product metadata", async () => {
  const previous = globalThis.fetch, oldWindow = globalThis.window;
  globalThis.window = { setTimeout: (callback) => setTimeout(callback, 0) };
  let release, reached, drained;
  const gate = new Promise((resolve) => { release = resolve; });
  const progressReached = new Promise((resolve) => { reached = resolve; });
  const done = new Promise((resolve) => { drained = resolve; });
  const events = [], statuses = [];
  let historyCalls = 0;
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    if (path === "/prompt") {
      const graph = JSON.parse(init.body).prompt;
      assert.equal(graph["1"].class_type, "H3StudioVOSR");
      assert.equal(graph["1"].inputs.source_id, input.sourceId);
      assert.match(graph["1"].inputs.job_id, /^[0-9a-f]{32}$/);
      events.push("submitted"); return Response.json({ prompt_id: "vosr" });
    }
    if (path.startsWith("/h3-studio/vosr/progress/")) { reached(); return Response.json({ phase: "processing", done: 10, total: 124 }); }
    if (path === "/history/vosr") {
      if (++historyCalls === 1) return Response.json({});
      await gate;
      return Response.json({ vosr: { outputs: { "1": { images: [{ filename: "saved.mp4", vosrRefined: true, vosrSourceId: input.sourceId, vosrSourceName: input.sourceName, width: 608, height: 352, fps: 24 }] } } } });
    }
    throw new Error(path);
  };
  try {
    const queue = createGenerationQueue(() => {});
    queue.add("VOSR", async () => {
      const video = await runVOSR(input, (message) => statuses.push(message));
      assert.equal(video.vosrSourceId, input.sourceId); assert.equal(video.promptId, "vosr");
      events.push("complete");
    });
    queue.add("H3 next", async () => { events.push("next"); drained(); });
    await progressReached;
    assert.deepEqual(events, ["submitted"]);
    release(); await done;
    assert.deepEqual(events, ["submitted", "complete", "next"]);
    assert(statuses.some((s) => s.includes("10／124")));
  } finally { release(); globalThis.fetch = previous; globalThis.window = oldWindow; }
});

test("worker failures and interruptions are surfaced instead of returning a partial result", async () => {
  const previous = globalThis.fetch;
  try {
    for (const event of ["execution_error", "execution_interrupted"]) {
      globalThis.fetch = async (url) => new URL(url).pathname === "/prompt" ? Response.json({ prompt_id: "failed" }) : Response.json({ failed: { status: { status_str: "error", messages: [[event, { exception_message: "worker stopped" }]] } } });
      await assert.rejects(runVOSR(input, () => {}), /worker stopped/);
    }
  } finally { globalThis.fetch = previous; }
});

test("a temporarily unreadable progress snapshot does not reset the displayed frame count", async () => {
  const previous = globalThis.fetch, oldWindow = globalThis.window;
  globalThis.window = { setTimeout: (callback) => setTimeout(callback, 0) };
  let histories = 0, snapshots = 0;
  const messages = [];
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === "/prompt") return Response.json({ prompt_id: "recover" });
    if (path === "/history/recover") return Response.json(++histories === 4 ? { recover: { outputs: { "1": { images: [{ filename: "saved.mp4" }] } } } } : {});
    return Response.json(++snapshots === 2 ? { phase: "waiting" } : { phase: "processing", done: snapshots === 1 ? 48 : 50, total: 243 });
  };
  try {
    await runVOSR(input, (message) => messages.push(message));
    assert.deepEqual(messages, ["VOSR 精修：48／243 幀", "VOSR 精修：50／243 幀"]);
  } finally { globalThis.fetch = previous; globalThis.window = oldWindow; }
});
