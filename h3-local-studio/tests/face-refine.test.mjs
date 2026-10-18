import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../lib/face-refine.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText.replace('"./comfy"', JSON.stringify(new URL("../lib/comfy.ts", import.meta.url).href));
const { buildFaceWorkflow, runFace, createVideoWithFace, cancelFace, faceReferences, DEFAULT_FACE_REFINE } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const prepared = { sourceId: "a".repeat(32), videoPath: "source.mp4", referenceFile: "person.png", frames: 56, sound: true, settings: DEFAULT_FACE_REFINE, preview: { shots: [{ faces: 2 }, { faces: 1 }] } };
const video = { filename: "original.mp4", subfolder: "video", type: "output", prompt: "A person walks.", seed: 42, cooldownSeconds: 5 };
const options = { prompt: video.prompt, profile: "fast", resolution: "safe", duration: 2, aspect: "16:9", sound: true, sourceMode: "image", faceRefine: DEFAULT_FACE_REFINE };

test("refinement routes the patched mask model and latent to sampling, preserves original frame timing and masks only the face", () => {
  const graph = buildFaceWorkflow(prepared, video.prompt, 5, 42, [1, -1]);
  assert.equal(graph["1"].inputs.confirmed_pick, "1,-1");
  assert.equal(graph["2"].inputs.identity_track, false, "manual picks must not be replaced by a different identity model");
  assert.deepEqual(graph["13"].inputs.length, ["2", 6]);
  assert.deepEqual(graph["17"].inputs.model, ["16", 2]);
  assert.deepEqual(graph["20"].inputs.model, ["16", 2]);
  assert.deepEqual(graph["22"].inputs.latent_image, ["16", 0]);
  assert.deepEqual(graph["28"].inputs.audio, ["1", 1]);
  assert.deepEqual(graph["28"].inputs.transform, ["2", 1]);
  assert.deepEqual(graph["15"].inputs.audio, ["28", 0], "skipped shots must be removed from conditioning audio before locking");
  assert.equal(graph["20"].inputs.steps, 20);
  assert(!Object.values(graph).some((node) => node.class_type === "MiniMaxH3TurboLoRA"), "native sampling avoids the 3-vs-4 time-row Turbo incompatibility when audio is locked");
  assert.equal(graph["25"].inputs.paste_region, "face_only");
  assert.equal(graph["25"].inputs.undetected_frames, "fade_out");
  assert.equal(graph["26"].inputs.fps, 24);
  const silent = buildFaceWorkflow({ ...prepared, sound: false }, video.prompt, 5, 42);
  assert.equal(silent["15"], undefined, "one-sample silent audio must never enter the audio VAE");
  for (const picks of [[2, 0], [0], [-1, -1]]) assert.throws(() => buildFaceWorkflow(prepared, video.prompt, 5, 42, picks));
});

test("missing installation blocks generation before uploads or GPU work", async () => {
  const previous = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url) => { calls.push(new URL(url).pathname); return Response.json({ ready: false, missing: ["H3FaceSelect"] }); };
  try {
    await assert.rejects(createVideoWithFace(options, new File(["image"], "a.png"), null, [], DEFAULT_FACE_REFINE, { stop: false }, () => {}, () => {}), /尚未就緒/);
    assert.deepEqual(calls, ["/h3-studio/face/status"]);
  } finally { globalThis.fetch = previous; }
});

test("Turbo 8 unlocks audio after per-frame masking for both voiced and silent sources", () => {
  for (const sound of [true, false]) {
    const graph = buildFaceWorkflow({ ...prepared, sound, settings: { ...DEFAULT_FACE_REFINE, mode: "turbo-8" } }, video.prompt, 5, 42, [1, -1]);
    assert.equal(graph["20"].inputs.steps, 8);
    assert.equal(graph["4"].class_type, "MiniMaxH3TurboLoRA");
    assert.equal(graph["18"].class_type, "MiniMaxH3TurboSampler");
    assert.equal(graph["19"].class_type, "H3CooledTurboSampler");
    assert.equal(graph["19"].inputs.seconds, 5);
    assert.deepEqual(graph["16"].inputs.model, ["8", 0]);
    assert.deepEqual(graph["29"].inputs.av_latent, ["16", 0]);
    assert.deepEqual(graph["22"].inputs.latent_image, ["29", 0]);
    assert.deepEqual(graph["17"].inputs.model, ["16", 2]);
    assert.equal(graph["15"], undefined);
    assert.equal(graph["28"], undefined);
    assert.equal(graph["1"].inputs.confirmed_pick, "1,-1");
  }
  assert.throws(() => buildFaceWorkflow({ ...prepared, settings: { ...DEFAULT_FACE_REFINE, mode: "turbo-4" } }, video.prompt, 5, 42), /模式無效/);
});

