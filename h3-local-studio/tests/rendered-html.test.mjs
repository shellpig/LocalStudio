import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("attention selection changes only the H3 attention chain across profiles and frame inputs", async () => {
  const { buildWorkflow, buildReferenceWorkflow, buildImageWorkflow } = await import("../lib/comfy.ts");
  const base = { prompt: "A person waves.", resolution: "p480", duration: 5, aspect: "3:4", sound: true, seed: 42 };
  for (const profile of ["cooled-turbo-4", "fast", "cooled-turbo-8", "quality", "safe-long", "low-vram"]) {
    for (const anchors of [[], ["first.png"], [undefined, "last.png"], ["first.png", "last.png"]]) {
      const options = { ...base, profile, extraLoras: [{ name: "custom.safetensors", strength: 0.5 }] };
      const old = buildWorkflow(options, ...anchors);
      assert.deepEqual(buildWorkflow({ ...options, attentionMethod: "sage" }, ...anchors), old);
      const fresh = buildWorkflow({ ...options, attentionMethod: "sol" }, ...anchors);
      assert.equal(fresh["119"].class_type, "ModelAttentionBackend");
      assert.deepEqual(fresh["119"].inputs.model, old["119"].inputs.model);
      assert.equal(fresh["119"].inputs.attention, "comfy kitchen attention");
      assert.equal(fresh["118"].class_type, "BlockSparseAttention");
      assert.deepEqual(fresh["118"].inputs, {
        model: ["119", 0], selection: "sol-attn", "selection.tau": 1.3,
        start_percent: 0.2, end_percent: 1, dense_blocks: "", min_tokens: 12288,
        extra_tokens: 256, sink_conditioning: "exact_kv_and_rows", verbose: false,
      });
      assert.deepEqual(fresh["16"].inputs.model, ["118", 0]);
      assert(!Object.values(fresh).some((node) => node.class_type === "MiniMaxH3MemoryEfficientSageAttentionPatch"));
      for (const [id, original] of Object.entries(old)) {
        if (id === "119") continue;
        const actual = structuredClone(fresh[id]);
        if (id === "16") actual.inputs.model = original.inputs.model;
        assert.deepEqual(actual, original, `unrelated node ${id}, profile ${profile}`);
      }
    }
  }
  assert.throws(() => buildReferenceWorkflow({ ...base, profile: "fast", attentionMethod: "sol" }, ["ref.png"]), /LongMedia/);
  assert.equal(buildReferenceWorkflow({ ...base, profile: "fast" }, ["ref.png"])["119"].class_type, "MiniMaxH3MemoryEfficientSageAttentionPatch");
  assert.deepEqual(buildImageWorkflow({ ...base, profile: "fast", attentionMethod: "sol" }), buildImageWorkflow({ ...base, profile: "fast" }));
});

test("video attention persists in metadata, survives history and extension, and can switch back", async () => {
  const { createVideo, getRecentVideos } = await import("../lib/comfy.ts");
  const previousFetch = globalThis.fetch;
  const graphs = [], saved = [];
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    if (path === "/upload/image") return Response.json({ name: "first.png" });
    if (path === "/prompt") {
      graphs.push(JSON.parse(init.body).prompt);
      return Response.json({ prompt_id: `attention-${graphs.length}` });
    }
    if (path.startsWith("/history/")) {
      const id = path.split("/").pop();
      return Response.json({ [id]: { status: { completed: true }, outputs: { out: { videos: [{ filename: `${id}.mp4`, subfolder: "video", type: "output" }] } } } });
    }
    if (path === "/h3-studio/output-metadata") { saved.push(JSON.parse(init.body)); return Response.json({ ok: true }); }
    if (path === "/h3-studio/concat") return Response.json({ ...JSON.parse(init.body).metadata, filename: "extended.mp4", subfolder: "video", type: "output" });
    if (path === "/history") return Response.json({ test: { prompt: [0, "test", graphs[0]], outputs: { out: { videos: [{ filename: "history.mp4", subfolder: "video", type: "output" }] } } } });
    if (path === "/h3-studio/outputs") return Response.json({ outputs: [{ filename: "history.mp4", subfolder: "video", type: "output" }] });
    throw new Error(`Unexpected request: ${path}`);
  };
  try {
    const options = { prompt: "A person waves.", profile: "cooled-turbo-8", resolution: "p480", duration: 5, aspect: "3:4", sound: true, seed: 42, attentionMethod: "sol" };
    const original = await createVideo(options, new File(["image"], "first.png"), null, () => {});
    assert.equal(original.attentionMethod, "sol");
    assert.equal(saved[0].attentionMethod, "sol");
    const [history] = await getRecentVideos();
    assert.equal(history.attentionMethod, "sol");
    const continued = await createVideo({ ...options, attentionMethod: undefined, continuationSource: original }, null, null, () => {});
    assert.equal(continued.attentionMethod, "sol");
    assert.equal(graphs[1]["118"].class_type, "BlockSparseAttention");
    assert.equal(graphs[1]["9"].inputs.steps, 20);
    assert.equal(graphs[1]["142"].class_type, "MiniMaxH3MotionContext");
    const switched = await createVideo({ ...options, attentionMethod: "sage", continuationSource: original }, null, null, () => {});
    assert.equal(switched.attentionMethod, "sage");
    assert.equal(graphs[2]["118"], undefined);
    assert.equal(graphs[2]["119"].class_type, "MiniMaxH3MemoryEfficientSageAttentionPatch");
  } finally { globalThis.fetch = previousFetch; }
});

