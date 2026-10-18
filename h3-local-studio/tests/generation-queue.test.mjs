import assert from "node:assert/strict";
import test from "node:test";
import { createGenerationQueue } from "../lib/generation-queue.ts";
import { waitForResult } from "../lib/comfy.ts";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("discarding a waiting refinement releases its controls without executing GPU work", async () => {
  const gate = deferred();
  const queue = createGenerationQueue(() => {});
  let discarded = false, executed = false;
  const running = queue.add("active", async () => gate.promise);
  const pending = queue.add("refine", async () => { executed = true; }, () => { discarded = true; });
  queue.remove(running);
  assert.equal(discarded, false);
  queue.remove(pending);
  assert.equal(discarded, true);
  gate.resolve(); await flush();
  assert.equal(executed, false);
});

test("video postprocessing and all Qwen batch images finish before the next job starts", async () => {
  let jobs;
  const queue = createGenerationQueue((value) => { jobs = value; });
  const video = deferred();
  const metadata = deferred();
  const batch = deferred();
  const events = [];
  queue.add("H3", async (status) => {
    events.push("video");
    await video.promise;
    status("saving metadata");
    await metadata.promise;
    events.push("video complete");
  });
  queue.add("Qwen batch", async () => {
    events.push("image 1");
    await batch.promise;
    events.push("image 2");
  });
  queue.add("H3 next", async () => { events.push("next video"); });
  assert.deepEqual(jobs.map((job) => job.status), ["running", "waiting", "waiting"]);
  video.resolve();
  await flush();
  assert.deepEqual(events, ["video"]);
  assert.equal(jobs[0].message, "saving metadata");
  metadata.resolve();
  await flush();
  assert.deepEqual(events, ["video", "video complete", "image 1"]);
  batch.resolve();
  await flush();
  assert.deepEqual(events, ["video", "video complete", "image 1", "image 2", "next video"]);
  assert.deepEqual(jobs, []);
});

test("removing a pending job never starts it or removes the running job", async () => {
  let jobs;
  const queue = createGenerationQueue((value) => { jobs = value; });
  const first = deferred();
  const calls = [];
  const running = queue.add("first", async () => { await first.promise; });
  const removed = queue.add("removed", async () => { calls.push("removed"); });
  queue.add("last", async () => { calls.push("last"); });
  queue.remove(running);
  queue.remove(removed);
  assert.deepEqual(jobs.map((job) => job.label), ["first", "last"]);
  first.resolve();
  await flush();
  assert.deepEqual(calls, ["last"]);
});

test("a failed task retains its error, continues the queue, and allows later submissions", async () => {
  let jobs;
  const queue = createGenerationQueue((value) => { jobs = value; });
  const calls = [];
  const failed = queue.add("bad video", async () => { throw new Error("GPU failed"); });
  queue.add("good image", async () => { calls.push("image"); });
  await flush();
  assert.deepEqual(calls, ["image"]);
  assert.equal(jobs[0].status, "failed");
  assert.equal(jobs[0].message, "GPU failed");
  queue.add("later video", async () => { calls.push("video"); });
  await flush();
  assert.deepEqual(calls, ["image", "video"]);
  queue.remove(failed);
  assert.deepEqual(jobs, []);
});

test("GPU status distinguishes a submitted job waiting behind other work from running", async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  let polls = 0;
  const statuses = [];
  globalThis.window = { setTimeout: (callback) => setImmediate(callback) };
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === "/queue") return Response.json({ queue_running: [[0, polls === 1 ? "other" : "target"]] });
    assert.equal(path, "/history/target");
    polls += 1;
    if (polls < 3) return Response.json({});
    return Response.json({ target: { status: { completed: true }, outputs: { out: { images: [{ filename: "result.png", subfolder: "H3_Image", type: "output" }] } } } });
  };
  try {
    const result = await waitForResult("target", (status) => statuses.push(status), "image");
    assert.equal(result.filename, "result.png");
    assert.deepEqual(statuses, ["工作已進入佇列，等待 GPU 執行…", "GPU 正在載入模型並生成…"]);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }
});