test("supplemental identity images remain selectable when reopening a refined work", () => {
  assert.deepEqual(faceReferences({ referenceFiles: ["person.png"], firstImagePath: "scene.png", faceRefineReference: "closeup.png" }), ["person.png", "scene.png", "closeup.png"]);
  assert.deepEqual(faceReferences({ referenceFiles: ["person.png"], faceRefineReference: "person.png" }), ["person.png"]);
});

test("multi-person passes use distinct original identities and chain the previous result", async () => {
  const previous = globalThis.fetch; const graphs = [], statuses = [];
  const settings = { ...DEFAULT_FACE_REFINE, select: "all_faces", mode: "turbo-8" };
  const batch = { ...prepared, settings, targets: [{ index: 0, label: "person A", referenceFile: "a.png" }, { index: 1, label: "person B", referenceFile: "b.png" }] };
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    if (path === "/prompt") { graphs.push(JSON.parse(init.body).prompt); return Response.json({ prompt_id: `person-${graphs.length}` }); }
    if (path.startsWith("/history/")) {
      const id = path.split("/").pop();
      return Response.json({ [id]: { status: { completed: true }, outputs: { out: { videos: [{ filename: `${batch.sourceId}_person${graphs.length - 1}_00001_.mp4`, subfolder: "h3_face_cache", type: "output" }] } } } });
    }
    if (path.endsWith("/finish")) {
      const data = JSON.parse(init.body);
      assert.equal(data.completedPeople, 2);
      assert.equal(data.raw.filename, `${batch.sourceId}_person1_00001_.mp4`);
      return Response.json({ filename: "both.mp4", faceRefinePeopleCompleted: 2 });
    }
    throw new Error(path);
  };
  try {
    const result = await runFace(video, settings, { stop: false }, (status) => statuses.push(status), batch);
    assert.equal(result.faceRefinePeopleCompleted, 2);
    assert.equal(graphs[0]["1"].class_type, "H3StudioMultiFaceSource");
    assert.equal(JSON.parse(graphs[0]["1"].inputs.source).filename, video.filename);
    assert.equal(JSON.parse(graphs[1]["1"].inputs.source).filename, `${batch.sourceId}_person0_00001_.mp4`);
    assert.deepEqual(graphs.map((graph) => graph["12"].inputs.image), ["a.png", "b.png"]);
    assert(statuses.some((status) => status.includes("1/2 組")));
    assert(statuses.some((status) => status.includes("2/2 組")));
    assert.throws(() => buildFaceWorkflow(batch, video.prompt, 5, 42), /先偵測/);
  } finally { globalThis.fetch = previous; }
});

test("stopping after one person saves a partial work and never submits the next person", async () => {
  const previous = globalThis.fetch; let submitted = 0, saved = false;
  const control = { stop: false }, settings = { ...DEFAULT_FACE_REFINE, select: "all_faces" };
  const batch = { ...prepared, settings, targets: [{ index: 0, label: "A", referenceFile: "a.png" }, { index: 1, label: "B", referenceFile: "b.png" }] };
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    if (path === "/prompt") { submitted++; return Response.json({ prompt_id: "first" }); }
    if (path === "/history/first") {
      control.stop = true;
      return Response.json({ first: { status: { completed: true }, outputs: { out: { videos: [{ filename: `${batch.sourceId}_person0_00001_.mp4`, subfolder: "h3_face_cache", type: "output" }] } } } });
    }
    if (path.endsWith("/finish")) { assert.equal(JSON.parse(init.body).completedPeople, 1); saved = true; return Response.json({ filename: "partial.mp4" }); }
    throw new Error(path);
  };
  try {
    await assert.rejects(runFace(video, settings, control, () => {}, batch), /已保存 1\/2 組：partial.mp4/);
    assert.equal(submitted, 1); assert.equal(saved, true); assert.equal(control.promptId, undefined);
  } finally { globalThis.fetch = previous; }
});

