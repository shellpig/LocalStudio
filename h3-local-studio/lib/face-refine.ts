import { createVideo, DEFAULT_COOLDOWN_SECONDS, GeneratedVideo, GenerationOptions, MIN_COOLDOWN_SECONDS, ReferenceImageInput, request, TURBO_LORA, waitForResult } from "./comfy";

export type FaceRefineOptions = { select: "largest_face" | "left_most" | "right_most" | "centre_most" | "all_faces"; strength: number; referenceIndex: number; mode?: "native-20" | "turbo-8" };
export const DEFAULT_FACE_REFINE: FaceRefineOptions = { select: "largest_face", strength: 0.4, referenceIndex: 0 };
export type FaceControl = { stop: boolean; promptId?: string };
export type FaceShot = { segment: [number, number]; frame: number; faces: number; jpg: string | null; boxes: number[][] };
export type FacePrepared = { sourceId: string; videoPath: string; referenceFile: string; frames: number; sound: boolean; settings: FaceRefineOptions; preview?: { shots: FaceShot[] }; targets?: { index: number; label: string; referenceFile: string }[]; targetIndex?: number; currentSource?: GeneratedVideo };

export function faceReferences(video: GeneratedVideo) {
  const paths = [...(video.referenceFiles ?? []), ...[video.firstImagePath, video.lastImagePath].filter((path): path is string => Boolean(path))];
  if (video.faceRefineReference && !paths.includes(video.faceRefineReference)) paths.push(video.faceRefineReference);
  for (const path of video.faceRefineReferences ?? []) if (!paths.includes(path)) paths.push(path);
  return paths;
}

export function validateFaceOptions(options: FaceRefineOptions) {
  if (options.mode !== undefined && options.mode !== "native-20" && options.mode !== "turbo-8") throw new Error("人臉精修模式無效。");
  if (!["largest_face", "left_most", "right_most", "centre_most", "all_faces"].includes(options.select) || !Number.isFinite(options.strength) || options.strength < 0.1 || options.strength > 0.4 || !Number.isSafeInteger(options.referenceIndex) || options.referenceIndex < 0) throw new Error("人臉精修設定無效。");
}

export async function checkFaceReady(settings?: FaceRefineOptions) {
  const query = new URLSearchParams();
  if (settings?.mode === "turbo-8") query.set("mode", "turbo-8");
  if (settings?.select === "all_faces") query.set("select", "all_faces");
  const status = await (await request(`/h3-studio/face/status${query.size ? `?${query}` : ""}`)).json() as { ready: boolean; missing: string[] };
  if (!status.ready) throw new Error(`人臉精修尚未就緒，請安裝並重啟 ComfyUI：${status.missing.join("、")}`);
}