test("six-step anchored reference video preserves dimensions and profile through generation, metadata and continuation", async () => {
  const { createVideo, referenceVideoSteps, resolveOutputDimensions } = await import(new URL("../lib/comfy.ts", import.meta.url));
  const previousFetch = globalThis.fetch;
  const graphs = [];
  const saved = [];
  let combinedMetadata;
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    if (path === "/upload/image") return Response.json({ name: "reference.png" });
    if (path === "/h3-studio/continuation-frame") return Response.json({ image: "anchor.png" });
    if (path === "/prompt") {
      graphs.push(JSON.parse(init.body).prompt);
      return Response.json({ prompt_id: `ref6-${graphs.length}` });
    }
    if (path.startsWith("/history/")) {
      const id = path.split("/").pop();
      return Response.json({ [id]: { status: { completed: true }, outputs: { out: { videos: [{ filename: `${id}.mp4`, subfolder: "video", type: "output" }] } } } });
    }
    if (path === "/h3-studio/output-metadata") {
      saved.push(JSON.parse(init.body));
      return Response.json({ ok: true });
    }
    if (path === "/h3-studio/concat") {
      combinedMetadata = JSON.parse(init.body).metadata;
      return Response.json({ ...combinedMetadata, filename: "combined.mp4", subfolder: "video", type: "output" });
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  try {
    const options = { prompt: "A person walks.", profile: "fast", resolution: "p480", duration: 5, aspect: "16:9", sound: true, seed: 77, inputMode: "reference", sourceMode: "reference", sourceWidth: 600, sourceHeight: 900 };
    const original = await createVideo(options, new File(["image"], "first.png"), null, () => {}, [{ file: new File(["image"], "reference.png"), label: "person", description: "" }]);
    const continued = await createVideo({ ...options, continuationSource: original }, null, null, () => {});
    assert.equal(original.profile, "fast");
    assert.equal(saved[0].profile, "fast");
    assert.equal(combinedMetadata.profile, "fast");
    assert.equal(continued.profile, "fast");
    const dimensions = resolveOutputDimensions(options);
    assert(dimensions[1] > dimensions[0], "portrait first frame must override the manual landscape aspect");
    assert.deepEqual([saved[0].width, saved[0].height], dimensions);
    assert.deepEqual([combinedMetadata.width, combinedMetadata.height], dimensions);
    for (const graph of graphs) assert.deepEqual([graph["104"].inputs.width, graph["104"].inputs.height], dimensions);
    assert.deepEqual(graphs.map((graph) => graph["9"].inputs.steps), [6, 6]);
    assert.equal(graphs[1]["199"].inputs.image, "anchor.png");
    assert.equal(referenceVideoSteps(original.profile), 6);
  } finally { globalThis.fetch = previousFetch; }
});

test("reference video keeps optional first/last anchors separate from reference ordinals", async () => {
  const { buildReferenceWorkflow } = await import(new URL("../lib/comfy.ts", import.meta.url));
  const options = { prompt: "A blue ball rolls across a table.", profile: "cooled-turbo-8", resolution: "safe", duration: 5, aspect: "16:9", sound: true, inputMode: "reference" };
  for (const [first, last] of [[undefined, undefined], ["first.png", undefined], [undefined, "last.png"], ["first.png", "last.png"]]) {
    const graph = buildReferenceWorkflow(options, ["identity.png", "scene.png"], undefined, first, last);
    assert.equal(graph["104"].inputs.workflow_mode, "ref2va_full");
    assert.deepEqual(graph["104"].inputs.image_1, ["200", 0]);
    assert.deepEqual(graph["104"].inputs.image_2, ["201", 0]);
    assert.equal(graph["200"].inputs.image, "identity.png");
    assert.equal(graph["201"].inputs.image, "scene.png");
    assert.deepEqual(graph["150"].inputs.initial_av, ["104", 1]);
    let conditioning = ["104", 0];
    for (const [index, image] of [first, last].entries()) {
      const guide = graph[String(212 + index)];
      if (!image) { assert.equal(guide, undefined); continue; }
      assert.equal(guide.class_type, "MiniMaxH3AddGuide");
      assert.equal(guide.inputs.frame_idx, index === 0 ? 0 : -1);
      assert.deepEqual(guide.inputs.positive, conditioning);
      assert.deepEqual(guide.inputs.latent, ["104", 1]);
      assert.equal(graph[guide.inputs.image[0]].inputs.image, image);
      conditioning = [String(212 + index), 0];
    }
    assert.deepEqual(graph["16"].inputs.conditioning, conditioning);
  }
  const continuation = buildReferenceWorkflow(options, ["identity.png"], "previous-end.png", "old-first.png", "old-last.png");
  assert.equal(continuation["104"].inputs.workflow_mode, "hybrid_auto");
  assert.deepEqual(continuation["104"].inputs.image_1, ["199", 0]);
  assert.deepEqual(continuation["104"].inputs.image_2, ["200", 0]);
  assert.equal(continuation["212"], undefined);
  assert.equal(continuation["213"], undefined);
});

test("reference history recovers frame anchors independently from reference images", async () => {
  const { buildReferenceWorkflow, getRecentVideos } = await import(new URL("../lib/comfy.ts", import.meta.url));
  const graph = buildReferenceWorkflow({ prompt: "A blue ball rolls.", profile: "cooled-turbo-8", resolution: "safe", duration: 5, aspect: "16:9", sound: true }, ["reference.png"], undefined, "first.png", "last.png");
  const output = { filename: "hybrid-test.mp4", subfolder: "video", type: "output" };
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => Response.json(String(url).includes("/history")
    ? { "hybrid-test": { prompt: [0, "hybrid-test", graph], outputs: { "92": { images: [output] } } } }
    : { outputs: [output] });
  try {
    const [video] = await getRecentVideos();
    assert.equal(video.sourceMode, "reference");
    assert.equal(video.inputMode, "reference");
    assert.equal(video.firstImagePath, "first.png");
    assert.equal(video.lastImagePath, "last.png");
    assert.deepEqual(video.referenceFiles, ["reference.png"]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("history restores extra LoRAs from both legacy and compatible loader nodes", async () => {
  const { buildWorkflow, getRecentVideos, getAvailableLoras } = await import(new URL("../lib/comfy.ts", import.meta.url));
  const extras = [{ name: "MysticXXX_MMH3-V1.safetensors", strength: 0.5 }];
  const previousFetch = globalThis.fetch;
  try {
    for (const loader of ["MiniMaxH3TurboLoRA", "H3StudioLoRA"]) {
      const graph = buildWorkflow({ prompt: "A person walks.", profile: "fast", resolution: "p480", duration: 5, aspect: "16:9", sound: true, extraLoras: extras });
      graph["600"].class_type = loader;
      const output = { filename: "lora-test.mp4", subfolder: "video", type: "output" };
      globalThis.fetch = async (url) => Response.json(String(url).includes("/history")
        ? { "lora-test": { prompt: [0, "lora-test", graph], outputs: { "92": { images: [output] } } } }
        : { outputs: [output] });
      const [video] = await getRecentVideos();
      assert.deepEqual(video.extraLoras, extras);
    }
    globalThis.fetch = async (url) => {
      assert.match(String(url), /\/object_info\/H3StudioLoRA$/);
      return Response.json({ H3StudioLoRA: { input: { required: { lora_name: [[extras[0].name, "minimax_h3_turbo_v4_step600_ema.safetensors"]] } } } });
    };
    assert.deepEqual(await getAvailableLoras(), [extras[0].name]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders H3 Local Studio controls", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>H3 Local Studio<\/title>/i);
  assert.match(html, /讓靈感，躍然成片/);
  assert.match(html, /608 × 352/);
  assert.match(html, /864 × 480/);
  assert.match(html, /960 × 544/);
  assert.match(html, /開啟 · 立體聲/);
  assert.match(html, /關閉 · 無音軌/);
  assert.match(html, /語音生成/);
});

test("keeps Motion Context continuation wiring intact", async () => {
  const [page, styles, comfy, api] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../lib/comfy.ts", import.meta.url), "utf8"),
    readFile(new URL("../../integrations/ComfyUI-H3-Studio/h3_studio_api.py", import.meta.url), "utf8"),
  ]);

  assert.match(page, /下載影片/);
  assert.match(page, /影片操作/);
  assert.match(page, /延伸影片/);
  assert.match(page, /延伸固定使用相容的 QUALITY 20 步/);
  assert.match(page, /const DURATION_OPTIONS = \[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15\]/);
  assert.match(comfy, /if \(seconds === 1\) return 22/);
  assert.match(comfy, /if \(seconds === 2\) return 56/);
  assert.match(page, /選擇首幀圖片/);
  assert.match(page, /選擇尾幀圖片/);
  assert.match(page, /只選尾圖也能生成/);
  assert.match(page, /!firstImageFile && !lastImageFile/);
  assert.match(page, /firstImageDimensions \?\? lastImageDimensions/);
  assert.match(styles, /aspect-ratio: 4 \/ 3/);
  assert.match(styles, /min-height: 280px/);
  assert.match(page, /安全長片 · 低解析生成／480P 輸出/);
  assert.match(page, /官方 H3 Prompt 優化/);
  assert.match(page, /還原原始描述/);
  assert.match(page, /圖片模式會分析首尾幀/);
  assert.match(comfy, /h3-studio\/optimize-prompt/);
  assert.match(api, /routes\.post\("\/h3-studio\/optimize-prompt"\)/);
  assert.match(api, /PROMPT_OPTIMIZATION_LOCK/);
  assert.match(api, /"--ephemeral"/);
  assert.match(api, /"--sandbox",\s*"read-only"/);
  assert.match(api, /"--output-schema"/);
  assert.match(api, /request\.headers\.get\("Origin"\) not in STUDIO_ORIGINS/);
  assert.match(api, /if not 1 <= duration <= 15/);
  assert.match(page, /<option value="fast">6步<\/option>/);
  assert.match(page, /第 1～6 步完成後各暫停 12 秒/);
  assert.match(page, /<option value="cooled-turbo-8">8步<\/option>/);
  assert.match(page, /第 1～8 步完成後各暫停 12 秒/);
  assert.match(page, /QUALITY · 原生 20 步／每步降溫/);
  assert.match(page, /第 1～20 步完成後各暫停 12 秒/);
  assert.match(comfy, /profile: "fast" \| "cooled-fast" \| "cooled-turbo-8" \| "quality" \| "safe-long"/);
  assert.match(comfy, /H3CooledTurboSampler/);
  assert.match(comfy, /steps: quality \? 20 : cooledTurbo8 \? 8 : 6/);
  assert.match(comfy, /cooledFast \|\| cooledTurbo8 \? \["122", 0\]/);
  assert.match(comfy, /quality \? \["123", 0\]/);
  assert.match(comfy, /H3CooledSampler/);
  assert.match(api, /"fast", "cooled-fast", "cooled-turbo-8", "quality", "safe-long"/);
  assert.match(comfy, /VAEDecodeTiled/);
  assert.match(comfy, /low_vram: safeLong/);
  assert.match(comfy, /h3-studio\/upscale/);
  assert.match(api, /routes\.post\("\/h3-studio\/upscale"\)/);
  assert.match(api, /"-c:v", "libx264"/);
  assert.match(comfy, /MiniMaxH3MotionContextSaveLatent/);
  assert.match(comfy, /MiniMaxH3MotionContextLoadLatent/);
  assert.match(comfy, /MiniMaxH3MotionContextTrim/);
  assert.match(comfy, /context_length: "22"/);
  assert.match(comfy, /referenceContinuation \? \(source\.profile === "low-vram" \? "low-vram" : "cooled-turbo-8"\) : "quality"/);
  assert.match(comfy, /inputs\.first_frame = \["130", 0\]/);
  assert.match(comfy, /inputs\.last_frame = \["131", 0\]/);
  assert.match(api, /routes\.post\("\/h3-studio\/concat"\)/);
  assert.match(api, /duration \{duration:\.9f\}/);
});

test("adds Ref2VA references without replacing existing generation flows", async () => {
  const [page, styles, comfy, api] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../lib/comfy.ts", import.meta.url), "utf8"),
    readFile(new URL("../../integrations/ComfyUI-H3-Studio/h3_studio_api.py", import.meta.url), "utf8"),
  ]);

  assert.match(page, /參考生影片/);
  assert.match(page, /@標籤/);
  assert.match(page, /參考說明（選填）/);
  assert.match(page, /每個參考項目都要有圖片與 @標籤/);
  assert.doesNotMatch(page, /!reference\.description\.trim\(\)/);
  assert.match(page, /新增參考/);
  assert.match(page, /referenceImages\.length >= 9/);
  assert.match(styles, /grid-template-columns: repeat\(6,1fr\)/);
  assert.match(comfy, /minimax_h3_ref2va_pruned_w4a8_mixed\.safetensors/);
  assert.match(comfy, /continuation \? "hybrid_auto" : "ref2va_full"/);
  assert.match(comfy, /attention_mode: "existing"/);
  assert.match(comfy, /mlp_chunk_tokens: 4096/);
  assert.match(comfy, /steps: 8/);
  assert.match(comfy, /H3CooledTurboSampler/);
  assert.match(comfy, /native: \{ "16:9": \[1344, 768\]/);
  assert.match(comfy, /index \+ \(continuation \? 2 : 1\)/);
  assert.match(api, /mode == "Ref2VA"/);
  assert.match(api, /subject_definitions, summary, retention_analysis, detailed_description/);
  assert.match(api, /reference_image_/);
  assert.match(api, /description = item\.get\("description", ""\)/);
  assert.match(api, /Infer only the clearly visible identity, appearance, or environmental role/);
  assert.doesNotMatch(api, /not description\.strip\(\)/);
  assert.match(api, /"safe", "clear", "p480", "p540", "native"/);
});

test("keeps legacy low-VRAM workflows and a 540P step between 480P and native", async () => {
  const [{ buildWorkflow, buildReferenceWorkflow, resolveOutputDimensions }, page, comfy, api] = await Promise.all([
    import(new URL("../lib/comfy.ts", import.meta.url)),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/comfy.ts", import.meta.url), "utf8"),
    readFile(new URL("../../integrations/ComfyUI-H3-Studio/h3_studio_api.py", import.meta.url), "utf8"),
  ]);

  assert.deepEqual(resolveOutputDimensions({ resolution: "p540", aspect: "16:9" }), [960, 544]);
  assert.deepEqual(resolveOutputDimensions({ resolution: "p540", aspect: "9:16" }), [544, 960]);
  assert.deepEqual(resolveOutputDimensions({ resolution: "p540", aspect: "1:1" }), [736, 736]);

  const standard = buildWorkflow({
    prompt: "A quiet street.", profile: "low-vram", resolution: "p540",
    duration: 5, aspect: "16:9", sound: true,
  });
  assert.equal(standard["120"].inputs.low_vram, true);
  assert.equal(standard["9"].inputs.steps, 6);
  assert.equal(standard["104"].inputs.width, 960);
  assert.equal(standard["104"].inputs.height, 544);

  const reference = buildReferenceWorkflow({
    prompt: "detailed_description:\nA quiet street.", profile: "low-vram", resolution: "p540",
    inputMode: "reference", duration: 15, aspect: "16:9", sound: true, chainId: "test-chain",
  }, ["reference-one.png"]);
  assert.equal(reference["120"].inputs.low_vram, true);
  assert.equal(reference["104"].inputs.width, 960);
  assert.equal(reference["104"].inputs.height, 544);
  assert.equal(reference["9"].inputs.steps, 8);

  assert.doesNotMatch(page, /<option value="(?:low-vram|cooled-fast)">/);
  assert.match(page, /<option value="low-vram" hidden disabled>/);
  assert.match(page, /\{sizeLabels\.p540\} · 540P/);
  assert.match(comfy, /p540: \{ "16:9": \[960, 544\].*"1:1": \[736, 736\].*"9:16": \[544, 960\] \}/);
  assert.match(comfy, /p540: 960 \* 544/);
  assert.match(api, /"quality", "safe-long", "low-vram"/);
});

test("offers five Ref2VA aspect ratios and passes their dimensions to the workflow", async () => {
  const [{ buildReferenceWorkflow, resolveImageDimensions, resolveOutputDimensions }, page, api] = await Promise.all([
    import(new URL("../lib/comfy.ts", import.meta.url)),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../integrations/ComfyUI-H3-Studio/h3_studio_api.py", import.meta.url), "utf8"),
  ]);

  const cases = [
    ["16:9", [960, 544]], ["4:3", [832, 640]], ["1:1", [736, 736]],
    ["3:4", [640, 832]], ["9:16", [544, 960]],
  ];
  for (const [aspect, expected] of cases) {
    assert.deepEqual(resolveOutputDimensions({ resolution: "p540", aspect }), expected);
    const graph = buildReferenceWorkflow({
      prompt: "detailed_description:\nA quiet street.", profile: "cooled-turbo-8", resolution: "p540",
      inputMode: "reference", duration: 5, aspect, sound: true,
    }, ["reference-one.png"]);
    assert.deepEqual([graph["104"].inputs.width, graph["104"].inputs.height], expected);
    assert.match(page, new RegExp(`<option value="${aspect}">`));
  }
  assert.deepEqual(resolveImageDimensions("4:3"), [2048, 1536]);
  assert.deepEqual(resolveImageDimensions("3:4"), [1536, 2048]);
  assert.match(api, /"16:9", "4:3", "1:1", "3:4", "9:16"/);
});

test("builds Ref2VA continuation from the previous final frame and original references", async () => {
  const [{ buildReferenceWorkflow }, page, api] = await Promise.all([
    import(new URL("../lib/comfy.ts", import.meta.url)),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../integrations/ComfyUI-H3-Studio/h3_studio_api.py", import.meta.url), "utf8"),
  ]);
  const graph = buildReferenceWorkflow({
    prompt: "detailed_description:\nContinue the action.",
    profile: "cooled-turbo-8",
    resolution: "native",
    inputMode: "reference",
    duration: 5,
    aspect: "16:9",
    sound: false,
    chainId: "test-chain",
  }, ["reference-one.png", "reference-two.png"], "previous-final-frame.png");

  assert.equal(graph["104"].inputs.workflow_mode, "hybrid_auto");
  assert.deepEqual(graph["104"].inputs.image_1, ["199", 0]);
  assert.deepEqual(graph["104"].inputs.image_2, ["200", 0]);
  assert.deepEqual(graph["104"].inputs.image_3, ["201", 0]);
  assert.equal(graph["199"].inputs.image, "previous-final-frame.png");
  assert.match(graph["92"].inputs.filename_prefix, /^h3_segments\/test-chain\//);
  assert.equal("audio" in graph["91"].inputs, false);
  assert.match(page, /沿用原本.*張參考圖與標籤/);
  assert.match(api, /routes\.post\("\/h3-studio\/continuation-frame"\)/);
  assert.match(api, /trim=start_frame=\{trim_start_frames\}/);
  assert.match(api, /output_is_extendable/);
});

test("loads saved generation settings without automatically generating", async () => {
  const [page, styles, comfy, api] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../lib/comfy.ts", import.meta.url), "utf8"),
    readFile(new URL("../../integrations/ComfyUI-H3-Studio/h3_studio_api.py", import.meta.url), "utf8"),
  ]);

  assert.match(page, /"再做一次"/);
  assert.match(page, /async function redoVideo/);
  assert.match(page, /setPrompt\(video\.prompt\)/);
  assert.match(page, /setProfile\(video\.profile === "cooled-fast" \? "fast" : video\.profile\)/);
  assert.match(page, /setResolution\(video\.resolution\)/);
  assert.match(page, /setSoundEnabled\(video\.sound\)/);
  assert.match(page, /restoreInputImage/);
  assert.doesNotMatch(page, /async function redoVideo[\s\S]*?\bgenerate\(\)/);
  assert.match(styles, /\.menu-popover \.redo-action/);
  assert.match(styles, /\.notice\.success/);
  assert.match(comfy, /sourceMode: runOptions\.sourceMode/);
  assert.match(comfy, /firstImagePath: uploadedFirstImage/);
  assert.match(comfy, /lastImagePath: uploadedLastImage/);
  assert.match(comfy, /export function inputImageUrl/);
  assert.match(api, /data\.get\("duration"\)/);
  assert.match(api, /data\.get\("sourceMode"\)/);
  assert.match(api, /"firstImagePath", "lastImagePath"/);
});

test("highlights only established reference tags in the prompt editor", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /reference\.file && reference\.label\.trim\(\)/);
  assert.match(page, /function highlightReferenceTags/);
  assert.match(page, /\(\?!\[\\\\p\{L\}\\\\p\{N\}_-\]\)/);
  assert.match(page, /className="prompt-tag-highlight"/);
  assert.match(page, /promptHighlightRef\.current\.scrollTop/);
  assert.match(page, /promptHighlightRef\.current\.scrollLeft/);
  assert.match(styles, /\.prompt-editor\.has-highlights textarea \{ color: transparent; caret-color:/);
  assert.match(styles, /\.prompt-editor\.has-highlights textarea \{[^}]*scrollbar-gutter: stable/);
  assert.match(styles, /\.prompt-highlight \{[^}]*scrollbar-gutter: stable/);
  assert.match(styles, /\.prompt-highlight \{[^}]*white-space: pre-wrap/);
  assert.match(styles, /\.prompt-tag-highlight \{[^}]*color: #b69cff/);
});

test("crops reference and keyframe images without altering the chosen file", async () => {
  const [page, cropper, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/image-cropper.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  // Every crop starts from the file as chosen, so re-cropping never stacks
  // losses and the original is always recoverable.
  assert.match(page, /originalFile: File \| null;/);
  assert.match(page, /crop: CropRect \| null;/);
  assert.match(page, /originalFile: file, crop: null/);
  assert.match(page, /setFirstImageOriginal\(file\);/);
  assert.match(page, /setLastImageOriginal\(file\);/);
  assert.match(page, /function croppableFile\(target: CropTarget\)/);
  assert.match(page, /async function restoreOriginalImage/);

  // Keyframes drive the output ratio, so their crop box is locked to it.
  // Reference images, H3 and Qwen alike, do not, so they crop freely.
  assert.match(page, /aspect=\{cropTarget\.kind === "reference" \|\| cropTarget\.kind === "qwen" \? undefined : CROP_ASPECT\[aspect\]\}/);
  assert.match(page, /const CROP_ASPECT: Record<GenerationOptions\["aspect"\], number>/);

  // The thumbnail is a <label>, so the crop button must not reopen the picker.
  assert.match(page, /event\.preventDefault\(\);\s*\n\s*event\.stopPropagation\(\);/);

  assert.match(cropper, /export async function cropImageFile/);
  assert.match(cropper, /canvas\.toBlob\(resolve, "image\/png"\)/);
  assert.match(cropper, /height = aspect \? width \/ aspect :/);
  assert.match(cropper, /Math\.min\(width, size\.width - x\)/);
  assert.match(cropper, /Math\.min\(height, size\.height - y\)/);

  assert.match(styles, /@import "react-image-crop\/dist\/ReactCrop\.css";/);
  assert.match(styles, /\.crop-actions \{[^}]*position: absolute/);
  assert.match(styles, /\.crop-modal \{[^}]*z-index: 40/);
});

test("uploads an image under a fresh name so the name cannot outgrow the filesystem", async () => {
  const comfy = await readFile(new URL("../lib/comfy.ts", import.meta.url), "utf8");

  // A file restored from an earlier upload already carries that upload's name,
  // so prefixing onto it added 37 characters every round trip until the name
  // passed 255 characters and the upload failed.
  assert.match(comfy, /const extension = \/\\\.\(\?:jpe\?g\|png\|webp\)\$\/i\.exec\(file\.name\)/);
  assert.match(comfy, /data\.append\("image", file, `\$\{crypto\.randomUUID\(\)\}\$\{extension\}`\)/);
  assert.doesNotMatch(comfy, /randomUUID\(\)\}-\$\{file\.name\}/);
});

test("reuses an exact seed and reports the seed of finished videos", async () => {
  const [{ buildWorkflow, buildReferenceWorkflow }, page, comfy, styles, api] = await Promise.all([
    import(new URL("../lib/comfy.ts", import.meta.url)),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/comfy.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../../integrations/ComfyUI-H3-Studio/h3_studio_api.py", import.meta.url), "utf8"),
  ]);

  const base = { prompt: "x", profile: "fast", resolution: "safe", duration: 5, aspect: "16:9", sound: true };
  assert.equal(buildWorkflow({ ...base, seed: 123456 })["15"].inputs.noise_seed, 123456);
  assert.equal(
    buildReferenceWorkflow({ ...base, seed: 987654, inputMode: "reference" }, ["a.png"])["150"].inputs.seed,
    987654,
  );
  // An omitted seed must stay random, or every run would repeat the same video.
  assert.notEqual(
    buildWorkflow({ ...base })["15"].inputs.noise_seed,
    buildWorkflow({ ...base })["15"].inputs.noise_seed,
  );

  // The seed is fixed once per run so the graph and the saved metadata agree.
  assert.match(comfy, /seed: options\.seed \?\? randomSeed\(\),\r?\n {4}chainId,/);
  assert.match(comfy, /const metadata = \{\r?\n {4}seed: runOptions\.seed,/);
  // Recovered from ComfyUI history for both modes.
  assert.match(comfy, /seedFromGraph\(graph, "RandomNoise", "noise_seed"\)/);
  assert.match(comfy, /seedFromGraph\(graph, "MiniMaxH3LatentLabLongMediaSampler", "seed"\)/);

  assert.match(page, /const \[seed, setSeed\] = useState\(""\)/);
  assert.match(page, /seed: seed\.trim\(\) \? Number\(seed\) : undefined/);
  assert.match(page, /className="seed-input"/);
  assert.match(page, /function reuseSeed\(value: number\)/);
  assert.match(page, /setSeed\(video\.seed === undefined \? "" : String\(video\.seed\)\)/);
  assert.match(styles, /\.seed-input \{/);
  // ComfyUI history is capped, so the sidecar must keep the seed as well.
  assert.match(api, /metadata\["seed"\] = seed/);
});

test("stacks any number of extra LoRAs after the Turbo LoRA", async () => {
  const [{ buildWorkflow, buildReferenceWorkflow }, page, comfy, styles] = await Promise.all([
    import(new URL("../lib/comfy.ts", import.meta.url)),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/comfy.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const api = await readFile(new URL("../../integrations/ComfyUI-H3-Studio/h3_studio_api.py", import.meta.url), "utf8");

  const base = { prompt: "x", profile: "fast", resolution: "safe", duration: 5, aspect: "16:9", sound: true };
  const extras = [
    { name: "A.safetensors", strength: 0.8 },
    { name: "B.safetensors", strength: 0.4 },
    { name: "C.safetensors", strength: 1 },
  ];

  const chainOf = (graph, start) => {
    const follow = new Set(["MiniMaxH3TurboLoRA", "H3StudioLoRA", "MiniMaxH3MemoryEfficientSageAttentionPatch"]);
    const out = [];
    let current = start;
    for (;;) {
      const next = Object.entries(graph).find(([, item]) => follow.has(item.class_type)
        && Array.isArray(item.inputs.model) && item.inputs.model[0] === current);
      if (!next) return out;
      out.push(next[0]);
      current = next[0];
    }
  };

  for (const graph of [
    buildWorkflow({ ...base, extraLoras: extras }),
    buildReferenceWorkflow({ ...base, inputMode: "reference", extraLoras: extras }, ["a.png"]),
  ]) {
    assert.deepEqual(chainOf(graph, "6"), ["120", "600", "601", "602", "119"]);
    assert.equal(graph["601"].inputs.lora_name, "B.safetensors");
    assert.equal(graph["601"].inputs.strength, 0.4);
    // Bypass keeps its adapters under one shared injection key, so a second
    // bypass node would overwrite the first. Stacking must merge throughout.
    assert.equal(graph["120"].inputs.low_vram, true);
    for (const id of ["600", "601", "602"]) {
      assert.equal(graph[id].class_type, "H3StudioLoRA");
      assert.equal(graph[id].inputs.low_vram, undefined);
    }
  }

  // Untouched when the feature is unused: the Turbo LoRA keeps its bypass path.
  const plain = buildWorkflow({ ...base });
  assert.deepEqual(chainOf(plain, "6"), ["120", "119"]);
  assert.equal(plain["120"].inputs.low_vram, false);

  // QUALITY builds no Turbo node, so extras must chain straight off the UNET.
  const quality = buildWorkflow({ ...base, profile: "quality", extraLoras: [extras[0]] });
  assert.deepEqual(chainOf(quality, "6"), ["600", "119"]);

  assert.match(comfy, /export async function getAvailableLoras/);
  assert.match(comfy, /name !== TURBO_LORA/);
  assert.match(comfy, /function extraLorasFromGraph/);
  assert.match(page, /className="lora-stack-section"/);
  assert.match(page, /function addExtraLora/);
  assert.match(page, /function removeExtraLora/);
  assert.match(page, /extraLoras: extraLoras\.length \? extraLoras\.map/);
  assert.match(styles, /\.lora-row \{/);
  assert.match(api, /metadata\["extraLoras"\] = normalized_loras/);
  // The stored name is offered back for a re-run, so it stays a bare filename.
  assert.match(api, /Extra LoRA name must not contain a path/);
});
