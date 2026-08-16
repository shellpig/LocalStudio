const COMFY_URL = "http://127.0.0.1:8188";

type GraphNode = { class_type: string; inputs: Record<string, unknown>; _meta?: { title: string } };
type PromptGraph = Record<string, GraphNode>;

export type GenerationOptions = {
  prompt: string;
  profile: "fast" | "cooled-fast" | "cooled-turbo-8" | "quality" | "safe-long";
  resolution: "safe" | "clear" | "p480" | "native";
  sourceMode?: "text" | "image" | "reference";
  inputMode?: "standard" | "reference";
  duration: number;
  aspect: "16:9" | "9:16" | "1:1";
  sound: boolean;
  sourceWidth?: number;
  sourceHeight?: number;
  outputWidth?: number;
  outputHeight?: number;
  chainId?: string;
  clipIndex?: number;
  latentPath?: string;
  continuationSource?: GeneratedVideo;
};

export type GeneratedVideo = {
  filename: string;
  subfolder: string;
  type: string;
  generationSeconds?: number;
  promptId?: string;
  modifiedAt?: number;
  chainId?: string;
  clipIndex?: number;
  latentPath?: string;
  profile?: GenerationOptions["profile"];
  resolution?: GenerationOptions["resolution"];
  width?: number;
  height?: number;
  sound?: boolean;
  prompt?: string;
  extendable?: boolean;
  duration?: number;
  aspect?: GenerationOptions["aspect"];
  sourceMode?: GenerationOptions["sourceMode"];
  firstImagePath?: string;
  lastImagePath?: string;
  inputMode?: "standard" | "reference";
  referenceFiles?: string[];
  referenceDefinitions?: ReferenceDefinition[];
};

export type OptimizedPrompt = {
  prompt: string;
  mode: "T2VA" | "I2VA" | "FL2VA" | "L2VA" | "Ref2VA";
};

export type ReferenceImageInput = {
  file: File;
  label: string;
  description: string;
};

export type ReferenceDefinition = Pick<ReferenceImageInput, "label" | "description">;

const DIMENSIONS = {
  safe: { "16:9": [608, 352], "9:16": [352, 608], "1:1": [448, 448] },
  clear: { "16:9": [736, 416], "9:16": [416, 736], "1:1": [544, 544] },
  p480: { "16:9": [864, 480], "9:16": [480, 864], "1:1": [640, 640] },
  native: { "16:9": [1344, 768], "9:16": [768, 1344], "1:1": [1024, 1024] },
} as const;

const TARGET_PIXELS = {
  safe: 608 * 352,
  clear: 736 * 416,
  p480: 864 * 480,
  native: 1344 * 768,
} as const;

const SAFE_LONG_DIMENSIONS = {
  "16:9": [640, 352],
  "9:16": [352, 640],
  "1:1": [480, 480],
} as const;

function dimensionsForSource(sourceWidth: number, sourceHeight: number, targetPixels: number): [number, number] {
  const sourceRatio = sourceWidth / sourceHeight;
  let best: [number, number] = [640, 640];
  let bestScore = Number.POSITIVE_INFINITY;
  for (let width = 128; width <= 1344; width += 32) {
    for (let height = 128; height <= 1344; height += 32) {
      const areaError = Math.abs(Math.log((width * height) / targetPixels));
      const ratioError = Math.abs(Math.log((width / height) / sourceRatio));
      const score = areaError + ratioError * 2;
      if (score < bestScore) {
        best = [width, height];
        bestScore = score;
      }
    }
  }
  return best;
}

export function resolveOutputDimensions(options: Pick<GenerationOptions, "resolution" | "aspect" | "sourceWidth" | "sourceHeight" | "outputWidth" | "outputHeight">): [number, number] {
  if (options.outputWidth && options.outputHeight) return [options.outputWidth, options.outputHeight];
  if (!options.sourceWidth || !options.sourceHeight) return [...DIMENSIONS[options.resolution][options.aspect]];

  return dimensionsForSource(options.sourceWidth, options.sourceHeight, TARGET_PIXELS[options.resolution]);
}