export async function prepareFace(source: GeneratedVideo, settings: FaceRefineOptions, referenceFile?: string, scan = false) {
  validateFaceOptions(settings);
  return await (await request("/h3-studio/face/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source, settings, referenceFile, scan }) })).json() as FacePrepared;
}

export function buildFaceWorkflow(source: FacePrepared, prompt: string, cooldown: number, seed: number, picks?: number[]) {
  validateFaceOptions(source.settings);
  if (!prompt.trim() || !Number.isSafeInteger(seed) || seed < 0 || !Number.isInteger(cooldown) || cooldown < MIN_COOLDOWN_SECONDS || cooldown > 600) throw new Error("請提供提示詞、有效種子與降溫設定。");
  if (picks && (!source.preview || picks.length !== source.preview.shots.length || !picks.some((p) => p >= 0) || picks.some((p, i) => !Number.isInteger(p) || p < -1 || p >= source.preview!.shots[i].faces))) throw new Error("請為每個鏡頭選擇有效的人臉，至少選擇一個人物。");
  const node = (class_type: string, inputs: Record<string, unknown>) => ({ class_type, inputs });
  const fast = source.settings.mode === "turbo-8";
  const multiple = source.settings.select === "all_faces";
  if (multiple && (!Number.isInteger(source.targetIndex) || !source.currentSource)) throw new Error("請先偵測多人修復的目標。");
  const lockAudio = source.sound && !fast;
  const graph: Record<string, ReturnType<typeof node>> = {
    "1": node("H3FaceSelect", { video: source.videoPath, detector: "face_yolov8m.pt", confidence: 0.25, select: picks ? "manual" : source.settings.select, select_index: 0, confirmed_pick: picks?.join(",") ?? "", cut_detection: "auto (pyscenedetect)", cut_threshold: 3 }),
    "2": node("H3FaceTrackCrop", { images: ["1", 0], face_pick: ["1", 2], detector: "face_yolov8m.pt", confidence: 0.25, crop_factor: 2.5, canvas_width: 512, canvas_height: 512, canvas_mode: "manual", smooth_window: 21, size_smooth_window: 51, smooth_method: "gaussian", size_mode: "per_frame", identity_track: false }),
    "3": node("UNETLoader", { unet_name: "minimax_h3_ref2va_pruned_w4a8_mixed.safetensors", weight_dtype: "default" }),
    "5": node("MiniMaxH3MemoryEfficientSageAttentionPatch", { model: [fast ? "4" : "3", 0] }),
    "6": node("MiniMaxChunkFeedForward", { model: ["5", 0], chunks: 4, seq_threshold: 4096 }),
    "7": node("MiniMaxLowVRAMAttention", { model: ["6", 0], head_chunks: 4 }),
    "8": node("MiniMaxH3SigmaShift", { model: ["7", 0], shift_video: 12, shift_audio: 3 }),
    "9": node("CLIPLoader", { clip_name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", type: "minimax", device: "default" }),
    "10": node("VAELoader", { vae_name: "minimax_h3_video_vae_fp16.safetensors" }),
    "11": node("VAELoader", { vae_name: "minimax_h3_audio_vae_fp32.safetensors" }),
    "12": node("LoadImage", { image: source.referenceFile }),
    "13": node("MiniMaxH3ReferenceToVideo", { clip: ["9", 0], vae: ["10", 0], audio_vae: ["11", 0], prompt, width: ["2", 4], height: ["2", 5], length: ["2", 6], ref_image_size: "match", "ref_images.ref_image_0": ["12", 0] }),
    "14": node("H3InjectVideoLatent", { av_latent: ["13", 1], images: ["2", 0], vae: ["10", 0] }),
    "16": node("H3PerFrameDenoise", { model: lockAudio ? ["15", 0] : ["8", 0], av_latent: lockAudio ? ["15", 1] : ["14", 0], transform: ["2", 1], denoise_multiplier_small_face: 1, denoise_multiplier_large_face: 0.35, scale_mode: "absolute_px", face_px_small: 30, face_px_large: 120, gamma: 1, smooth_frames: 9 }),
    "17": node("BasicGuider", { model: ["16", 2], conditioning: ["13", 0] }),
    "18": node(fast ? "MiniMaxH3TurboSampler" : "KSamplerSelect", fast ? {} : { sampler_name: "res_multistep" }),
    "19": node(fast ? "H3CooledTurboSampler" : "H3CooledSampler", { sampler: ["18", 0], seconds: cooldown, skip_last: true }),
    "20": node("BasicScheduler", { model: ["16", 2], scheduler: "simple", steps: fast ? 8 : 20, denoise: source.settings.strength }),
    "21": node("RandomNoise", { noise_seed: seed }),
    "22": node("SamplerCustomAdvanced", { noise: ["21", 0], guider: ["17", 0], sampler: ["19", 0], sigmas: ["20", 0], latent_image: [fast ? "29" : "16", 0] }),
    "23": node("LTXVSeparateAVLatent", { av_latent: ["22", 0] }),
    "24": node("VAEDecodeTiled", { samples: ["23", 0], vae: ["10", 0], tile_size: 256, overlap: 64, temporal_size: 32, temporal_overlap: 8 }),
    "25": node("H3FaceStitch", { base_images: ["1", 0], refined_crops: ["24", 0], transform: ["2", 1], paste_region: "face_only", mask_dilation: 16, feather: 12, colour_match: 1, blend: 1, undetected_frames: "fade_out" }),
    "26": node("CreateVideo", { images: ["25", 0], fps: 24, bit_depth: 8 }),
    "27": node("SaveVideo", { video: ["26", 0], filename_prefix: `h3_face_cache/${source.sourceId}`, format: "mp4", "format.codec": "h264" }),
  };
  if (fast) {
    graph["4"] = node("MiniMaxH3TurboLoRA", { model: ["3", 0], lora_name: TURBO_LORA, strength: 1, low_vram: true });
    // PerFrameDenoise zeros the audio mask even without AudioLock. Unlock it
    // AFTER that node so Turbo sees only its supported three time rows.
    graph["29"] = node("H3StudioFaceUnlockAudio", { av_latent: ["16", 0] });
  }
  if (lockAudio) {
    graph["28"] = node("H3StudioFaceAudio", { audio: ["1", 1], transform: ["2", 1] });
    graph["15"] = node("MiniMaxH3NativeAudioLock", { model: ["8", 0], av_latent: ["14", 0], audio_vae: ["11", 0], audio: ["28", 0] });
  }
  if (multiple) {
    const current = source.currentSource!;
    graph["1"] = node("H3StudioMultiFaceSource", { source_id: source.sourceId, target_index: source.targetIndex, source: JSON.stringify({ filename: current.filename, subfolder: current.subfolder, type: current.type }) });
    graph["27"].inputs.filename_prefix = `h3_face_cache/${source.sourceId}_person${source.targetIndex}`;
  }
  return graph;
}

export async function cancelFace(control: FaceControl) {
  control.stop = true;
  if (!control.promptId) return;
  const queue = await (await request("/queue")).json() as { queue_running: [number, string][] };
  if (queue.queue_running.some((item) => item[1] === control.promptId)) {
    await request("/interrupt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt_id: control.promptId }) });
  } else {
    await request("/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delete: [control.promptId] }) });
  }
}

export async function runFace(source: GeneratedVideo, settings: FaceRefineOptions, control: FaceControl, onStatus: (status: string) => void, prepared?: FacePrepared, picks?: number[], referenceFile?: string) {
  const checkStop = () => { if (control.stop) throw new Error("已停止人臉精修，原片已保留。"); };
  const started = Date.now();
  try {
    checkStop();
    onStatus(settings.select === "all_faces" ? "人臉精修：正在偵測各人物並擷取清晰人臉…" : "人臉精修：正在準備原片與身份參考圖…");
    const input = prepared ?? await prepareFace(source, settings, referenceFile);
    checkStop();
    if (settings.select === "all_faces") return await runPeople(source, input, control, onStatus, started);
    const raw = await sampleFace(source, input, control, onStatus, picks);
    checkStop();
    onStatus("人臉精修：正在合回原音軌、另存成品…");
    return await (await request("/h3-studio/face/finish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId: input.sourceId, raw, settings, picks, elapsed: (Date.now() - started) / 1000 }) })).json() as GeneratedVideo;
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : control.stop ? "已停止人臉精修" : "人臉精修失敗"}；原片 ${source.filename} 已保留，可從作品列表重試。`);
  } finally { control.promptId = undefined; }
}

async function sampleFace(source: GeneratedVideo, input: FacePrepared, control: FaceControl, onStatus: (status: string) => void, picks?: number[]) {
  // Each pass has exactly one identity image, bound as Picture 1.
  const prompt = "A close-up video of the selected person. <Picture 1> defines this person's facial identity. Refine blurred facial features while preserving the source clip's expressions, gaze, head pose, mouth movements and timing. Keep the original lighting, skin tone and hairstyle. Do not add other people or copy the reference background.";
  const graph = buildFaceWorkflow(input, prompt, Math.max(MIN_COOLDOWN_SECONDS, source.cooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS), source.seed ?? 42, picks);
  onStatus("人臉精修：追蹤人臉、局部重繪與合成…");
  const result = await (await request("/prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: graph, client_id: crypto.randomUUID() }) })).json() as { prompt_id?: string; error?: unknown; node_errors?: unknown };
  if (!result.prompt_id) throw new Error(`修臉工作流無法執行：${JSON.stringify(result.node_errors ?? result.error)}`);
  control.promptId = result.prompt_id;
  if (control.stop) { await cancelFace(control); throw new Error("已停止人臉精修"); }
  try { return await waitForFace(result.prompt_id, control, onStatus); }
  finally { control.promptId = undefined; }
}

async function runPeople(source: GeneratedVideo, input: FacePrepared, control: FaceControl, onStatus: (status: string) => void, started: number) {
  if (!input.targets?.length) throw new Error("沒有可追蹤的人物，請改用單人模式預覽選臉。");
  let current = source;
  let completed = 0;
  const save = async () => await (await request("/h3-studio/face/finish", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceId: input.sourceId, raw: current, settings: input.settings, completedPeople: completed, elapsed: (Date.now() - started) / 1000 }),
  })).json() as GeneratedVideo;
  try {
    for (const target of input.targets) {
      if (control.stop) throw new Error("已停止逐人修復");
      const label = `人臉精修（${completed + 1}/${input.targets.length} 組・${target.label}）`;
      current = await sampleFace(source, { ...input, referenceFile: target.referenceFile, targetIndex: target.index, currentSource: current }, control, (status) => onStatus(`${label}：${status.replace(/^人臉精修：/, "")}`));
      completed++;
    }
  } catch (error) {
    if (completed) {
      const partial = await save();
      throw new Error(`${error instanceof Error ? error.message : "逐人修復失敗"}；已保存 ${completed}/${input.targets.length} 組：${partial.filename}`);
    }
    throw error;
  }
  onStatus(`人臉精修：已完成 ${completed}/${input.targets.length} 組，正在合回原音軌…`);
  return save();
}

async function waitForFace(promptId: string, control: FaceControl, onStatus: (status: string) => void) {
  return waitForResult(promptId, (status) => onStatus(`人臉精修：${status}`), "video", () => control.stop);
}

export async function createVideoWithFace(options: GenerationOptions, first: File | null, last: File | null, references: ReferenceImageInput[], settings: FaceRefineOptions | undefined, control: FaceControl, onStatus: (status: string) => void, onOriginal: (video: GeneratedVideo) => void) {
  if (settings) { validateFaceOptions(settings); await checkFaceReady(settings); }
  const original = await createVideo(options, first, last, (status) => onStatus(`${settings ? "生成影片（1/2）：" : ""}${status}`), references);
  onOriginal(original);
  if (!settings) return original;
  onStatus("人臉精修（2/2）：原片已保存，正在接續修臉…");
  return runFace(original, settings, control, onStatus);
}
