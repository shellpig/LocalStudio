// Real GPU smoke test. Run steps=4 successfully before trying 6 or 8.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { buildWorkflow, buildReferenceWorkflow } from "../h3-local-studio/lib/comfy.ts";

const steps = Number(process.argv[2] || 4);
const mode = process.argv[3] || "text";
const image = process.argv[4];
assert([4, 6, 8].includes(steps));
assert(["text", "image", "reference", "anchors"].includes(mode));
assert(mode === "text" || image, "Pass a ComfyUI input filename for image/reference tests");
const folder = new URL("../work/singularity-v2/", import.meta.url);
await mkdir(folder, { recursive: true });
const tag = `${mode}-${steps}`;
const request = async (path, body) => {
  const r = await fetch(`http://127.0.0.1:8188${path}`, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(data));
  return data;
};
const queue = await request("/queue");
assert(!queue.queue_running.length && !queue.queue_pending.length, "ComfyUI queue must be idle");
const options = {
  prompt: "integrated_multimodal_description: [Shot 1] Photorealistic medium full shot of an adult woman wearing a red scarf and a plain blue jacket in a quiet sunlit park. She walks two steps at normal speed, stops, turns toward the camera and waves once. Natural skin texture, stable face and clothing, static camera, one continuous shot.\n\noverall_soundscape: Light footsteps and gentle wind through trees. No dialogue.\n\nnon_diegetic_music: N/A",
  h3Model: "singularity-v2", profile: steps === 4 ? "cooled-turbo-4" : steps === 6 ? "fast" : "cooled-turbo-8",
  resolution: "safe", outputWidth: 608, outputHeight: 352, duration: 5, aspect: "16:9", sound: true, seed: 556589502035082,
  cooldownSeconds: 15, attentionMethod: "sage", chainId: `singularity-${tag}`, latentPath: `h3_context/singularity-${tag}`,
};
if (mode === "reference" || mode === "anchors") options.prompt = options.prompt.replace("an adult woman", "the adult woman from <Picture 1>");
const graph = mode === "reference" || mode === "anchors"
  ? buildReferenceWorkflow(options, [image], undefined, mode === "anchors" ? image : undefined, mode === "anchors" ? image : undefined)
  : buildWorkflow(options, mode === "image" ? image : undefined, mode === "image" ? image : undefined);
graph["92"].inputs.filename_prefix = `video/Singularity_V2_Test_${tag}`;
await writeFile(new URL(`${tag}-graph.json`, folder), JSON.stringify(graph, null, 2));
const start = Date.now();
const submitted = await request("/prompt", { prompt: graph, client_id: `singularity-smoke-${tag}` });
assert(submitted.prompt_id, JSON.stringify(submitted));
console.log(JSON.stringify({ tag, promptId: submitted.prompt_id }));
let last = 0;
for (;;) {
  const history = await request(`/history/${submitted.prompt_id}`);
  const entry = history[submitted.prompt_id];
  if (entry) {
    await writeFile(new URL(`${tag}-history.json`, folder), JSON.stringify(entry, null, 2));
    if (entry.status?.status_str === "error") throw new Error(JSON.stringify(entry.status.messages));
    if (entry.status?.completed) {
      const files = Object.values(entry.outputs).flatMap((out) => Object.values(out).filter(Array.isArray).flat()).filter((file) => file?.filename?.endsWith(".mp4"));
      assert(files.length, "No MP4 output");
      const file = files[0];
      const output = new URL(`../ComfyUI/output/${file.subfolder}/${file.filename}`, import.meta.url);
      const { fileURLToPath } = await import("node:url");
      const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", fileURLToPath(output)], { encoding: "utf8" }));
      const video = probe.streams.find((s) => s.codec_type === "video");
      assert.equal(video.width, 608); assert.equal(video.height, 352);
      assert(probe.streams.some((s) => s.codec_type === "audio"));
      assert(Number(probe.format.duration) >= 5);
      execFileSync("ffmpeg", ["-v", "error", "-i", fileURLToPath(output), "-f", "null", "-"], { stdio: "pipe" });
      const result = { tag, seconds: (Date.now() - start) / 1000, output: fileURLToPath(output), probe };
      await request("/h3-studio/output-metadata", {
        ...file, h3Model: options.h3Model, profile: options.profile, resolution: options.resolution,
        prompt: options.prompt, seed: options.seed, cooldownSeconds: options.cooldownSeconds,
        generationSeconds: Math.round(result.seconds), width: 608, height: 352, sound: true,
        duration: 5, aspect: "16:9", sourceMode: mode === "text" ? "text" : mode === "image" ? "image" : "reference",
        inputMode: mode === "text" || mode === "image" ? "standard" : "reference",
        ...(mode === "image" || mode === "anchors" ? { firstImagePath: image, lastImagePath: image } : {}),
        ...(mode === "reference" || mode === "anchors" ? { referenceFiles: [image], referenceDefinitions: [{ label: "person", description: "Adult woman" }] } : {}),
      });
      await writeFile(new URL(`${tag}-result.json`, folder), JSON.stringify(result, null, 2));
      console.log(JSON.stringify({ tag, seconds: result.seconds, output: result.output, frames: video.nb_frames, audio: true, decoded: true }));
      break;
    }
  }
  if (Date.now() - last >= 45000) { console.log(`${tag}: waiting, elapsed ${Math.round((Date.now() - start) / 1000)}s`); last = Date.now(); }
  await new Promise((resolve) => setTimeout(resolve, 3000));
}
