import { DEFAULT_COOLDOWN_SECONDS, GeneratedVideo, MIN_COOLDOWN_SECONDS, request, resolveOutputDimensions, TURBO_LORA, waitForResult } from "./comfy";

export const SWAP_LORAS = {
  head: "minimax_h3_head_swap_v1.0_r32.safetensors",
  character: "minimax_h3_character_swap_v1.0_ref2va_r64_gl.safetensors",
  "akatz-v1.5": "h3_character_swap_v1.5.safetensors",
  "untmods-face": "SS_FaceSwap_MiniMax_H3_REF2VA.safetensors",
} as const;
export const UNTMODS_TURBO_LORA = "minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors";
export type SwapMode = keyof typeof SWAP_LORAS;
export const SWAP_LABELS: Record<SwapMode, string> = {
  head: "BFS 換頭",
  character: "BFS 整個角色替換",
  "akatz-v1.5": "Akatz V1.5 整個角色替換",
  "untmods-face": "UntMods FaceSwap 臉部替換",
};
export type SwapResolution = "p480" | "p540" | "native";
export type SwapOptions = { mode: SwapMode; steps: 4 | 6 | 8 | 20; resolution: SwapResolution; prompt: string; strength: number; seed: number; cooldownSeconds: number; target?: string };
export type SwapInput = { sourceId: string; sourceName: string; sourceFile: string; referenceFile: string; width: number; height: number; duration: number; segments: { inputFile: string; keepFrames: number; length?: number }[] };
export type SwapControl = { stop: boolean };
/** Longest source span one H3 pass covers; longer sources are split into pieces this long. */
export const SWAP_SEGMENT_SECONDS = 15;

export function buildSwapPrompt(mode: SwapMode, target = "the main person") {
  if (mode === "untmods-face") return `Faceswap. Replace the facial identity of ${target.trim() || "the main person"} in <Video 1> with the face from <Picture 1>. Follow the source facial expressions, gaze, head orientation and movement. Preserve the original hairstyle, body, clothing, scene, camera and all other people. Keep a consistent face with natural scale and lighting. Do not import the reference background or display a reference sheet.`;
  if (mode === "akatz-v1.5") return `Replace ${target.trim() || "the main person"} in <Video 1> with the character in <Picture 1>. Keep the reference character's face, hair, body proportions, clothing and visual style. Follow the source performance's pose, gaze, expression and movement. Preserve the scene and the other people. Do not import the reference background or display a reference sheet.`;
  const head = mode === "head";
  return `${head ? "head_swap:" : "body_swap:"}

subject_definitions:
<Subject 1> is the replacement ${head ? "head identity, facial structure, hairline and hairstyle" : "character, including appearance, hairstyle, body proportions, outfit and visual style"} from <Picture 1>.
<Subject 2> is ${target.trim() || "the main person"} in the aligned source guide <Video 1>.
<Video 1> is the source video connected through Add Guide, providing the scene, camera and performance.

summary:
[video editing + reference generation] Replace only ${head ? "the head of" : "the selected character"} <Subject 2> with <Subject 1>.

retention_analysis:
<Subject 1>: attribute_transfer - transfer ${head ? "only facial identity, head shape and hairstyle" : "the complete character identity, proportions, hairstyle, clothing and visual style"} from <Picture 1>.
<Subject 2>: partially_preserved - retain the original position, scale, pose, motion, expressions, gaze and timing${head ? ", including the original body, clothing, accessories and all outfit changes" : ""}.
<Video 1>: partially_preserved - keep background, foreground objects, lighting, camera, timing and all other people.

detailed_description:
Follow the source guide frame by frame throughout its entire timeline. Replace ${head ? "only the complete head, face and hairstyle" : "only the selected person"} with the reference identity from <Picture 1>. Match the original movements, facial expressions, head orientation, perspective and occlusions. ${head ? "Keep the source body, body proportions, neck, hands, clothing and shoes unchanged. Do not copy the reference image's body or outfit." : "Use the reference character's appearance and outfit while matching the source performance and interactions."} Maintain a stable identity and natural scale, with lighting that matches the source scene. Preserve all other people and objects. Do not import the reference background or display a reference sheet. Preserve original transitions and do not add camera movement or cuts.

overall_soundscape:
N/A

non_diegetic_music:
N/A`;
}