export function resolveGenerationDimensions(options: GenerationOptions): [number, number] {
  if (options.profile !== "safe-long") return resolveOutputDimensions(options);
  if (!options.sourceWidth || !options.sourceHeight) return [...SAFE_LONG_DIMENSIONS[options.aspect]];
  return dimensionsForSource(options.sourceWidth, options.sourceHeight, 640 * 352);
}

function node(classType: string, inputs: Record<string, unknown>, title: string): GraphNode {
  return { class_type: classType, inputs, _meta: { title } };
}

function frameCount(seconds: number, continuation: boolean) {
  if (continuation) return Math.max(1, Math.round(seconds * 24 / 17)) * 17 + 22;
  if (seconds === 1) return 22;
  if (seconds === 2) return 56;
  let frames = Math.max(5, Math.round(seconds * 24));
  while (frames % 17 !== 5) frames += 1;
  return frames;
}

export function buildWorkflow(options: GenerationOptions, uploadedFirstImage?: string, uploadedLastImage?: string): PromptGraph {
  const [width, height] = resolveGenerationDimensions(options);
  const quality = options.profile === "quality";
  const cooledFast = options.profile === "cooled-fast";
  const cooledTurbo8 = options.profile === "cooled-turbo-8";
  const safeLong = options.profile === "safe-long";
  const continuation = options.continuationSource;
  const chainId = options.chainId ?? "preview";
  const clipIndex = options.clipIndex ?? 1;
  const latentPath = options.latentPath ?? `h3_context/${chainId}`;
  const graph: PromptGraph = {
    "6": node("UNETLoader", { unet_name: "minimax_h3_fl2va_pruned_int8_convrot.safetensors", weight_dtype: "default" }, "H3 模型"),
    "9": node("BasicScheduler", { model: ["6", 0], scheduler: "simple", steps: quality ? 20 : cooledTurbo8 ? 8 : 6, denoise: 1 }, "採樣排程"),
    "10": safeLong
      ? node("VAEDecodeTiled", { samples: ["14", 0], vae: ["11", 0], tile_size: 512, overlap: 64, temporal_size: 32, temporal_overlap: 8 }, "分塊解碼影像")
      : node("VAEDecode", { samples: ["14", 0], vae: ["11", 0] }, "解碼影像"),
    "11": node("VAELoader", { vae_name: quality ? "minimax_h3_video_vae_fp16.safetensors" : "minimax_h3_video_vae_int8_convrot.safetensors" }, "影片 VAE"),
    "13": node("CLIPLoader", { clip_name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", type: "minimax", device: "default" }, "文字編碼器"),
    "14": node("SamplerCustomAdvanced", { noise: ["15", 0], guider: ["16", 0], sampler: quality ? ["123", 0] : cooledFast || cooledTurbo8 ? ["122", 0] : ["121", 0], sigmas: ["9", 0], latent_image: ["104", 1] }, "H3 採樣"),
    "15": node("RandomNoise", { noise_seed: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER) }, "隨機種子"),
    "16": node("BasicGuider", { model: ["119", 0], conditioning: ["104", 0] }, "引導"),
    "23": node("VAEDecodeAudio", { samples: ["14", 0], vae: ["24", 0] }, "解碼聲音"),
    "24": node("VAELoader", { vae_name: "minimax_h3_audio_vae_fp32.safetensors" }, "聲音 VAE"),
    "91": node("CreateVideo", { images: ["10", 0], audio: ["23", 0], fps: 24, bit_depth: 8 }, "建立影片"),
    "92": node("SaveVideo", { video: ["91", 0], filename_prefix: continuation ? `h3_segments/${chainId}/H3_Studio_Segment` : "video/H3_Studio", format: "auto", codec: "auto" }, "儲存影片"),
    "104": node("MiniMaxH3ImageToVideo", {
      clip: ["13", 0], vae: ["11", 0], prompt: options.prompt, width, height, length: frameCount(options.duration, Boolean(continuation)),
    }, "MiniMax H3 圖片轉影片"),
    "119": node("MiniMaxH3MemoryEfficientSageAttentionPatch", { model: quality ? ["6", 0] : ["120", 0] }, "SageAttention 省顯存"),
    "140": node("MiniMaxH3MotionContextSaveLatent", { latent: ["14", 0], filename_prefix: `${latentPath}/clip`, clip_index: clipIndex }, "保存延伸資料"),
  };

  if (quality) {
    graph["17"] = node("KSamplerSelect", { sampler_name: "res_multistep" }, "原生採樣器");
    graph["123"] = node("H3CooledSampler", { sampler: ["17", 0] }, "H3 QUALITY 冷卻採樣器");
  } else {
    graph["120"] = node("MiniMaxH3TurboLoRA", { model: ["6", 0], lora_name: "minimax_h3_turbo_v4_step600_ema.safetensors", strength: 1, low_vram: safeLong }, "H3 Turbo LoRA");
    graph["121"] = node("MiniMaxH3TurboSampler", {}, "H3 Turbo 採樣器");
    if (cooledFast || cooledTurbo8) graph["122"] = node("H3CooledTurboSampler", { sampler: ["121", 0] }, "H3 冷卻採樣器");
  }

  if (!options.sound) {
    delete graph["23"];
    delete graph["24"];
    delete graph["91"].inputs.audio;
  }

  if (safeLong) delete graph["140"];

  if (continuation) {
    graph["141"] = node("MiniMaxH3MotionContextLoadLatent", { latent_path: latentPath, clip_index: continuation.clipIndex }, "載入上一段延伸資料");
    graph["142"] = node("MiniMaxH3MotionContext", {
      conditioning: ["104", 0], vae: ["11", 0], latent: ["104", 1], context_length: "22", audio_context_length: 22, context_latent: ["141", 0],
    }, "延續上一段動態");
    graph["143"] = node("MiniMaxH3MotionContextTrim", {
      images: ["10", 0], trim_frames: ["142", 1], fps: 24, match_tail: true,
      ...(options.sound ? { audio: ["23", 0] } : {}),
    }, "移除重複接縫");
    graph["16"].inputs.conditioning = ["142", 0];
    graph["91"].inputs.images = ["143", 0];
    if (options.sound) graph["91"].inputs.audio = ["143", 1];
  }

  if (uploadedFirstImage) {
    graph["130"] = node("LoadImage", { image: uploadedFirstImage }, "首幀圖片");
    graph["104"].inputs.first_frame = ["130", 0];
  }
  if (uploadedLastImage) {
    graph["131"] = node("LoadImage", { image: uploadedLastImage }, "尾幀圖片");
    graph["104"].inputs.last_frame = ["131", 0];
  }
  return graph;
}

export function buildReferencePrompt(prompt: string, references: ReferenceDefinition[]) {
  let detailedDescription = prompt.trim();
  const indexedReferences = references.map((reference, index) => ({
    ...reference,
    label: reference.label.replace(/^@+/, "").trim(),
    index: index + 1,
  }));
  for (const reference of [...indexedReferences].sort((left, right) => right.label.length - left.label.length)) {
    const escaped = reference.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    detailedDescription = detailedDescription.replace(new RegExp(`@${escaped}(?![\\p{L}\\p{N}_-])`, "gu"), `<Subject ${reference.index}>`);
  }
  const definitions = indexedReferences.map((reference) => {
    const description = reference.description.trim();
    return `<Subject ${reference.index}> is the referenced content labeled @${reference.label} from <Picture ${reference.index}>.${description ? ` ${description}` : " Use the clearly visible identity, appearance, or environment in the picture according to the label."}`;
  });
  return `subject_definitions:\n${definitions.join("\n")}\n\ndetailed_description:\n${detailedDescription}`;
}

export function buildReferenceWorkflow(options: GenerationOptions, uploadedReferenceImages: string[], continuationFrame?: string): PromptGraph {
  if (continuationFrame && uploadedReferenceImages.length > 8) {
    throw new Error("Ref2VA 延伸最多可沿用 8 張參考圖。 ");
  }
  const [width, height] = resolveGenerationDimensions(options);
  const continuation = Boolean(continuationFrame);
  const graph: PromptGraph = {
    "6": node("UNETLoader", { unet_name: "minimax_h3_ref2va_pruned_w4a8_mixed.safetensors", weight_dtype: "default" }, "H3 Ref2VA W4A8 模型"),
    "9": node("BasicScheduler", { model: ["6", 0], scheduler: "simple", steps: 8, denoise: 1 }, "Turbo 8 步排程"),
    "10": node("MiniMaxH3LatentLabLongMediaDecode", {
      final_av: ["150", 0], long_media_plan: ["104", 2], enable_tiling: true, tile_size: 256, width: 512,
      temporal_size: 32, batch_size: 1, color_match_strength: 0,
    }, "Long Media 解碼"),
    "11": node("VAELoader", { vae_name: "minimax_h3_video_vae_int8_convrot.safetensors" }, "影片 VAE"),
    "13": node("CLIPLoader", { clip_name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", type: "minimax", device: "default" }, "文字編碼器"),
    "16": node("BasicGuider", { model: ["119", 0], conditioning: ["104", 0] }, "引導"),
    "24": node("VAELoader", { vae_name: "minimax_h3_audio_vae_fp32.safetensors" }, "聲音 VAE"),
    "91": node("CreateVideo", { images: ["10", 0], audio: ["10", 1], fps: 24, bit_depth: 8 }, "建立影片"),
    "92": node("SaveVideo", { video: ["91", 0], filename_prefix: continuation ? `h3_segments/${options.chainId}/H3_Studio_Ref2VA_Segment` : "video/H3_Studio_Ref2VA", format: "auto", codec: "auto" }, "儲存影片"),
    "104": node("MiniMaxH3LatentLabLongMediaSetup", {
      clip: ["13", 0], vae: ["11", 0], audio_vae: ["24", 0], prompt: options.prompt,
      width, height, manual_duration: options.duration, duration_source: "manual", segment_seconds: 8,
      overlap_frames: 22, resolution_mode: "match", reference_budget: "low", video_fps: 24,
      video_mode: "auto", audio_mode: "generate", video_strength: 0.5, audio_strength: 0,
      generation_mode: "auto", first_frame_mode: "latent_inject", first_frame_denoise: 0.25,
      first_frame_blend_frames: 3, conditioning_mode: "auto_refs", workflow_mode: continuation ? "hybrid_auto" : "ref2va_full",
    }, continuation ? "Ref2VA 尾幀銜定延伸" : "Ref2VA 參考設定"),
    "119": node("MiniMaxH3MemoryEfficientSageAttentionPatch", { model: ["120", 0] }, "SageAttention 省顯存"),
    "120": node("MiniMaxH3TurboLoRA", { model: ["6", 0], lora_name: "minimax_h3_turbo_v4_step600_ema.safetensors", strength: 1, low_vram: false }, "H3 Turbo LoRA"),
    "121": node("MiniMaxH3TurboSampler", {}, "H3 Turbo 採樣器"),
    "122": node("H3CooledTurboSampler", { sampler: ["121", 0] }, "每步休息 12 秒"),
    "150": node("MiniMaxH3LatentLabLongMediaSampler", {
      initial_av: ["104", 1], long_media_plan: ["104", 2], guider: ["16", 0], sampler: ["122", 0],
      sigmas: ["9", 0], seed: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
      video_context_denoise: 0, audio_context_denoise: 0, offload_completed_segments: true,
      mlp_chunk_tokens: 4096, attention_mode: "existing", sol_tau_start: 1.3, sol_tau_end: 0.8,
      sol_curve: "linear", sol_min_tokens: 4096, sol_dense_percent: 0, sol_sink_conditioning: "exact_kv",
      sol_qkv_chunk_tokens: 8192, sol_out_proj_chunk_tokens: 24576, vram_activation_reserve_mb: 5120,
      inter_block_vram_guard_mb: 2048, inter_block_guard_cooldown_blocks: 4,
      inter_block_guard_emergency_mb: 512, inter_block_guard_emergency_cooldown_blocks: 3,
      late_block_guard_start: 40, late_block_guard_target_mb: 6144, late_block_guard_min_cached_mb: 512,
      step_boundary_cleanup_mb: 2048, sampler_mode: "manual",
    }, "Long Media 採樣"),
  };

  if (!options.sound) delete graph["91"].inputs.audio;
  if (continuationFrame) {
    graph["199"] = node("LoadImage", { image: continuationFrame }, "上一段最後一幀");
    graph["104"].inputs.image_1 = ["199", 0];
  }
  uploadedReferenceImages.forEach((image, index) => {
    const nodeId = String(200 + index);
    graph[nodeId] = node("LoadImage", { image }, `參考圖片 ${index + 1}`);
    graph["104"].inputs[`image_${index + (continuation ? 2 : 1)}`] = [nodeId, 0];
  });
  return graph;
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${COMFY_URL}${path}`, init);
  if (!response.ok) {
    let details = "";
    try {
      const body = await response.clone().json() as { error?: string };
      details = typeof body.error === "string" ? ` ${body.error}` : "";
    } catch {
      // Some ComfyUI endpoints return plain text on errors.
    }
    throw new Error(`ComfyUI 回應錯誤（${response.status}）。${details}`);
  }
  return response;
}

export async function checkConnection() {
  try {
    await request("/system_stats", { signal: AbortSignal.timeout(2500) });
    return true;
  } catch {
    return false;
  }
}

async function uploadImage(file: File) {
  const data = new FormData();
  data.append("image", file, `${crypto.randomUUID()}-${file.name}`);
  data.append("type", "input");
  data.append("overwrite", "true");
  const response = await request("/upload/image", { method: "POST", body: data });
  const result = (await response.json()) as { name: string; subfolder?: string };
  return result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
}

export async function optimizeVideoPrompt(
  brief: string,
  duration: number,
  sound: boolean,
  firstImage: File | null,
  lastImage: File | null,
  referenceImages: ReferenceImageInput[] = [],
) {
  const data = new FormData();
  data.append("brief", brief);
  data.append("duration", String(duration));
  data.append("sound", String(sound));
  if (firstImage) data.append("first_image", firstImage, firstImage.name);
  if (lastImage) data.append("last_image", lastImage, lastImage.name);
  if (referenceImages.length) {
    data.append("reference_manifest", JSON.stringify(referenceImages.map(({ label, description }) => ({ label, description }))));
    referenceImages.forEach((reference, index) => data.append(`reference_image_${index + 1}`, reference.file, reference.file.name));
  }
  const response = await request("/h3-studio/optimize-prompt", { method: "POST", body: data });
  return await response.json() as OptimizedPrompt;
}

function referenceDefinitionsFromPrompt(prompt: string, count: number): ReferenceDefinition[] {
  const definitions = new Map<number, ReferenceDefinition>();
  const pattern = /^<Subject (\d+)> is the referenced content labeled @([^\s]+) from <Picture \1>\.(.*)$/gm;
  for (const match of prompt.matchAll(pattern)) {
    definitions.set(Number(match[1]), { label: match[2], description: match[3].trim() });
  }
  return Array.from({ length: count }, (_, index) => definitions.get(index + 1) ?? {
    label: `參考${index + 1}`,
    description: "",
  });
}

function referenceMetadataFromHistory(entry: { prompt?: unknown }) {
  if (!Array.isArray(entry.prompt) || !entry.prompt[2] || typeof entry.prompt[2] !== "object") return {};
  const graph = entry.prompt[2] as PromptGraph;
  const setup = Object.values(graph).find((item) => item.class_type === "MiniMaxH3LatentLabLongMediaSetup");
  if (!setup || setup.inputs.workflow_mode !== "ref2va_full") return {};

  const referenceFiles: string[] = [];
  for (let index = 1; index <= 9; index += 1) {
    const link = setup.inputs[`image_${index}`];
    if (!Array.isArray(link) || typeof link[0] !== "string") break;
    const loadImage = graph[link[0]];
    if (!loadImage || loadImage.class_type !== "LoadImage" || typeof loadImage.inputs.image !== "string") break;
    referenceFiles.push(loadImage.inputs.image);
  }
  if (!referenceFiles.length) return {};
  const prompt = typeof setup.inputs.prompt === "string" ? setup.inputs.prompt : "";
  return {
    sourceMode: "reference" as const,
    inputMode: "reference" as const,
    prompt,
    duration: typeof setup.inputs.manual_duration === "number" ? setup.inputs.manual_duration : undefined,
    aspect: inferAspect(setup.inputs.width, setup.inputs.height),
    referenceFiles,
    referenceDefinitions: referenceDefinitionsFromPrompt(prompt, referenceFiles.length),
    extendable: referenceFiles.length <= 8,
  };
}

function linkedInputImage(graph: PromptGraph, setup: GraphNode, input: "first_frame" | "last_frame") {
  const link = setup.inputs[input];
  if (!Array.isArray(link) || typeof link[0] !== "string") return undefined;
  const loadImage = graph[link[0]];
  return loadImage?.class_type === "LoadImage" && typeof loadImage.inputs.image === "string"
    ? loadImage.inputs.image
    : undefined;
}

function inferAspect(width: unknown, height: unknown): GenerationOptions["aspect"] | undefined {
  if (typeof width !== "number" || typeof height !== "number" || width <= 0 || height <= 0) return undefined;
  const ratio = width / height;
  const candidates: Array<[GenerationOptions["aspect"], number]> = [["16:9", 16 / 9], ["9:16", 9 / 16], ["1:1", 1]];
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate[1] - ratio) < Math.abs(best[1] - ratio) ? candidate : best,
  )[0];
}

function standardMetadataFromHistory(entry: { prompt?: unknown }) {
  if (!Array.isArray(entry.prompt) || !entry.prompt[2] || typeof entry.prompt[2] !== "object") return {};
  const graph = entry.prompt[2] as PromptGraph;
  const setup = Object.values(graph).find((item) => item.class_type === "MiniMaxH3ImageToVideo");
  if (!setup) return {};
  const firstImagePath = linkedInputImage(graph, setup, "first_frame");
  const lastImagePath = linkedInputImage(graph, setup, "last_frame");
  return {
    sourceMode: firstImagePath || lastImagePath ? "image" as const : "text" as const,
    inputMode: "standard" as const,
    prompt: typeof setup.inputs.prompt === "string" ? setup.inputs.prompt : undefined,
    aspect: inferAspect(setup.inputs.width, setup.inputs.height),
    firstImagePath,
    lastImagePath,
  };
}

function videosFromHistory(history: Record<string, unknown>): GeneratedVideo[] {
  const found: GeneratedVideo[] = [];
  for (const [promptId, rawEntry] of Object.entries(history)) {
    const entry = rawEntry as {
      prompt?: unknown;
      outputs?: Record<string, Record<string, unknown>>;
      status?: { messages?: unknown[] };
    };
    const workflowMetadata = {
      ...standardMetadataFromHistory(entry),
      ...referenceMetadataFromHistory(entry),
    };
    const timestamps = (entry.status?.messages ?? [])
      .filter((message): message is [string, { timestamp: number }] =>
        Array.isArray(message) && typeof message[0] === "string" && typeof message[1]?.timestamp === "number",
      )
      .filter(([event]) => event === "execution_start" || event === "execution_success")
      .map(([, payload]) => payload.timestamp);
    const generationSeconds = timestamps.length >= 2
      ? Math.max(1, Math.round((Math.max(...timestamps) - Math.min(...timestamps)) / 1000))
      : undefined;
    for (const output of Object.values(entry.outputs ?? {})) {
      for (const value of Object.values(output)) {
        if (!Array.isArray(value)) continue;
        for (const item of value) {
          if (!item || typeof item !== "object" || !("filename" in item)) continue;
          const file = item as GeneratedVideo;
          if (/\.(mp4|webm|mov)$/i.test(file.filename)) found.push({
            filename: file.filename,
            subfolder: file.subfolder ?? "",
            type: file.type ?? "output",
            generationSeconds,
            promptId,
            ...workflowMetadata,
          });
        }
      }
    }
  }
  return found.reverse();
}

export async function getRecentVideos() {
  const [historyResponse, filesResponse] = await Promise.all([
    request("/history?max_items=40"),
    request("/h3-studio/outputs"),
  ]);
  const historyVideos = videosFromHistory((await historyResponse.json()) as Record<string, unknown>);
  const files = (await filesResponse.json()) as { outputs: GeneratedVideo[] };
  const historyByPath = new Map(historyVideos.map((video) => [`${video.subfolder}/${video.filename}`, video]));
  return files.outputs.map((file) => ({ ...file, ...historyByPath.get(`${file.subfolder}/${file.filename}`) }));
}

async function waitForResult(promptId: string, onStatus: (status: string) => void) {
  let announcedRun = false;
  for (;;) {
    const response = await request(`/history/${encodeURIComponent(promptId)}`);
    const history = (await response.json()) as Record<string, unknown>;
    const entry = history[promptId] as { status?: { status_str?: string; completed?: boolean; messages?: unknown[] } } | undefined;
    if (entry) {
      if (entry.status?.status_str === "error") throw new Error("H3 生成失敗，請查看 ComfyUI 視窗中的錯誤訊息。 ");
      const videos = videosFromHistory(history);
      if (videos.length) return videos[0];
      if (entry.status?.completed) throw new Error("工作流已完成，但找不到輸出的影片檔。 ");
    }
    if (!announcedRun) {
      onStatus("H3 正在載入模型並生成影片…");
      announcedRun = true;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
  }
}

export async function createVideo(
  options: GenerationOptions,
  firstImage: File | null,
  lastImage: File | null,
  onStatus: (status: string) => void,
  referenceImages: ReferenceImageInput[] = [],
) {
  const source = options.continuationSource;
  const referenceContinuation = source?.inputMode === "reference";
  if (source && (!source.width || !source.height || !source.profile || !source.resolution || source.sound === undefined)) {
    throw new Error("這支作品缺少延伸所需的生成資料，請用新版 H3 Studio 重新生成第一段。 ");
  }
  if (source && referenceContinuation && (!source.referenceFiles?.length || !source.referenceDefinitions?.length || source.referenceFiles.length !== source.referenceDefinitions.length)) {
    throw new Error("這支 Ref2VA 作品缺少原參考圖資料，無法保留人物與場景延伸。 ");
  }
  if (source && !referenceContinuation && (!source.chainId || !source.clipIndex || !source.latentPath || !source.width || !source.height || !source.profile || !source.resolution || source.sound === undefined)) {
    throw new Error("這支作品缺少延伸所需的生成資料，請用新版 H3 Studio 重新生成第一段。 ");
  }
  const chainId = source?.chainId ?? options.chainId ?? crypto.randomUUID();
  const clipIndex = source ? source.clipIndex! + 1 : options.clipIndex ?? 1;
  const latentPath = source?.latentPath ?? options.latentPath ?? `h3_context/${chainId}`;
  const runOptions: GenerationOptions = {
    ...options,
    chainId,
    clipIndex,
    latentPath,
    profile: source ? (referenceContinuation ? "cooled-turbo-8" : "quality") : options.profile,
    resolution: source?.resolution ?? options.resolution,
    sound: source?.sound ?? options.sound,
    inputMode: source?.inputMode ?? options.inputMode,
    outputWidth: source?.width ?? options.outputWidth,
    outputHeight: source?.height ?? options.outputHeight,
  };
  if (firstImage || lastImage || referenceImages.length) onStatus(options.inputMode === "reference" ? "正在載入參考圖片…" : "正在載入首尾幀圖片…");
  const [uploadedFirstImage, uploadedLastImage, uploadedReferenceImages] = await Promise.all([
    firstImage ? uploadImage(firstImage) : undefined,
    lastImage ? uploadImage(lastImage) : undefined,
    referenceContinuation ? Promise.resolve(source.referenceFiles!) : Promise.all(referenceImages.map((reference) => uploadImage(reference.file))),
  ]);
  let continuationFrame: string | undefined;
  if (referenceContinuation) {
    onStatus("正在擷取原片最後一幀作為延伸銜定…");
    const frameResponse = await request("/h3-studio/continuation-frame", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source }),
    });
    continuationFrame = ((await frameResponse.json()) as { image: string }).image;
  }
  if (firstImage || lastImage || referenceImages.length || referenceContinuation) onStatus(options.inputMode === "reference" ? "參考圖片已載入，正在建立 Ref2VA 工作流…" : "首尾幀已載入，正在建立 H3 工作流…");
  const clientId = crypto.randomUUID();
  const startedAt = Date.now();
  const response = await request("/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: runOptions.inputMode === "reference"
        ? buildReferenceWorkflow(runOptions, uploadedReferenceImages, continuationFrame)
        : buildWorkflow(runOptions, uploadedFirstImage, uploadedLastImage),
      client_id: clientId,
    }),
  });
  const result = (await response.json()) as { prompt_id?: string; error?: { message?: string }; node_errors?: Record<string, unknown> };
  if (!result.prompt_id) {
    const details = result.error?.message ?? (result.node_errors ? JSON.stringify(result.node_errors) : "未知錯誤");
    throw new Error(`ComfyUI 拒絕了工作流：${details}`);
  }
  onStatus("工作已進入佇列，等待 GPU 執行…");
  let segment = await waitForResult(result.prompt_id, onStatus);
  const [width, height] = resolveOutputDimensions(runOptions);
  if (runOptions.profile === "safe-long") {
    onStatus("H3 生成完成，正在用 CPU 轉成 480P…");
    const upscaleResponse = await request("/h3-studio/upscale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: segment, width, height }),
    });
    segment = { ...(await upscaleResponse.json() as GeneratedVideo), promptId: segment.promptId, generationSeconds: segment.generationSeconds };
  }
  const metadata = {
    generationSeconds: segment.generationSeconds ?? Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
    chainId,
    clipIndex,
    latentPath,
    profile: runOptions.profile,
    resolution: runOptions.resolution,
    width,
    height,
    sound: runOptions.sound,
    prompt: runOptions.prompt,
    duration: runOptions.duration,
    aspect: runOptions.aspect,
    sourceMode: runOptions.sourceMode ?? (runOptions.inputMode === "reference" ? "reference" : uploadedFirstImage || uploadedLastImage ? "image" : "text"),
    inputMode: runOptions.inputMode ?? "standard",
    firstImagePath: runOptions.inputMode !== "reference" ? uploadedFirstImage : undefined,
    lastImagePath: runOptions.inputMode !== "reference" ? uploadedLastImage : undefined,
    referenceFiles: runOptions.inputMode === "reference" ? uploadedReferenceImages : undefined,
    referenceDefinitions: runOptions.inputMode === "reference"
      ? (referenceContinuation ? source.referenceDefinitions : referenceImages.map(({ label, description }) => ({ label, description })))
      : undefined,
  };

  if (source) {
    onStatus("延伸片段已完成，正在移除接縫並合併影片…");
    const concatResponse = await request("/h3-studio/concat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, append: segment, metadata, trimStartFrames: referenceContinuation ? 1 : 0 }),
    });
    const combined = await concatResponse.json() as GeneratedVideo;
    return { ...combined, promptId: segment.promptId };
  }

  const video: GeneratedVideo = {
    ...segment,
    ...metadata,
    extendable: runOptions.inputMode === "reference" ? uploadedReferenceImages.length <= 8 : runOptions.profile !== "safe-long",
  };
  if (video.generationSeconds) {
    try {
      await request("/h3-studio/output-metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(video),
      });
    } catch (error) {
      if (runOptions.inputMode === "reference") throw error;
      // The video is complete even if its optional timing metadata cannot be saved.
    }
  }
  return video;
}

export function outputUrl(video: GeneratedVideo) {
  const params = new URLSearchParams({ filename: video.filename, subfolder: video.subfolder, type: video.type });
  return `${COMFY_URL}/view?${params.toString()}`;
}

export function inputImageUrl(path: string) {
  const parts = path.replaceAll("\\", "/").split("/");
  const filename = parts.pop() ?? "";
  const params = new URLSearchParams({ filename, subfolder: parts.join("/"), type: "input" });
  return `${COMFY_URL}/view?${params.toString()}`;
}

export async function deleteVideo(video: GeneratedVideo) {
  await request("/h3-studio/output", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: video.filename, subfolder: video.subfolder }),
  });
  if (video.promptId) {
    await request("/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delete: [video.promptId] }),
    });
  }
}
