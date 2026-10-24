import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkflow, buildReferenceWorkflow, buildImageWorkflow, createVideo, getRecentVideos, getAvailableLoras, SINGULARITY_MODEL, SINGULARITY_TURBO_LORA, TURBO_LORA } from "../lib/comfy.ts";

const base = { prompt: "A person waves.", resolution: "safe", duration: 5, aspect: "16:9", sound: true, seed: 42 };

test("Singularity pairs Euler and LightX2V with explicit shifts across modes, steps and anchors", () => {
  for (const [profile, steps] of [["cooled-turbo-4", 4], ["fast", 6], ["cooled-turbo-8", 8]]) {
    for (const anchors of [[], ["first.png"], [undefined, "last.png"], ["first.png", "last.png"]]) {
      for (const reference of [false, true]) {
        const options = { ...base, profile, h3Model: "singularity-v2", extraLoras: [{ name: "style.safetensors", strength: 0.5 }] };
        const graph = reference ? buildReferenceWorkflow(options, ["ref.png"], undefined, ...anchors) : buildWorkflow(options, ...anchors);
        assert.equal(graph["6"].inputs.unet_name, SINGULARITY_MODEL);
        assert.deepEqual(graph["125"].inputs, { model: ["6", 0], shift_video: 12, shift_audio: 3 });
        assert.deepEqual(graph["9"].inputs.model, ["125", 0]);
        assert.equal(graph["9"].inputs.steps, steps);
        assert.deepEqual(graph["120"].inputs, { model: ["125", 0], lora_name: SINGULARITY_TURBO_LORA, strength_model: 1 });
        assert.equal(graph["121"].inputs.sampler_name, "euler");
        assert.equal(graph["122"].class_type, "H3CooledSampler");
        assert.deepEqual(graph["600"].inputs.model, ["120", 0]);
        assert.deepEqual(graph["119"].inputs.model, ["600", 0]);
        assert(!Object.values(graph).some((n) => n.class_type === "MiniMaxH3TurboLoRA"));
        if (reference) {
          assert.deepEqual(graph["104"].inputs.image_1, ["200", 0]);
          assert.equal(Boolean(graph["212"]), Boolean(anchors[0]));
          assert.equal(Boolean(graph["213"]), Boolean(anchors[1]));
          if (anchors[1]) assert.equal(graph["213"].inputs.frame_idx, -1);
        } else {
          assert.equal(Boolean(graph["130"]), Boolean(anchors[0]));
          assert.equal(Boolean(graph["131"]), Boolean(anchors[1]));
        }
      }
    }
  }
  const quality = buildWorkflow({ ...base, profile: "quality", h3Model: "singularity-v2" });
  assert.equal(quality["120"], undefined);
  assert.equal(quality["9"].inputs.steps, 20);
  assert.deepEqual(quality["119"].inputs.model, ["125", 0]);
  for (const name of [TURBO_LORA, SINGULARITY_TURBO_LORA]) assert.throws(() => buildWorkflow({ ...base, profile: "fast", h3Model: "singularity-v2", extraLoras: [{ name, strength: 1 }] }), /疊加/);
  assert.throws(() => buildWorkflow({ ...base, profile: "safe-long", h3Model: "singularity-v2" }), /4／6／8/);
  assert.throws(() => buildWorkflow({ ...base, profile: "fast", h3Model: "unknown" }), /未知/);
  assert.deepEqual(buildWorkflow({ ...base, profile: "fast", h3Model: "original" }), buildWorkflow({ ...base, profile: "fast" }));
  assert.deepEqual(buildImageWorkflow({ ...base, profile: "fast", h3Model: "singularity-v2" }), buildImageWorkflow({ ...base, profile: "fast" }));
});

test("model survives output metadata, graph history and extension; legacy extensions retain original", async () => {
  const previous = globalThis.fetch;
  const graphs = [], saved = [];
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    if (path === "/upload/image") return Response.json({ name: "ref.png" });
    if (path === "/h3-studio/continuation-frame") return Response.json({ name: "tail.png" });
    if (path === "/prompt") { graphs.push(JSON.parse(init.body).prompt); return Response.json({ prompt_id: `sing-${graphs.length}` }); }
    if (path.startsWith("/history/")) {
      const id = path.split("/").pop();
      return Response.json({ [id]: { status: { completed: true }, outputs: { out: { videos: [{ filename: `${id}.mp4`, subfolder: "video", type: "output" }] } } } });
    }
    if (path === "/h3-studio/output-metadata") { saved.push(JSON.parse(init.body)); return Response.json({ ok: true }); }
    if (path === "/h3-studio/concat") return Response.json({ ...JSON.parse(init.body).metadata, filename: "extended.mp4", subfolder: "video", type: "output" });
    if (path === "/history") return Response.json({ test: { prompt: [0, "test", graphs.at(-1)], outputs: { out: { videos: [{ filename: "history.mp4", subfolder: "video", type: "output" }] } } } });
    if (path === "/h3-studio/outputs") return Response.json({ outputs: [{ filename: "history.mp4", subfolder: "video", type: "output" }] });
    if (path === "/object_info/H3StudioLoRA") return Response.json({ H3StudioLoRA: { input: { required: { lora_name: [[TURBO_LORA, SINGULARITY_TURBO_LORA, "style.safetensors"]] } } } });
    throw new Error(path);
  };
  try {
    const original = await createVideo({ ...base, profile: "cooled-turbo-4", h3Model: "singularity-v2" }, null, null, () => {});
    assert.equal(saved[0].h3Model, "singularity-v2");
    assert.equal((await getRecentVideos())[0].h3Model, "singularity-v2");
    assert.deepEqual(await getAvailableLoras(), ["style.safetensors"]);
    const continued = await createVideo({ ...base, profile: "fast", h3Model: "original", continuationSource: original }, null, null, () => {});
    assert.equal(continued.h3Model, "singularity-v2");
    assert.equal(graphs[1]["6"].inputs.unet_name, SINGULARITY_MODEL);
    assert.equal(graphs[1]["120"], undefined, "standard extension retains native QUALITY path");
    await createVideo({ ...base, profile: "fast", h3Model: "singularity-v2", continuationSource: { ...original, h3Model: undefined } }, null, null, () => {});
    assert.notEqual(graphs[2]["6"].inputs.unet_name, SINGULARITY_MODEL);
    const referenced = await createVideo({ ...base, profile: "cooled-turbo-4", h3Model: "singularity-v2", inputMode: "reference", sourceMode: "reference" }, null, null, () => {}, [{ file: new File(["image"], "ref.png"), label: "person", description: "Adult person" }]);
    assert.equal((await getRecentVideos())[0].h3Model, "singularity-v2");
    const refExtended = await createVideo({ ...base, profile: "fast", h3Model: "original", continuationSource: referenced }, null, null, () => {});
    assert.equal(refExtended.h3Model, "singularity-v2");
    assert.equal(graphs.at(-1)["9"].inputs.steps, 4);
    assert.equal(graphs.at(-1)["120"].inputs.lora_name, SINGULARITY_TURBO_LORA);
  } finally { globalThis.fetch = previous; }
});