export function swapDimensions(resolution: SwapResolution, width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error("請先讀取有效的來源影片尺寸。");
  return resolveOutputDimensions({ resolution, aspect: "16:9", sourceWidth: width, sourceHeight: height });
}

export function buildSwapWorkflow(source: SwapInput, segment: number, options: SwapOptions) {
  if (!SWAP_LORAS[options.mode] || ![4, 6, 8, 20].includes(options.steps) || (options.mode === "akatz-v1.5" && options.steps !== 20) || (options.mode === "untmods-face" && ![8, 20].includes(options.steps)) || !["p480", "p540", "native"].includes(options.resolution)
      || !options.prompt.trim() || !Number.isFinite(options.strength) || options.strength < 0 || options.strength > 2
      || !Number.isSafeInteger(options.seed) || options.seed < 0 || !Number.isInteger(options.cooldownSeconds) || options.cooldownSeconds < MIN_COOLDOWN_SECONDS || options.cooldownSeconds > 600
      || (options.target !== undefined && (typeof options.target !== "string" || options.target.length > 2000))) throw new Error("影片換角設定無效。");
  const [width, height] = swapDimensions(options.resolution, source.width, source.height);
  const prompt = options.target?.trim() ? `${options.prompt}\n\nTarget selection: replace only ${options.target.trim()} in the source guide. Keep all other people unchanged.` : options.prompt;
  const node = (class_type: string, inputs: Record<string, unknown>) => ({ class_type, inputs });
  const turbo = options.steps !== 20;
  const untmods = options.mode === "untmods-face";
  const graph: Record<string, ReturnType<typeof node>> = {
    "1": node("UNETLoader", { unet_name: "minimax_h3_ref2va_pruned_w4a8_mixed.safetensors", weight_dtype: "default" }),
    "2": node("LoraLoaderModelOnly", { model: [turbo ? "25" : "1", 0], lora_name: SWAP_LORAS[options.mode], strength_model: options.strength }),
    "3": node("MiniMaxH3MemoryEfficientSageAttentionPatch", { model: ["2", 0] }),
    "4": node("MiniMaxChunkFeedForward", { model: ["3", 0], chunks: 4, seq_threshold: 4096 }),
    "5": node("MiniMaxLowVRAMAttention", { model: ["4", 0], head_chunks: 4 }),
    "6": node("MiniMaxH3SigmaShift", { model: ["5", 0], shift_video: 12, shift_audio: 3 }),
    "7": node("CLIPLoader", { clip_name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", type: "minimax", device: "default" }),
    "8": node("VAELoader", { vae_name: "minimax_h3_video_vae_int8_convrot.safetensors" }),
    "9": node("VAELoader", { vae_name: "minimax_h3_audio_vae_fp32.safetensors" }),
    "10": node("LoadImage", { image: source.referenceFile }),
    "11": node("LoadVideo", { file: source.segments[segment].inputFile }),
    "12": node("GetVideoComponents", { video: ["11", 0] }),
    "13": node("MiniMaxH3ReferenceToVideo", { clip: ["7", 0], vae: ["8", 0], audio_vae: ["9", 0], prompt, width, height, length: source.segments[segment].length ?? 124, ref_image_size: "match", "ref_images.ref_image_0": ["10", 0] }),
    "14": node("MiniMaxH3AddGuide", { positive: ["13", 0], latent: ["13", 1], vae: ["8", 0], image: ["12", 0], frame_idx: 0 }),
    "15": node("BasicGuider", { model: ["6", 0], conditioning: ["14", 0] }),
    "16": node(turbo && !untmods ? "MiniMaxH3TurboSampler" : "KSamplerSelect", turbo && !untmods ? {} : { sampler_name: "res_multistep" }),
    "17": node(turbo && !untmods ? "H3CooledTurboSampler" : "H3CooledSampler", { sampler: ["16", 0], seconds: options.cooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS, skip_last: true }),
    "18": node("BasicScheduler", { model: ["6", 0], scheduler: "simple", steps: options.steps, denoise: 1 }),
    "19": node("RandomNoise", { noise_seed: options.seed }),
    "20": node("SamplerCustomAdvanced", { noise: ["19", 0], guider: ["15", 0], sampler: ["17", 0], sigmas: ["18", 0], latent_image: ["13", 1] }),
    "21": node("LTXVSeparateAVLatent", { av_latent: ["20", 0] }),
    "22": node("VAEDecodeTiled", { samples: ["21", 0], vae: ["8", 0], tile_size: 256, overlap: 64, temporal_size: 32, temporal_overlap: 8 }),
    "23": node("CreateVideo", { images: ["22", 0], fps: 24, bit_depth: 8 }),
    "24": node("SaveVideo", { video: ["23", 0], filename_prefix: `h3_swap_cache/${source.sourceId}_seg${segment}`, format: "mp4", "format.codec": "h264" }),
  };
  if (options.mode === "akatz-v1.5" || untmods) {
    graph["13"].inputs["ref_videos.ref_video_0"] = ["12", 0];
    graph["15"].inputs.conditioning = ["13", 0];
    delete graph["14"];
  }
  if (turbo) graph["25"] = untmods
    ? node("LoraLoaderModelOnly", { model: ["1", 0], lora_name: UNTMODS_TURBO_LORA, strength_model: 1 })
    : node("MiniMaxH3TurboLoRA", { model: ["1", 0], lora_name: TURBO_LORA, strength: 1, low_vram: true });
  return graph;
}

export async function runSwap(video: File, reference: File, dimensions: { width: number; height: number }, options: SwapOptions, control: SwapControl, onStatus: (message: string) => void) {
  const [width, height] = swapDimensions(options.resolution, dimensions.width, dimensions.height);
  // Validate the complete settings before uploading files or submitting GPU work.
  buildSwapWorkflow({ sourceId: "check", referenceFile: "check.png", sourceFile: "check.mp4", sourceName: "check", duration: 1, ...dimensions, segments: [{ inputFile: "check.mp4", keepFrames: 22 }] }, 0, options);
  const info = await (await request("/object_info/LoraLoaderModelOnly")).json();
  const installed = info.LoraLoaderModelOnly?.input?.required?.lora_name?.[0] ?? [];
  for (const name of [SWAP_LORAS[options.mode], ...(options.steps !== 20 ? [options.mode === "untmods-face" ? UNTMODS_TURBO_LORA : TURBO_LORA] : [])]) {
    if (!installed.includes(name)) throw new Error(`尚未安裝換角所需 LoRA：${name}`);
  }
  if (control.stop) throw new Error("已取消影片換角。");
  onStatus("正在準備來源影片與分段…");
  const form = new FormData();
  form.append("video", video); form.append("reference", reference);
  form.append("settings", JSON.stringify({ ...options, width, height }));
  const source = await (await request("/h3-studio/swap/prepare", { method: "POST", body: form })).json() as SwapInput;
  const results: GeneratedVideo[] = [];
  let failure: unknown;
  const began = Date.now();
  for (let segment = 0; segment < source.segments.length; segment++) {
    if (control.stop) break;
    const prefix = `影片換角 · 第 ${segment + 1}／${source.segments.length} 段`;
    onStatus(`${prefix} · 正在提交…`);
    try {
      const response = await (await request("/prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: buildSwapWorkflow(source, segment, options), client_id: crypto.randomUUID() }) })).json();
      if (!response.prompt_id) throw new Error(`換角工作流無法執行：${JSON.stringify(response.node_errors ?? response.error)}`);
      results.push(await waitForResult(response.prompt_id, (status) => onStatus(`${prefix} · ${status}`)));
    } catch (error) { failure = error; break; }
  }
  if (!results.length) throw failure ?? new Error("已停止，尚無完成的片段。");
  onStatus(`正在合併 ${results.length} 段並保留原音軌…`);
  const result = await (await request("/h3-studio/swap/finish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId: source.sourceId, results, generationSeconds: Math.round((Date.now() - began) / 1000) }) })).json() as GeneratedVideo;
  return { result, warning: failure ? `後續生成失敗，已保留前 ${results.length} 段：${failure instanceof Error ? failure.message : String(failure)}` : "" };
}
