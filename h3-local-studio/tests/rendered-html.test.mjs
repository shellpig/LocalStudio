import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.match(page, /COOLED FAST · Turbo 6 步／分段降溫/);
  assert.match(page, /第 1～6 步完成後各暫停 12 秒/);
  assert.match(page, /COOLED TURBO 8 · Turbo 8 步／每步降溫/);
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
  assert.match(styles, /grid-template-columns: repeat\(3,1fr\)/);
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

test("adds a low-VRAM profile and a 540P step between 480P and native", async () => {
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

  assert.match(page, /低顯存 · Turbo 6 步／LoRA merge/);
  assert.match(page, /低顯存 · Turbo 8 步／LoRA merge/);
  assert.match(page, /\{sizeLabels\.p540\} · 540P/);
  assert.match(comfy, /p540: \{ "16:9": \[960, 544\], "9:16": \[544, 960\], "1:1": \[736, 736\] \}/);
  assert.match(comfy, /p540: 960 \* 544/);
  assert.match(api, /"quality", "safe-long", "low-vram"/);
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
  assert.match(page, /setProfile\(video\.profile\)/);
  assert.match(page, /setResolution\(video\.resolution\)/);
  assert.match(page, /setSoundEnabled\(video\.sound\)/);
  assert.match(page, /restoreInputImage/);
  assert.doesNotMatch(page, /async function redoVideo[\s\S]*?\bgenerate\(\)/);
  assert.match(styles, /\.menu-popover \.redo-action/);
  assert.match(styles, /\.notice\.success/);
  assert.match(comfy, /sourceMode: runOptions\.sourceMode/);
  assert.match(comfy, /firstImagePath: runOptions\.inputMode/);
  assert.match(comfy, /lastImagePath: runOptions\.inputMode/);
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
  // Reference images do not, so they crop freely.
  assert.match(page, /aspect=\{cropTarget\.kind === "reference" \? undefined : CROP_ASPECT\[aspect\]\}/);
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
    const follow = new Set(["MiniMaxH3TurboLoRA", "MiniMaxH3MemoryEfficientSageAttentionPatch"]);
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
    for (const id of ["120", "600", "601", "602"]) assert.equal(graph[id].inputs.low_vram, true);
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