test("cancelling while polling exits without publishing or leaving an endless history poll", async () => {
  const previous = globalThis.fetch, previousWindow = globalThis.window;
  const control = { stop: false }; let finished = false, polls = 0;
  globalThis.window = { setTimeout: (done) => setImmediate(done) };
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === "/prompt") return Response.json({ prompt_id: "cancel-me" });
    if (path === "/history/cancel-me") { polls++; return Response.json({}); }
    if (path === "/queue") return Response.json({ queue_running: [[1, "cancel-me"]] });
    if (path.endsWith("/finish")) finished = true;
    throw new Error(path);
  };
  try {
    await assert.rejects(runFace(video, DEFAULT_FACE_REFINE, control, (message) => { if (message.includes("GPU 正在")) control.stop = true; }, prepared), /已停止/);
    assert.equal(polls, 1);
    assert.equal(finished, false);
    assert.equal(control.promptId, undefined);
  } finally { globalThis.fetch = previous; globalThis.window = previousWindow; }
});

test("automatic two-stage generation saves the original before refinement and retains it on a refinement failure", async () => {
  const previous = globalThis.fetch; const phases = []; let original; let prompts = 0;
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/face/status")) return Response.json({ ready: true });
    if (path === "/upload/image") return Response.json({ name: "person.png" });
    if (path === "/prompt") {
      prompts++;
      if (prompts === 2) { assert.equal(original.filename, "original.mp4"); return Response.json({ node_errors: "fixture failure" }); }
      return Response.json({ prompt_id: "generated" });
    }
    if (path === "/history/generated") return Response.json({ generated: { status: { completed: true }, outputs: { out: { videos: [video] } } } });
    if (path === "/h3-studio/output-metadata") { assert.deepEqual(JSON.parse(init.body).faceRefine, DEFAULT_FACE_REFINE); return Response.json({ saved: true }); }
    if (path.endsWith("/face/prepare")) { assert.equal(original.filename, "original.mp4"); return Response.json(prepared); }
    throw new Error(path);
  };
  try {
    await assert.rejects(createVideoWithFace(options, new File(["image"], "person.png"), null, [], DEFAULT_FACE_REFINE, { stop: false }, (message) => phases.push(message), (value) => { original = value; }), /原片 original.mp4 已保留/);
    assert.equal(prompts, 2);
    assert(phases.some((message) => message.startsWith("生成影片（1/2）")));
    assert(phases.some((message) => message.startsWith("人臉精修（2/2）")));
    assert.equal(original.firstImagePath, "person.png");
  } finally { globalThis.fetch = previous; }
});

test("successful refinement exports only after the GPU result and cancellation never interrupts another prompt", async () => {
  const previous = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname; calls.push(path);
    if (path === "/prompt") {
      const graph = JSON.parse(init.body).prompt;
      assert.match(graph["13"].inputs.prompt, /<Picture 1> defines this person's facial identity/);
      assert(!graph["13"].inputs.prompt.includes("<Picture 2>"));
      return Response.json({ prompt_id: "refine" });
    }
    if (path === "/history/refine") return Response.json({ refine: { status: { completed: true }, outputs: { out: { videos: [{ filename: "cached.mp4", subfolder: "h3_face_cache", type: "output" }] } } } });
    if (path.endsWith("/face/finish")) { assert.equal(JSON.parse(init.body).raw.filename, "cached.mp4"); return Response.json({ filename: "refined.mp4", faceRefined: true }); }
    if (path === "/queue" && !init) return Response.json({ queue_running: [[1, "someone-else"]] });
    if (path === "/queue") { assert.deepEqual(JSON.parse(init.body), { delete: ["refine"] }); return Response.json({}); }
    throw new Error(path);
  };
  try {
    const control = { stop: false };
    const result = await runFace({ ...video, prompt: "<Picture 2> is the selected person, <Picture 1> is someone else." }, DEFAULT_FACE_REFINE, control, () => {}, prepared, [0, 0]);
    assert.equal(result.faceRefined, true);
    assert.equal(control.promptId, undefined);
    await cancelFace({ stop: false, promptId: "refine" });
    assert(!calls.includes("/interrupt"));
    const before = calls.length;
    await assert.rejects(runFace(video, DEFAULT_FACE_REFINE, { stop: true }, () => {}, prepared), /已停止/);
    assert.equal(calls.length, before);
  } finally { globalThis.fetch = previous; }
});
