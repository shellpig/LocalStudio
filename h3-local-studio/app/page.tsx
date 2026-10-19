"use client";

import { DragEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildReferencePrompt,
  checkConnection,
  createImage,
  createQwenImage,
  deleteVideo,
  GeneratedVideo,
  GenerationOptions,
  H3AttentionMethod,
  ExtraLora,
  getAvailableLoras,
  getRecentVideos,
  inputImageUrl,
  MIN_COOLDOWN_SECONDS,
  DEFAULT_COOLDOWN_SECONDS,
  optimizeQwenImagePrompt,
  optimizeVideoPrompt,
  outputUrl,
  PromptEngine,
  QWEN_DEFAULT_COOLDOWN_SECONDS,
  QWEN_DEFAULT_STEPS,
  QWEN_DIMENSIONS,
  QWEN_MAX_COUNT,
  QWEN_MAX_IMAGES,
  QWEN_MIN_COOLDOWN_SECONDS,
  QwenAspect,
  QwenSize,
  QwenModel,
  QWEN_MODELS,
  QwenCamera,
  QWEN_CAMERA_AZIMUTHS,
  QWEN_CAMERA_ELEVATIONS,
  QWEN_CAMERA_LORA,
  QWEN_DEFAULT_CAMERA,
  ReferenceImageInput,
  referenceVideoSteps,
  resolveImageDimensions,
  resolveOutputDimensions,
} from "@/lib/comfy";
import { CropRect, cropImageFile, ImageCropper, readImageDimensions } from "./image-cropper";
import { ImageMarker } from "./image-marker";
import { audioDownloadUrl } from "@/lib/tts";
import SpeechStudio from "./speech-studio";
import { drama3DownloadUrl } from "@/lib/drama3";
import EnhanceStudio from "./enhance-studio";
import SwapStudio from "./swap-studio";
import { SWAP_LABELS } from "@/lib/swap";
import RTXStudio from "./rtx-studio";
import FaceRefineStudio from "./face-refine-studio";
import FaceSettings from "./face-settings";
import { cancelFace, createVideoWithFace, DEFAULT_FACE_REFINE, FaceControl, FaceRefineOptions } from "@/lib/face-refine";
import GenerationQueuePanel from "./generation-queue-panel";
import LoraPicker from "./lora-picker";
import { createGenerationQueue, GenerationJob } from "@/lib/generation-queue";

type View = "create" | "edit" | "works" | "tts";
type SourceMode = "text" | "image" | "reference";
type ImageDimensions = { width: number; height: number };
type ReferenceImageDraft = {
  id: number;
  file: File | null;
  /** The image as chosen, before any crop. Kept so the crop can be redone. */
  originalFile: File | null;
  crop: CropRect | null;
  preview: string | null;
  dimensions: ImageDimensions | null;
  label: string;
  description: string;
};
type ExtraLoraDraft = ExtraLora & { id: number };
type QwenImageDraft = {
  id: number;
  file: File;
  /** The image as chosen, before any crop. Kept so the crop can be redone. */
  originalFile: File;
  /** The crop base includes any marks applied to the current image. */
  cropSourceFile: File;
  crop: CropRect | null;
  preview: string;
};
type CropTarget = { kind: "first" } | { kind: "last" } | { kind: "reference"; id: number } | { kind: "qwen"; id: number };

const CROP_ASPECT: Record<QwenAspect, number> = { "16:9": 16 / 9, "4:3": 4 / 3, "1:1": 1, "3:4": 3 / 4, "9:16": 9 / 16, "3:2": 3 / 2, "2:3": 2 / 3 };

const EXAMPLE_PROMPT =
  "電影感寫實風格，雨後黃昏的台北街道，一位穿深色風衣的人緩慢走過霓虹燈下，鏡頭低角度向前跟拍，水面倒影細緻，微風吹動衣角。環境音：細雨、遠方車流、輕柔低沉的配樂。不要文字、字幕、Logo 或浮水印。";
const DURATION_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const ORB360_LORA = "minimax_h3_orb360_step1500.safetensors";
const ORB360_PROMPT = `ORB360_CW. A frozen-time scene with one uninterrupted clockwise 360-degree camera orbit around @subject.

Preserve the reference image's character, pose, facial expression, clothing, environment, lighting, and visual style.

The character and the entire environment remain completely frozen in world space throughout the clip. The camera is the only moving element.

The character holds the exact same pose and expression: no blinking, breathing, speaking, head movement, eye tracking, or limb movement. Hair, clothing, accessories, and loose fabric remain rigidly fixed.

All background elements belonging to the original scene remain motionless in their original world positions. Maintain the same type of environment as the supplied image throughout the orbit. Do not introduce unrelated scenery or animated background elements.

The camera smoothly circles the character clockwise exactly once, maintaining constant speed, distance, elevation, focal length, and a fixed look-at point. Start from the reference viewpoint and return to that same viewpoint at the end.

Reveal the scene's side and rear views with coherent three-dimensional geometry and natural parallax. Background objects stay anchored to their original world positions. Their apparent positions change only because the camera moves.

The character does not rotate. The environment does not rotate. Do not spin the image like a flat photograph or card.

Keep lighting fixed in world space. No cuts, zooms, camera roll, deformation, flicker, or scene transitions.

Silent video. No dialogue, sound effects, or music.`;

function emptyReferenceImage(id: number): ReferenceImageDraft {
  return { id, file: null, originalFile: null, crop: null, preview: null, dimensions: null, label: "", description: "" };
}

export default function Home() {
  const [view, setView] = useState<View>("create");
  const [worksTab, setWorksTab] = useState<"video" | "image" | "audio">("video");
  const [sourceMode, setSourceMode] = useState<SourceMode>("text");
  const [enhancementMode, setEnhancementMode] = useState(false);
  const [swapMode, setSwapMode] = useState(false);
  const [rtxMode, setRTXMode] = useState(false);
  const [swapWork, setSwapWork] = useState<GeneratedVideo | null>(null);
  const [faceWork, setFaceWork] = useState<GeneratedVideo | null>(null);
  const [faceEnabled, setFaceEnabled] = useState(false);
  const [faceSettings, setFaceSettings] = useState<FaceRefineOptions>(DEFAULT_FACE_REFINE);
  const [activeFaceControl, setActiveFaceControl] = useState<FaceControl | null>(null);
  const [enhancementBusy, setEnhancementBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [profile, setProfile] = useState<GenerationOptions["profile"]>("fast");
  const [attentionMethod, setAttentionMethod] = useState<H3AttentionMethod>("sage");
  const [resolution, setResolution] = useState<GenerationOptions["resolution"]>("safe");
  const [duration, setDuration] = useState(5);
  const [aspect, setAspect] = useState<GenerationOptions["aspect"]>("16:9");
  const [soundEnabled, setSoundEnabled] = useState(true);
  // Per-step cooldown seconds; defaults to the last successful run once history loads.
  const [cooldownSeconds, setCooldownSeconds] = useState(DEFAULT_COOLDOWN_SECONDS);
  const cooldownInitialized = useRef(false);
  // Empty means "pick a fresh random seed"; a number reproduces an earlier run.
  const [seed, setSeed] = useState("");
  const [extraLoras, setExtraLoras] = useState<ExtraLoraDraft[]>([]);
  const [availableLoras, setAvailableLoras] = useState<string[]>([]);
  const nextLoraId = useRef(1);
  const [firstImageFile, setFirstImageFile] = useState<File | null>(null);
  const [firstImageOriginal, setFirstImageOriginal] = useState<File | null>(null);
  const [firstImageCrop, setFirstImageCrop] = useState<CropRect | null>(null);
  const [firstImagePreview, setFirstImagePreview] = useState<string | null>(null);
  const [firstImageDimensions, setFirstImageDimensions] = useState<ImageDimensions | null>(null);
  const [lastImageFile, setLastImageFile] = useState<File | null>(null);
  const [lastImageOriginal, setLastImageOriginal] = useState<File | null>(null);
  const [lastImageCrop, setLastImageCrop] = useState<CropRect | null>(null);
  const [lastImagePreview, setLastImagePreview] = useState<string | null>(null);
  const [lastImageDimensions, setLastImageDimensions] = useState<ImageDimensions | null>(null);
  const [referenceImages, setReferenceImages] = useState<ReferenceImageDraft[]>([emptyReferenceImage(1)]);
  const [cropTarget, setCropTarget] = useState<CropTarget | null>(null);
  const [markerId, setMarkerId] = useState<number | null>(null);
  const nextReferenceId = useRef(2);
  const [isGeneratingH3Image, setIsGeneratingH3Image] = useState(false);
  const [generationJobs, setGenerationJobs] = useState<GenerationJob[]>([]);
  const activeJob = generationJobs.find((job) => job.status === "running");
  const queueBusy = generationJobs.some((job) => job.status !== "failed");
  const isGenerating = isGeneratingH3Image || queueBusy;
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [promptEngine, setPromptEngine] = useState<PromptEngine>("codex");
  const [promptBeforeOptimization, setPromptBeforeOptimization] = useState<string | null>(null);
  const [optimizedPromptMode, setOptimizedPromptMode] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [generationQueue] = useState(() => createGenerationQueue((jobs) => {
    setGenerationJobs(jobs);
    const running = jobs.find((job) => job.status === "running");
    if (running?.startedAt) setElapsed(Math.floor((Date.now() - running.startedAt) / 1000));
  }));
  const [statusText, setStatusText] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [videos, setVideos] = useState<GeneratedVideo[]>([]);
  const [dramaWork, setDramaWork] = useState<GeneratedVideo | null>(null);
  const [continuationSource, setContinuationSource] = useState<GeneratedVideo | null>(null);
  const promptHighlightRef = useRef<HTMLDivElement>(null);
  // 圖像編輯 (Qwen-Image 2.1) keeps its own settings; nothing here touches the H3 pipeline.
  const [qwenPrompt, setQwenPrompt] = useState("");
  const [qwenPromptBeforeOptimization, setQwenPromptBeforeOptimization] = useState<string | null>(null);
  const [qwenAspect, setQwenAspect] = useState<QwenAspect>("1:1");
  const [qwenEditAspect, setQwenEditAspect] = useState<QwenAspect | "auto">("auto");
  const [qwenSize, setQwenSize] = useState<QwenSize>("1mp");
  const [qwenModel, setQwenModel] = useState<QwenModel>("original");
  const [qwenSteps, setQwenSteps] = useState(QWEN_DEFAULT_STEPS);
  const [qwenSeed, setQwenSeed] = useState("");
  const [qwenCount, setQwenCount] = useState(1);
  const [qwenCooldownSeconds, setQwenCooldownSeconds] = useState(QWEN_DEFAULT_COOLDOWN_SECONDS);
  const [qwenFast, setQwenFast] = useState(false);
  const [qwenCameraEnabled, setQwenCameraEnabled] = useState(false);
  const [qwenCamera, setQwenCamera] = useState<QwenCamera>(QWEN_DEFAULT_CAMERA);
  const [qwenImages, setQwenImages] = useState<QwenImageDraft[]>([]);
  const nextQwenImageId = useRef(1);
  const qwenPromptRef = useRef<HTMLTextAreaElement>(null);
  // Set while the caret sits just after an "@" the menu can complete into <imageN>.
  const [qwenMention, setQwenMention] = useState<{ start: number; query: string } | null>(null);
  const [qwenMentionIndex, setQwenMentionIndex] = useState(0);

  const refreshHistory = useCallback(async () => {
    try {
      const items = await getRecentVideos();
      setVideos(items);
      if (!cooldownInitialized.current) {
        const last = items.find((item) => typeof item.cooldownSeconds === "number")?.cooldownSeconds;
        if (last) {
          setCooldownSeconds(Math.max(MIN_COOLDOWN_SECONDS, last));
          cooldownInitialized.current = true;
        }
      }
    } catch {
      // Connection state already communicates that ComfyUI is unavailable.
    }
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem("h3-prompt-engine");
    if (saved === "codex" || saved === "grok") setPromptEngine(saved);
  }, []);

  function choosePromptEngine(engine: PromptEngine) {
    setPromptEngine(engine);
    window.localStorage.setItem("h3-prompt-engine", engine);
  }

  const engineLabel = promptEngine === "grok" ? "Grok" : "Codex";

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const online = await checkConnection();
      if (!active) return;
      setConnected(online);
      if (online) {
        void refreshHistory();
        void getAvailableLoras().then(setAvailableLoras).catch(() => setAvailableLoras([]));
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [refreshHistory]);

  useEffect(() => {
    if (!isGenerating) return;
    const startedAt = activeJob?.startedAt ?? Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [isGenerating, activeJob?.id, activeJob?.startedAt]);

  useEffect(() => {
    return () => {
      if (firstImagePreview) URL.revokeObjectURL(firstImagePreview);
    };
  }, [firstImagePreview]);

  useEffect(() => {
    return () => {
      if (lastImagePreview) URL.revokeObjectURL(lastImagePreview);
    };
  }, [lastImagePreview]);

  const anchorImageDimensions = firstImageDimensions ?? lastImageDimensions;
  const videoImageDimensions = sourceMode === "reference" ? firstImageDimensions : sourceMode === "image" ? anchorImageDimensions : null;

  const sizeLabels = useMemo(() => {
    const label = (preset: GenerationOptions["resolution"]) => {
      if (continuationSource?.width && continuationSource?.height) return `${continuationSource.width} × ${continuationSource.height}`;
      if (sourceMode === "image" && !anchorImageDimensions) return "選圖後計算";
      const [width, height] = resolveOutputDimensions({
        resolution: preset,
        aspect,
        sourceWidth: videoImageDimensions?.width,
        sourceHeight: videoImageDimensions?.height,
      });
      return `${width} × ${height}`;
    };
    return { safe: label("safe"), clear: label("clear"), p480: label("p480"), p540: label("p540"), native: label("native") };
  }, [anchorImageDimensions, aspect, continuationSource, sourceMode, videoImageDimensions]);

  const outputSize = sizeLabels[resolution];
  const videoWorks = useMemo(() => videos.filter((item) => item.kind !== "image" && item.kind !== "audio"), [videos]);
  const imageWorks = useMemo(() => videos.filter((item) => item.kind === "image"), [videos]);
  const audioWorks = useMemo(() => videos.filter((item) => item.kind === "audio"), [videos]);
  const qwenWorks = useMemo(() => imageWorks.filter((item) => item.model === "qwen-image-2.1"), [imageWorks]);
  // Steps that actually run per profile, for the cooldown-time estimate.
  const cooldownSteps = sourceMode === "reference" ? referenceVideoSteps(profile) : profile === "cooled-turbo-4" ? 4 : profile === "quality" ? 20 : profile === "cooled-turbo-8" ? 8 : 6;
  const imageAspect = anchorImageDimensions ? formatAspect(anchorImageDimensions.width, anchorImageDimensions.height) : null;
  const extremeImageRatio = anchorImageDimensions
    ? Math.max(anchorImageDimensions.width / anchorImageDimensions.height, anchorImageDimensions.height / anchorImageDimensions.width) > 2.4
    : false;
  const validReferenceTags = useMemo(() => sourceMode === "reference"
    ? referenceImages
        .filter((reference) => reference.file && reference.label.trim())
        .map((reference) => reference.label.replace(/^@+/, "").trim())
    : [], [referenceImages, sourceMode]);

  function imageDropHandlers(onFiles: (files: File[]) => void, disabled = false) {
    return {
      onDragOver(event: DragEvent<HTMLLabelElement>) {
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      },
      onDrop(event: DragEvent<HTMLLabelElement>) {
        event.preventDefault();
        event.stopPropagation();
        if (disabled) return;
        const files = Array.from(event.dataTransfer.files).filter((file) =>
          ["image/png", "image/jpeg", "image/webp"].includes(file.type)
          || (!file.type && /\.(png|jpe?g|webp)$/i.test(file.name)),
        );
        if (!files.length) {
          setError("請拖入 JPG、PNG 或 WebP 圖片。 ");
          return;
        }
        setError("");
        onFiles(files);
      },
    };
  }

  async function chooseImage(file: File | null, position: "first" | "last") {
    setPromptBeforeOptimization(null);
    setOptimizedPromptMode(null);
    const previousPreview = position === "first" ? firstImagePreview : lastImagePreview;
    if (previousPreview) URL.revokeObjectURL(previousPreview);
    if (position === "first") {
      setFirstImageFile(file);
      setFirstImageOriginal(file);
      setFirstImageCrop(null);
      setFirstImagePreview(file ? URL.createObjectURL(file) : null);
      setFirstImageDimensions(null);
    } else {
      setLastImageFile(file);
      setLastImageOriginal(file);
      setLastImageCrop(null);
      setLastImagePreview(file ? URL.createObjectURL(file) : null);
      setLastImageDimensions(null);
    }
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      if (position === "first") setFirstImageDimensions(dimensions);
      else setLastImageDimensions(dimensions);
      bitmap.close();
    } catch {
      setError(`無法讀取${position === "first" ? "首幀" : "尾幀"}圖片的尺寸，請改用 JPG、PNG 或 WebP。 `);
    }
  }

  async function chooseReferenceImage(file: File | null, id: number) {
    const current = referenceImages.find((reference) => reference.id === id);
    if (current?.preview) URL.revokeObjectURL(current.preview);
    setReferenceImages((references) => references.map((reference) =>
      reference.id === id
        ? { ...reference, file, originalFile: file, crop: null, preview: file ? URL.createObjectURL(file) : null, dimensions: null }
        : reference,
    ));
    setPromptBeforeOptimization(null);
    setOptimizedPromptMode(null);
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      setReferenceImages((references) => references.map((reference) =>
        reference.id === id ? { ...reference, dimensions } : reference,
      ));
    } catch {
      setError("無法讀取參考圖片尺寸，請改用 JPG、PNG 或 WebP。 ");
    }
  }

  function croppableFile(target: CropTarget) {
    if (target.kind === "reference") return referenceImages.find((reference) => reference.id === target.id)?.originalFile ?? null;
    if (target.kind === "qwen") return qwenImages.find((image) => image.id === target.id)?.cropSourceFile ?? null;
    return target.kind === "first" ? firstImageOriginal : lastImageOriginal;
  }

  function applyImage(target: CropTarget, file: File, dimensions: ImageDimensions, crop: CropRect | null) {
    const preview = URL.createObjectURL(file);
    if (target.kind === "reference") {
      setReferenceImages((references) => references.map((reference) => {
        if (reference.id !== target.id) return reference;
        if (reference.preview) URL.revokeObjectURL(reference.preview);
        return { ...reference, file, crop, preview, dimensions };
      }));
      return;
    }
    if (target.kind === "qwen") {
      setQwenPromptBeforeOptimization(null);
      setQwenImages((images) => images.map((image) => {
        if (image.id !== target.id) return image;
        URL.revokeObjectURL(image.preview);
        return { ...image, file, crop, preview, cropSourceFile: file === image.originalFile ? file : image.cropSourceFile };
      }));
      return;
    }
    if (target.kind === "first") {
      setFirstImageFile(file);
      setFirstImageCrop(crop);
      setFirstImagePreview(preview);
      setFirstImageDimensions(dimensions);
    } else {
      setLastImageFile(file);
      setLastImageCrop(crop);
      setLastImagePreview(preview);
      setLastImageDimensions(dimensions);
    }
  }

  async function applyCrop(rect: CropRect) {
    const target = cropTarget;
    const original = target ? croppableFile(target) : null;
    setCropTarget(null);
    if (!target || !original) return;
    try {
      const cropped = await cropImageFile(original, rect);
      applyImage(target, cropped, await readImageDimensions(cropped), rect);
    } catch {
      setError("無法裁切這張圖片，請改用 JPG、PNG 或 WebP。 ");
    }
  }

  async function restoreOriginalImage(target: CropTarget) {
    const original = target.kind === "qwen"
      ? qwenImages.find((image) => image.id === target.id)?.originalFile
      : croppableFile(target);
    if (!original) return;
    try {
      applyImage(target, original, await readImageDimensions(original), null);
    } catch {
      setError("無法還原原圖，請重新選擇圖片。 ");
    }
  }

  function updateReference(id: number, field: "label" | "description", value: string) {
    const normalized = field === "label" ? value.replace(/^@+/, "") : value;
    setReferenceImages((references) => references.map((reference) =>
      reference.id === id ? { ...reference, [field]: normalized } : reference,
    ));
    setPromptBeforeOptimization(null);
    setOptimizedPromptMode(null);
  }

  function addReferenceImage() {
    if (referenceImages.length >= 9) return;
    setReferenceImages((references) => [...references, emptyReferenceImage(nextReferenceId.current++)]);
  }

  function removeReferenceImage(id: number) {
    const reference = referenceImages.find((item) => item.id === id);
    if (reference?.preview) URL.revokeObjectURL(reference.preview);
    setReferenceImages((references) => {
      const remaining = references.filter((item) => item.id !== id);
      return remaining.length ? remaining : [emptyReferenceImage(nextReferenceId.current++)];
    });
    setPromptBeforeOptimization(null);
    setOptimizedPromptMode(null);
  }

  function referenceInputs(): ReferenceImageInput[] | null {
    const lastPopulatedIndex = referenceImages.reduce(
      (lastIndex, reference, index) => reference.file || reference.label.trim() || reference.description.trim() ? index : lastIndex,
      -1,
    );
    if (lastPopulatedIndex < 0) {
      setError("參考生影片至少需要一張參考圖片。 ");
      return null;
    }
    const populated = referenceImages.slice(0, lastPopulatedIndex + 1);
    if (populated.some((reference) => !reference.file || !reference.label.trim())) {
      setError("每個參考項目都要有圖片與 @標籤。 ");
      return null;
    }
    if (populated.some((reference) => /\s/.test(reference.label.trim()))) {
      setError("@標籤不能包含空白；可使用中文、英文、數字、底線或連字號。 ");
      return null;
    }
    const labels = populated.map((reference) => reference.label.trim().toLocaleLowerCase());
    if (new Set(labels).size !== labels.length) {
      setError("每個參考項目的 @標籤都必須不同。 ");
      return null;
    }
    if (populated.some((reference) => reference.file && !reference.dimensions)) {
      setError("尚未讀取到參考圖片尺寸，請重新選擇圖片。 ");
      return null;
    }
    return populated.map((reference) => ({
      file: reference.file!, label: reference.label.trim(), description: reference.description.trim(),
    }));
  }

  async function generate() {
    if (!prompt.trim()) {
      setError("請先描述想生成的影片。 ");
      return;
    }
    if (!continuationSource && sourceMode === "image" && !firstImageFile && !lastImageFile) {
      setError("圖片轉影片至少需要選擇首幀或尾幀圖片。 ");
      return;
    }
    if (!continuationSource && sourceMode !== "text" && firstImageFile && !firstImageDimensions) {
      setError("尚未讀取到首幀圖片尺寸，請重新選擇圖片。 ");
      return;
    }
    if (!continuationSource && sourceMode !== "text" && lastImageFile && !lastImageDimensions) {
      setError("尚未讀取到尾幀圖片尺寸，請重新選擇圖片。 ");
      return;
    }
    const references = sourceMode === "reference" && !continuationSource ? referenceInputs() : [];
    if (references === null) return;
    const referenceDefinitions = continuationSource?.inputMode === "reference"
      ? continuationSource.referenceDefinitions ?? []
      : references;
    if (sourceMode === "reference" && continuationSource && !referenceDefinitions.length) {
      setError("這支 Ref2VA 作品缺少原參考標籤，無法保留人物與場景延伸。 ");
      return;
    }

    const label = continuationSource ? `延伸影片 · ${continuationSource.filename}` : `H3 影片 · ${prompt.trim()}`;
    if (continuationSource && generationJobs.some((job) => job.label === label && job.status !== "failed")) {
      setError("同一支原片的延伸任務尚未完成，請等完成後再加入另一筆延伸。");
      return;
    }
    const options: GenerationOptions = {
      faceRefine: faceEnabled && sourceMode !== "text" && !continuationSource ? { ...faceSettings } : undefined,
      prompt: sourceMode === "reference" && optimizedPromptMode !== "Ref2VA"
        ? buildReferencePrompt(
            continuationSource ? `Continue seamlessly from the supplied first-frame anchor. ${prompt.trim()}` : prompt,
            referenceDefinitions,
          )
        : prompt.trim(),
      profile, resolution, duration, aspect, sound: soundEnabled, sourceMode,
      attentionMethod: sourceMode === "reference" ? "sage" : attentionMethod,
      cooldownSeconds: Math.max(MIN_COOLDOWN_SECONDS, cooldownSeconds),
      seed: seed.trim() ? Number(seed) : undefined,
      extraLoras: extraLoras.length ? extraLoras.map(({ name, strength }) => ({ name, strength })) : undefined,
      inputMode: sourceMode === "reference" ? "reference" : "standard",
      sourceWidth: !continuationSource ? videoImageDimensions?.width : undefined,
      sourceHeight: !continuationSource ? videoImageDimensions?.height : undefined,
      outputWidth: continuationSource?.width,
      outputHeight: continuationSource?.height,
      continuationSource: continuationSource ? structuredClone(continuationSource) : undefined,
    };
    const firstImage = !continuationSource && sourceMode !== "text" ? firstImageFile : null;
    const lastImage = !continuationSource && sourceMode !== "text" ? lastImageFile : null;
    if (options.faceRefine && options.faceRefine.select !== "all_faces" && options.faceRefine.referenceIndex >= (references.length + Number(Boolean(firstImage)) + Number(Boolean(lastImage)))) {
      setError("請選擇有效的人臉身份參考圖。");
      return;
    }
    setError("");
    setNotice("已加入生成佇列。");
    setContinuationSource(null);
    generationQueue.add(label, async (onStatus) => {
      const control: FaceControl = { stop: false };
      try {
        const result = await createVideoWithFace(options, firstImage, lastImage, references, options.faceRefine, control, (message) => {
          onStatus(message);
          if (message.startsWith("人臉精修")) setActiveFaceControl(control);
        }, (original) => setVideos((current) => [original, ...current.filter((item) => item.filename !== original.filename)]));
        setVideos((current) => [result, ...current.filter((item) => item.filename !== result.filename)]);
        setNotice(options.faceRefine ? "H3 影片與人臉精修已完成，原片已保留。" : "H3 影片已完成。");
      } finally {
        setActiveFaceControl(null);
        void refreshHistory();
      }
    });
  }

  async function generateImage() {
    if (!prompt.trim()) {
      setError("請先描述想生成的圖片。 ");
      return;
    }
    const references = sourceMode === "reference" ? referenceInputs() : [];
    if (references === null) return;

    setError("");
    setNotice("");
    setElapsed(0);
    setStatusText("正在送入本機 H3 佇列…");
    setIsGeneratingH3Image(true);
    try {
      const result = await createImage(
        {
          prompt: sourceMode === "reference" && optimizedPromptMode !== "Ref2VA"
            ? buildReferencePrompt(prompt, references)
            : prompt.trim(),
          profile, resolution, duration, aspect, sound: false, sourceMode,
          cooldownSeconds: Math.max(MIN_COOLDOWN_SECONDS, cooldownSeconds),
          seed: seed.trim() ? Number(seed) : undefined,
          extraLoras: extraLoras.length ? extraLoras.map(({ name, strength }) => ({ name, strength })) : undefined,
          inputMode: sourceMode === "reference" ? "reference" : "standard",
        },
        (phase) => setStatusText(phase),
        references,
      );
      setVideos((current) => [result, ...current.filter((item) => item.filename !== result.filename)]);
      setStatusText("圖片已完成並儲存到 ComfyUI output/H3_Image。 ");
      setWorksTab("image");
      setView("works");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "生成失敗，請查看 ComfyUI 視窗。 ");
    } finally {
      setIsGeneratingH3Image(false);
      void refreshHistory();
    }
  }

  function chooseQwenImages(files: File[]) {
    setQwenPromptBeforeOptimization(null);
    setQwenImages((current) => [
      ...current,
      ...files.slice(0, Math.max(0, QWEN_MAX_IMAGES - current.length)).map((file) => ({
        id: nextQwenImageId.current++, file, originalFile: file, cropSourceFile: file, crop: null, preview: URL.createObjectURL(file),
      })),
    ]);
  }

  function removeQwenImage(id: number) {
    setQwenPromptBeforeOptimization(null);
    setQwenImages((current) => {
      const target = current.find((image) => image.id === id);
      if (target) URL.revokeObjectURL(target.preview);
      return current.filter((image) => image.id !== id);
    });
  }

  // Only images that exist are offered, so the menu cannot name a missing one.
  const qwenMentionMatches = useMemo(() => (qwenMention
    ? qwenImages
        .map((image, index) => ({ image, index }))
        .filter(({ index }) => !qwenMention.query || String(index + 1).startsWith(qwenMention.query))
    : []), [qwenImages, qwenMention]);
  const qwenMentionActive = Math.min(qwenMentionIndex, Math.max(0, qwenMentionMatches.length - 1));

  function syncQwenMention(field: HTMLTextAreaElement) {
    const match = qwenImages.length ? /(?:^|\s)@(\d*)$/.exec(field.value.slice(0, field.selectionStart)) : null;
    if (!match) {
      setQwenMention(null);
      return;
    }
    setQwenMention({ start: field.selectionStart - match[1].length - 1, query: match[1] });
    setQwenMentionIndex(0);
  }

  function insertQwenMention(index: number) {
    const field = qwenPromptRef.current;
    if (!field || !qwenMention) return;
    const tag = `<image${index + 1}>`;
    setQwenPrompt(`${field.value.slice(0, qwenMention.start)}${tag}${field.value.slice(field.selectionStart)}`);
    setQwenPromptBeforeOptimization(null);
    setQwenMention(null);
    const caret = qwenMention.start + tag.length;
    window.requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(caret, caret);
    });
  }

  function handleQwenPromptKeys(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!qwenMentionMatches.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : qwenMentionMatches.length - 1;
      setQwenMentionIndex((current) => (Math.min(current, qwenMentionMatches.length - 1) + step) % qwenMentionMatches.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      insertQwenMention(qwenMentionMatches[qwenMentionActive].index);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setQwenMention(null);
    }
  }

  async function generateQwenImage() {
    if (qwenCameraEnabled && qwenImages.length !== 1) {
      setError("攝影機視角請只上傳一張原圖。");
      return;
    }
    if (!qwenCameraEnabled && !qwenPrompt.trim()) {
      setError(qwenImages.length ? "請先描述要怎麼編輯這些圖片。 " : "請先描述想生成的圖像。 ");
      return;
    }
    const options = {
      prompt: qwenPrompt.trim(), aspect: qwenAspect, size: qwenSize, steps: qwenSteps, model: qwenModel,
      editAspect: qwenImages.length && qwenEditAspect !== "auto" ? qwenEditAspect : undefined,
      seed: qwenSeed.trim() ? Number(qwenSeed) : undefined,
      cooldownSeconds: Math.max(QWEN_MIN_COOLDOWN_SECONDS, qwenCooldownSeconds),
      count: qwenCount,
      fast: qwenFast,
      camera: qwenCameraEnabled ? { ...qwenCamera } : undefined,
    };
    const images = qwenImages.map((image) => image.file);
    setError("");
    setNotice("已加入生成佇列。");
    generationQueue.add(`Qwen 圖片 · ${qwenCameraEnabled ? "新視角" : options.prompt} · ${qwenCount} 張`, async (onStatus) => {
      try {
        const results = await createQwenImage(options, images, onStatus,
          (result) => setVideos((current) => [result, ...current.filter((item) => item.filename !== result.filename)]),
        );
        setNotice(`${results.length} 張 Qwen 圖片已完成。`);
      } finally {
        void refreshHistory();
      }
    });
  }

  async function optimizeQwenPrompt() {
    if (!qwenPrompt.trim()) {
      setError(qwenImages.length ? "請先描述要怎麼編輯這些圖片。 " : "請先輸入想生成的圖像內容。 ");
      return;
    }
    setError("");
    setQwenMention(null);
    setIsOptimizing(true);
    try {
      const original = qwenPrompt;
      const result = await optimizeQwenImagePrompt(original.trim(), qwenImages.map((image) => image.file));
      setQwenPromptBeforeOptimization(original);
      setQwenPrompt(result.prompt);
      setQwenMention(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Codex 無法優化提示詞，請稍後再試。 ");
    } finally {
      setIsOptimizing(false);
    }
  }

  function restoreQwenPrompt() {
    if (qwenPromptBeforeOptimization === null) return;
    setQwenPrompt(qwenPromptBeforeOptimization);
    setQwenPromptBeforeOptimization(null);
  }

  async function optimizePrompt() {
    if (!prompt.trim()) {
      setError("請先輸入想拍攝的內容，再使用官方格式優化。 ");
      return;
    }
    if (!continuationSource && sourceMode === "image" && !firstImageFile && !lastImageFile) {
      setError("圖片模式至少要先選擇首幀或尾幀圖片。 ");
      return;
    }
    const references = sourceMode === "reference" ? referenceInputs() : [];
    if (references === null) return;

    setError("");
    setIsOptimizing(true);
    try {
      const original = prompt;
      const result = await optimizeVideoPrompt(
        original.trim(),
        duration,
        soundEnabled,
        !continuationSource && sourceMode !== "text" ? firstImageFile : null,
        !continuationSource && sourceMode !== "text" ? lastImageFile : null,
        references,
        promptEngine,
      );
      setPromptBeforeOptimization(original);
      setPrompt(result.prompt);
      setOptimizedPromptMode(result.mode);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `${engineLabel} 無法優化 Prompt，請稍後再試。 `);
    } finally {
      setIsOptimizing(false);
    }
  }

  function applyOrb360Prompt(mode: SourceMode = sourceMode) {
    const reference = referenceImages.find((item) => item.file) ?? referenceImages[0];
    const label = reference?.label.replace(/^@+/, "").trim();
    const subject = mode === "reference" ? (label ? `@${label}` : "<Subject 1>") : "the subject shown in the supplied image";
    setPrompt(ORB360_PROMPT.replace("@subject", () => subject));
    setPromptBeforeOptimization(null);
    setOptimizedPromptMode(null);
  }

  function addExtraLora() {
    const unused = availableLoras.find((name) => !extraLoras.some((item) => item.name === name));
    if (!unused) return;
    setExtraLoras((current) => [...current, { id: nextLoraId.current++, name: unused, strength: 0.8 }]);
    if (unused === ORB360_LORA && sourceMode !== "text" && !continuationSource && !prompt.trim() && !isOptimizing) applyOrb360Prompt();
  }

  function updateExtraLora(id: number, patch: Partial<ExtraLora>) {
    setExtraLoras((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    if (patch.name === ORB360_LORA && sourceMode !== "text" && !continuationSource && !prompt.trim() && !isOptimizing) applyOrb360Prompt();
  }

  function removeExtraLora(id: number) {
    setExtraLoras((current) => current.filter((item) => item.id !== id));
  }

  function reuseSeed(value: number, source?: GeneratedVideo) {
    if (source?.model === "qwen-image-2.1") {
      setQwenSeed(String(value));
      setView("edit");
    } else {
      setSeed(String(value));
      setRTXMode(false); setEnhancementMode(false); setSwapMode(false);
      setView("create");
    }
    setNotice(`已套用種子 ${value}，同樣設定下會重現相同的畫面。`);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  function restorePrompt() {
    if (promptBeforeOptimization === null) return;
    setPrompt(promptBeforeOptimization);
    setPromptBeforeOptimization(null);
    setOptimizedPromptMode(null);
  }

  async function removeVideo(video: GeneratedVideo) {
    await deleteVideo(video);
    setVideos((current) => current.filter((item) => item.filename !== video.filename || item.subfolder !== video.subfolder));
  }

  async function redoVideo(video: GeneratedVideo) {
    if (video.faceRefined) { setFaceWork(video); return; }
    setFaceEnabled(Boolean(video.faceRefine));
    setFaceSettings(video.faceRefine ?? DEFAULT_FACE_REFINE);
    if (video.swapMode) {
      setRTXMode(false); setEnhancementMode(false); setSwapMode(true); setSwapWork({ ...video }); setView("create");
      return;
    }
    if (!video.prompt || !video.profile || !video.resolution || video.sound === undefined) {
      throw new Error("這支舊作品沒有保存完整生成設定，無法載入。 ");
    }

    setRTXMode(false); setEnhancementMode(false); setSwapMode(false);
    const warnings: string[] = [];
    const inferredSourceMode: SourceMode = video.inputMode === "reference"
      ? "reference"
      : video.firstImagePath || video.lastImagePath
        ? "image"
        : "text";
    const nextSourceMode = video.sourceMode ?? inferredSourceMode;
    if (!video.sourceMode && video.inputMode !== "reference" && !video.firstImagePath && !video.lastImagePath) {
      warnings.push("舊作品未保存文字／首尾圖模式，已先以文字模式載入");
    }

    async function restore(path: string | undefined, label: string) {
      if (!path) return null;
      try {
        return await restoreInputImage(path);
      } catch {
        warnings.push(`${label}已不存在，請重新選擇`);
        return null;
      }
    }

    const referenceFiles = video.referenceFiles ?? [];
    const [restoredFirst, restoredLast, restoredReferences] = await Promise.all([
      restore(video.firstImagePath, "首圖"),
      restore(video.lastImagePath, "尾圖"),
      Promise.all(referenceFiles.map((path, index) => restore(path, `參考圖 ${index + 1}`))),
    ]);
    if (nextSourceMode === "image" && !video.firstImagePath && !video.lastImagePath) {
      warnings.push("原首尾圖沒有保存在作品資料中，請重新選擇");
    }
    if (nextSourceMode === "reference" && !referenceFiles.length) {
      warnings.push("原參考圖沒有保存在作品資料中，請重新選擇");
    }

    let nextDuration = video.duration ?? (video.kind === "image" ? duration : undefined);
    if (!nextDuration) {
      if ((video.clipIndex ?? 1) > 1) {
        nextDuration = 5;
        warnings.push("延伸作品未保存單段秒數，已先設為 5 秒");
      } else {
        try {
          nextDuration = await readVideoDuration(video);
        } catch {
          nextDuration = 5;
          warnings.push("舊作品未保存秒數，已先設為 5 秒");
        }
      }
    }

    referenceImages.forEach((reference) => {
      if (reference.preview) URL.revokeObjectURL(reference.preview);
    });
    const nextReferences = nextSourceMode === "reference" && referenceFiles.length
      ? referenceFiles.map((_, index) => {
          const restored = restoredReferences[index];
          const definition = video.referenceDefinitions?.[index];
          return {
            id: index + 1,
            file: restored?.file ?? null,
            // A restored image is whatever was uploaded last time, crop included.
            // It becomes the new starting point for further cropping.
            originalFile: restored?.file ?? null,
            crop: null,
            preview: restored?.preview ?? null,
            dimensions: restored?.dimensions ?? null,
            label: definition?.label ?? `參考${index + 1}`,
            description: definition?.description ?? "",
          };
        })
      : [emptyReferenceImage(1)];
    nextReferenceId.current = nextReferences.length + 1;

    setContinuationSource(null);
    setSourceMode(nextSourceMode);
    setPrompt(video.prompt);
    setPromptBeforeOptimization(null);
    setOptimizedPromptMode(null);
    setProfile(video.profile === "cooled-fast" ? "fast" : video.profile);
    setAttentionMethod(video.attentionMethod ?? "sage");
    setResolution(video.resolution);
    setDuration(nextDuration);
    setAspect(video.aspect ?? aspectFromDimensions(video.width, video.height));
    setSoundEnabled(video.sound);
    if (typeof video.cooldownSeconds === "number") setCooldownSeconds(Math.max(MIN_COOLDOWN_SECONDS, video.cooldownSeconds));
    setSeed(video.seed === undefined ? "" : String(video.seed));
    setExtraLoras((video.extraLoras ?? []).map((item) => ({ ...item, id: nextLoraId.current++ })));
    setFirstImageFile(restoredFirst?.file ?? null);
    setFirstImageOriginal(restoredFirst?.file ?? null);
    setFirstImageCrop(null);
    setFirstImagePreview(restoredFirst?.preview ?? null);
    setFirstImageDimensions(restoredFirst?.dimensions ?? null);
    setLastImageFile(restoredLast?.file ?? null);
    setLastImageOriginal(restoredLast?.file ?? null);
    setLastImageCrop(null);
    setLastImagePreview(restoredLast?.preview ?? null);
    setLastImageDimensions(restoredLast?.dimensions ?? null);
    setReferenceImages(nextReferences);
    setError("");
    setNotice(`已載入「${video.filename}」的設定，可修改後再生成。${warnings.length ? ` 注意：${warnings.join("；")}。` : ""}`);
    setView("create");
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  function extendVideo(video: GeneratedVideo) {
    if (!video.extendable || !video.profile || !video.resolution || video.sound === undefined || !video.width || !video.height) return;
    setRTXMode(false); setEnhancementMode(false); setSwapMode(false);
    setContinuationSource(video);
    setAttentionMethod(video.attentionMethod ?? "sage");
    setSourceMode(video.inputMode === "reference" ? "reference" : "text");
    setProfile(video.inputMode === "reference" ? video.profile === "cooled-fast" ? "fast" : video.profile : "quality");
    setResolution(video.resolution);
    setSoundEnabled(video.sound);
    setPrompt("");
    setPromptBeforeOptimization(null);
    setOptimizedPromptMode(null);
    setDuration(5);
    setError("");
    setView("create");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function redoImage(image: GeneratedVideo) {
    if (image.model !== "qwen-image-2.1") return redoVideo(image);
    if (!image.prompt) throw new Error("這張圖片沒有保存生成設定，無法載入。 ");
    const warnings: string[] = [];
    const restored = await Promise.all((image.referenceFiles ?? []).map(async (path, index) => {
      try {
        return await restoreInputImage(path);
      } catch {
        warnings.push(`參考圖 ${index + 1} 已不存在，請重新選擇`);
        return null;
      }
    }));
    qwenImages.forEach((item) => URL.revokeObjectURL(item.preview));
    // A restored image is whatever was sent last time, so it is its own original.
    setQwenImages(restored.flatMap((item) => (item
      ? [{ id: nextQwenImageId.current++, file: item.file, originalFile: item.file, cropSourceFile: item.file, crop: null, preview: item.preview }]
      : [])));
    setQwenPrompt(image.qwenCamera ? "" : image.prompt);
    setQwenPromptBeforeOptimization(null);
    if (image.qwenAspect) setQwenAspect(image.qwenAspect);
    setQwenEditAspect(image.qwenEditAspect ?? "auto");
    if (image.qwenSize) setQwenSize(image.qwenSize);
    setQwenModel(image.qwenModel ?? "original");
    if (image.steps) setQwenSteps(image.steps);
    setQwenFast(image.qwenFast === true);
    setQwenCameraEnabled(Boolean(image.qwenCamera));
    setQwenCamera(image.qwenCamera ? {
      ...image.qwenCamera,
      strength: image.qwenCamera.strength ?? image.extraLoras?.find((item) => item.name === QWEN_CAMERA_LORA)?.strength ?? 1,
    } : QWEN_DEFAULT_CAMERA);
    if (typeof image.cooldownSeconds === "number") setQwenCooldownSeconds(Math.max(QWEN_MIN_COOLDOWN_SECONDS, image.cooldownSeconds));
    setQwenSeed(image.seed === undefined ? "" : String(image.seed));
    setError("");
    setNotice(`已載入「${image.filename}」的設定，可修改後再生成。${warnings.length ? ` 注意：${warnings.join("；")}。` : ""}`);
    setView("edit");
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  function chooseProfile(nextProfile: GenerationOptions["profile"]) {
    setProfile(nextProfile);
    if (nextProfile === "safe-long") setResolution("p480");
  }

  function chooseSourceMode(nextMode: SourceMode) {
    setSourceMode(nextMode);
    setPromptBeforeOptimization(null);
    setOptimizedPromptMode(null);
    if (nextMode !== "text" && !continuationSource && extraLoras.some((item) => item.name === ORB360_LORA) && !prompt.trim() && !isOptimizing) applyOrb360Prompt(nextMode);
    if (nextMode === "reference") {
      setProfile("cooled-turbo-8");
      setResolution("native");
      setAspect("16:9");
    } else {
      if (resolution === "native") setResolution("safe");
      if (aspect === "4:3" || aspect === "3:4") setAspect("16:9");
    }
  }

  const navItems: Array<{ id: View; icon: string; label: string }> = [
    { id: "create", icon: "✦", label: "創作影片" },
    { id: "edit", icon: "✎", label: "圖像編輯" },
    { id: "tts", icon: "♫", label: "語音生成" },
    { id: "works", icon: "▦", label: "作品" },
  ];

  const cropFile = cropTarget ? croppableFile(cropTarget) : null;
  const markerImage = qwenImages.find((image) => image.id === markerId);
  const cropReferenceIndex = cropTarget?.kind === "reference"
    ? referenceImages.findIndex((reference) => reference.id === cropTarget.id) + 1
    : cropTarget?.kind === "qwen"
      ? qwenImages.findIndex((image) => image.id === cropTarget.id) + 1
      : 0;

  return (
    <main className="studio-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView("create")} aria-label="返回創作頁">
          <span className="brand-mark">H3</span>
          <span>Local Studio</span>
        </button>
        <div className={`connection ${connected ? "online" : "offline"}`}>
          <span className="status-dot" />
          {connected ? "本機 H3 已連線" : "等待 ComfyUI"}
        </div>
      </header>

      <aside className="sidebar" aria-label="主選單">
        <div className="side-nav">
          {navItems.map((item) => (
            <button
              className={view === item.id ? "nav-item active" : "nav-item"}
              key={item.id}
              disabled={enhancementBusy}
              onClick={() => setView(item.id)}
              title={item.label}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <div className="local-label"><span className="status-dot" />LOCAL</div>
      </aside>

      <section className="content">
        {view === "create" ? <>
          <div className="hero">
              <p className="eyebrow">MINIMAX H3 · LOCAL</p>
              <h1>讓靈感，躍然成片</h1>
              <p>文字、首尾幀或多圖參考，在你的 RTX 4080 Laptop 上生成有聲影片。</p>
            </div>

            <div className="mode-tabs" role="tablist" aria-label="生成來源">
              <button className={!rtxMode && !enhancementMode && !swapMode && sourceMode === "text" ? "active" : ""} onClick={() => { setRTXMode(false); setEnhancementMode(false); setSwapMode(false); chooseSourceMode("text"); }} disabled={Boolean(continuationSource) || isGeneratingH3Image || enhancementBusy}>文字轉影片</button>
              <button className={!rtxMode && !enhancementMode && !swapMode && sourceMode === "image" ? "active" : ""} onClick={() => { setRTXMode(false); setEnhancementMode(false); setSwapMode(false); chooseSourceMode("image"); }} disabled={Boolean(continuationSource) || isGeneratingH3Image || enhancementBusy}>首尾圖生影片</button>
              <button className={!rtxMode && !enhancementMode && !swapMode && sourceMode === "reference" ? "active" : ""} onClick={() => { setRTXMode(false); setEnhancementMode(false); setSwapMode(false); chooseSourceMode("reference"); }} disabled={Boolean(continuationSource) || isGeneratingH3Image || enhancementBusy}>參考生影片</button>
              <button className={swapMode ? "active" : ""} onClick={() => { setRTXMode(false); setSwapMode(true); setEnhancementMode(false); }} disabled={Boolean(continuationSource) || isGeneratingH3Image || enhancementBusy}>影片換角</button>
              <button className={enhancementMode ? "active" : ""} onClick={() => { setRTXMode(false); setSwapMode(false); setEnhancementMode(true); }} disabled={Boolean(continuationSource) || isGeneratingH3Image || enhancementBusy}>影片畫質提升</button>
              <button className={rtxMode ? "active" : ""} onClick={() => { setSwapMode(false); setEnhancementMode(false); setRTXMode(true); }} disabled={Boolean(continuationSource) || isGeneratingH3Image || enhancementBusy}>RTX提升</button>
            </div>
        </> : view === "edit" ? <div className="hero">
              <p className="eyebrow">QWEN-IMAGE 2.1 · LOCAL</p>
              <h1>圖像編輯</h1>
              <p>用文字生成圖像，或上傳圖片後用一句指令編輯；擅長文字排版與多圖參考。</p>
            </div> : null}
        <div className="studio-workspace">
          <div className="studio-editor">
        <div hidden={view !== "create" || !swapMode}>
          <SwapStudio connected={connected} disabled={enhancementBusy || isGeneratingH3Image} enqueue={generationQueue.add} onComplete={() => void refreshHistory()} initialWork={swapWork} />
        </div>
        <div hidden={view !== "create" || !rtxMode}>
          <RTXStudio videos={videoWorks} connected={connected} disabled={enhancementBusy || isGeneratingH3Image} queueBusy={queueBusy} enqueue={generationQueue.add} onComplete={() => void refreshHistory()} />
        </div>
        {view === "create" ? (
          <>
            {enhancementMode ? <EnhanceStudio videos={videoWorks} connected={connected} disabled={isGeneratingH3Image} executionDisabled={queueBusy} onBusyChange={setEnhancementBusy} onComplete={() => void refreshHistory()} /> : swapMode || rtxMode ? null : <>
            <section className="composer" aria-label="影片生成設定">
              {continuationSource && (
                <div className="continuation-banner">
                  <div><strong>正在延伸影片</strong><span title={continuationSource.filename}>{continuationSource.filename}</span></div>
                  <p>
                    {continuationSource.inputMode === "reference"
                      ? `沿用原本 ${continuationSource.referenceFiles?.length ?? 0} 張參考圖與標籤，並以原片最後一幀銜定新片開頭；完成後會移除重複銜定幀再合併。`
                      : <>解析度、比例與聲音會沿用原片；延伸固定使用相容的 QUALITY 20 步。
                        {(continuationSource.profile === "fast" || continuationSource.profile === "cooled-fast" || continuationSource.profile === "cooled-turbo-4" || continuationSource.profile === "cooled-turbo-8") && " 原片使用 Turbo，但 Turbo LoRA 不相容動態延伸。"}</>}
                    提示詞先延續上一鏡位，再描述接下來的動作。
                  </p>
                  <button onClick={() => setContinuationSource(null)}>取消延伸</button>
                </div>
              )}
              {!continuationSource && (sourceMode === "image" || sourceMode === "reference") && (
                <div className="keyframe-upload-section">
                  <p>{sourceMode === "reference" ? "首圖與尾圖皆選填；不選就是純參考生影片。首尾圖控制開頭與結尾，其他參考圖用來指定人物、物件或風格。" : "首圖與尾圖至少選擇一張；只選尾圖也能生成。"}</p>
                  <div className="keyframe-upload-grid">
                    <label className="image-dropzone" htmlFor="first-frame-upload" {...imageDropHandlers((files) => void chooseImage(files[0], "first"))}>
                      <input id="first-frame-upload" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { void chooseImage(event.target.files?.[0] ?? null, "first"); event.target.value = ""; }} />
                      {firstImagePreview ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={firstImagePreview} alt="首幀預覽" />
                          <span>更換首幀圖片</span>
                          <CropActions
                            hasCrop={Boolean(firstImageCrop)}
                            onCrop={() => setCropTarget({ kind: "first" })}
                            onRestore={() => void restoreOriginalImage({ kind: "first" })}
                            onRemove={() => void chooseImage(null, "first")}
                          />
                        </>
                      ) : (
                        <>
                          <span className="upload-icon">＋</span>
                          <strong>選擇首幀圖片</strong>
                          <small>可點選或拖入圖片 · 控制影片起始畫面</small>
                        </>
                      )}
                    </label>
                    <label className="image-dropzone" htmlFor="last-frame-upload" {...imageDropHandlers((files) => void chooseImage(files[0], "last"))}>
                      <input id="last-frame-upload" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { void chooseImage(event.target.files?.[0] ?? null, "last"); event.target.value = ""; }} />
                      {lastImagePreview ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={lastImagePreview} alt="尾幀預覽" />
                          <span>更換尾幀圖片</span>
                          <CropActions
                            hasCrop={Boolean(lastImageCrop)}
                            onCrop={() => setCropTarget({ kind: "last" })}
                            onRestore={() => void restoreOriginalImage({ kind: "last" })}
                            onRemove={() => void chooseImage(null, "last")}
                          />
                        </>
                      ) : (
                        <>
                          <span className="upload-icon">＋</span>
                          <strong>選擇尾幀圖片</strong>
                          <small>可點選或拖入圖片 · 控制影片結尾畫面</small>
                        </>
                      )}
                    </label>
                  </div>
                </div>
              )}

              {!continuationSource && sourceMode === "reference" && (
                <div className="reference-upload-section">
                  <div className="reference-section-heading">
                    <div>
                      <strong>參考物件</strong>
                      <p>每張圖設定一個 @標籤；參考說明可選填，正文可直接用標籤指定角色、物件、場景或風格。</p>
                    </div>
                    <button type="button" onClick={addReferenceImage} disabled={referenceImages.length >= 9}>＋ 新增參考</button>
                  </div>
                  <div className="reference-list">
                    {referenceImages.map((reference, index) => (
                      <article className="reference-card" key={reference.id}>
                        <label className="reference-image" htmlFor={`reference-image-${reference.id}`} {...imageDropHandlers((files) => void chooseReferenceImage(files[0], reference.id))}>
                          <input
                            id={`reference-image-${reference.id}`}
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            onChange={(event) => { void chooseReferenceImage(event.target.files?.[0] ?? null, reference.id); event.target.value = ""; }}
                          />
                          {reference.preview ? (
                            <>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={reference.preview} alt={`參考圖片 ${index + 1}`} />
                              <span>更換圖片</span>
                              <CropActions
                                hasCrop={Boolean(reference.crop)}
                                onCrop={() => setCropTarget({ kind: "reference", id: reference.id })}
                                onRestore={() => void restoreOriginalImage({ kind: "reference", id: reference.id })}
                              />
                            </>
                          ) : (
                            <><span className="upload-icon">＋</span><strong>選擇參考圖 {index + 1}</strong><small>可點選或拖入圖片</small></>
                          )}
                        </label>
                        <div className="reference-fields">
                          <div className="reference-index"><span>&lt;Picture {index + 1}&gt;</span><button type="button" onClick={() => removeReferenceImage(reference.id)}>移除</button></div>
                          <label>
                            <span>@標籤</span>
                            <div className="reference-tag-input"><b>@</b><input value={reference.label} onChange={(event) => updateReference(reference.id, "label", event.target.value)} placeholder="例如：女主角" /></div>
                          </label>
                          <label>
                            <span>參考說明（選填）</span>
                            <textarea value={reference.description} onChange={(event) => updateReference(reference.id, "description", event.target.value)} placeholder="不填時會依圖片與 @標籤推斷；也可指定只參考服裝、左側人物或場景構圖。" />
                          </label>
                          <button
                            className="insert-reference-button"
                            type="button"
                            disabled={!reference.label.trim()}
                            onClick={() => {
                              setPrompt((current) => `${current}${current && !/\s$/.test(current) ? " " : ""}@${reference.label.trim()} `);
                              setPromptBeforeOptimization(null);
                              setOptimizedPromptMode(null);
                            }}
                          >
                            插入 @{reference.label.trim() || "標籤"} 到描述
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              )}

              <div className={`prompt-editor${validReferenceTags.length ? " has-highlights" : ""}`}>
                {validReferenceTags.length > 0 && (
                  <div className="prompt-highlight" ref={promptHighlightRef} aria-hidden="true">
                    {highlightReferenceTags(prompt, validReferenceTags)}
                  </div>
                )}
                <textarea
                  value={prompt}
                  onChange={(event) => {
                    setPrompt(event.target.value);
                    setPromptBeforeOptimization(null);
                    setOptimizedPromptMode(null);
                  }}
                  onScroll={(event) => {
                    if (!promptHighlightRef.current) return;
                    promptHighlightRef.current.scrollTop = event.currentTarget.scrollTop;
                    promptHighlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
                  }}
                  placeholder={sourceMode === "reference" ? "例如：@女主角 站在 @咖啡店 的窗邊，低頭整理 @銀色項鍊；鏡頭緩慢推近，保持所有參考物件的外觀一致。" : EXAMPLE_PROMPT}
                  aria-label="影片描述"
                  disabled={isOptimizing}
                />
              </div>

              <div className="prompt-tools">
                <div>
                  <div className="engine-switch" role="group" aria-label="Prompt 優化模型">
                    {(["codex", "grok"] as const).map((engine) => (
                      <button
                        key={engine}
                        className={promptEngine === engine ? "active" : ""}
                        onClick={() => choosePromptEngine(engine)}
                        disabled={isOptimizing}
                      >
                        {engine === "grok" ? "Grok" : "Codex"}
                      </button>
                    ))}
                  </div>
                  <button
                    className="prompt-optimize-button"
                    onClick={optimizePrompt}
                    disabled={!connected || isOptimizing || Boolean(continuationSource)}
                  >
                    <span>✦</span>{isOptimizing ? `${engineLabel} 正在依官方 Skill 優化…` : "官方 H3 Prompt 優化"}
                  </button>
                  {promptBeforeOptimization !== null && (
                    <button className="prompt-restore-button" onClick={restorePrompt} disabled={isOptimizing}>還原原始描述</button>
                  )}
                </div>
                <small>
                  {continuationSource?.inputMode === "reference"
                    ? `會沿用原本的 ${continuationSource.referenceDefinitions?.map((reference) => `@${reference.label}`).join("、") ?? "參考標籤"}，並映射回同一組 Subject／Picture。`
                    : optimizedPromptMode
                    ? `已套用 MiniMax 官方 ${optimizedPromptMode} 格式；請確認內容後再生成。`
                    : sourceMode === "reference"
                      ? `${engineLabel} 會分別分析選填首尾圖與其他參考圖；@標籤只對應其他參考圖的 Subject／Picture。`
                      : `透過背景 ${engineLabel} CLI 套用 MiniMax 官方 Prompt Skill；圖片模式會分析首尾幀。`}
                </small>
              </div>

              {availableLoras.length > 0 && (
                <div className="lora-stack-section">
                  <div className="lora-stack-heading">
                    <div>
                      <strong>額外 LoRA</strong>
                      <p>依序疊在 Turbo LoRA 之後。不加就跟以前完全一樣。</p>
                    </div>
                    <button
                      type="button"
                      onClick={addExtraLora}
                      disabled={extraLoras.length >= availableLoras.length}
                    >＋ 新增 LoRA</button>
                  </div>
                  {extraLoras.map((item, index) => (
                    <div className="lora-row" key={item.id}>
                      <span className="lora-order">{index + 1}</span>
                      <LoraPicker value={item.name} names={availableLoras} usedNames={extraLoras.map((other) => other.name)}
                        onChange={(name) => updateExtraLora(item.id, { name })} />
                      <label className="lora-strength">
                        <span>強度</span>
                        <input
                          type="number"
                          min={0}
                          max={2}
                          step={0.05}
                          value={item.strength}
                          onChange={(event) => updateExtraLora(item.id, { strength: Number(event.target.value) })}
                        />
                      </label>
                      <button type="button" onClick={() => removeExtraLora(item.id)}>移除</button>
                    </div>
                  ))}
                  {sourceMode !== "text" && !continuationSource && extraLoras.some((item) => item.name === ORB360_LORA) && (
                    <p className="lora-stack-note">
                      <button type="button" className="prompt-restore-button" onClick={() => applyOrb360Prompt()} disabled={isOptimizing}>套用環繞提示詞</button>
                      {" "}人物與背景保持靜止，只有鏡頭環繞。套用會替換目前提示詞。
                    </p>
                  )}
                  {extraLoras.length > 0 && (
                    <p className="lora-stack-note">
                      疊加時所有 LoRA 會改用 merge 模式，否則後面的會蓋掉前面的。畫面會比單一 LoRA 稍軟。
                    </p>
                  )}
                </div>
              )}

              <div className={`composer-footer${sourceMode !== "text" && !continuationSource ? " video-face-footer" : ""}`}>
                <div className="controls">
                  <label>
                    <span>模式</span>
                    <select value={profile} onChange={(event) => chooseProfile(event.target.value as GenerationOptions["profile"])} disabled={Boolean(continuationSource)}>
                      {profile === "low-vram" && <option value="low-vram" hidden disabled>舊設定 · {sourceMode === "reference" ? 8 : 6}步（merge）</option>}
                      {sourceMode === "reference" ? (
                        <>
                          <option value="cooled-turbo-4">4步</option>
                          <option value="fast">6步</option>
                          <option value="cooled-turbo-8">8步</option>
                        </>
                      ) : (
                        <>
                          <option value="cooled-turbo-4">4步</option>
                          <option value="fast">6步</option>
                          <option value="cooled-turbo-8">8步</option>
                          <option value="quality">QUALITY · 原生 20 步</option>
                          <option value="safe-long">安全長片 · 低解析生成／480P 輸出</option>
                        </>
                      )}
                    </select>
                  </label>
                  <label className="attention-control">
                    <span>注意力（影片）</span>
                    <select value={sourceMode === "reference" ? "sage" : attentionMethod} onChange={(event) => setAttentionMethod(event.target.value as H3AttentionMethod)} disabled={sourceMode === "reference"}>
                      <option value="sage">SageAttention（原有）</option>
                      <option value="sol">sol-attn + Comfy Kitchen</option>
                    </select>
                  </label>
                  <label>
                    <span>解析度</span>
                    <select value={resolution} onChange={(event) => setResolution(event.target.value as GenerationOptions["resolution"])} disabled={Boolean(continuationSource) || profile === "safe-long"}>
                      {sourceMode === "reference" ? (
                        <>
                          <option value="p480">{sizeLabels.p480} · 480P</option>
                          <option value="p540">{sizeLabels.p540} · 540P</option>
                          <option value="native">{sizeLabels.native} · 原生 H3</option>
                        </>
                      ) : (
                        <>
                          <option value="safe">{sizeLabels.safe} · 省顯存</option>
                          <option value="clear">{sizeLabels.clear} · 清晰</option>
                          <option value="p480">{sizeLabels.p480} · 480P</option>
                          <option value="p540">{sizeLabels.p540} · 540P</option>
                        </>
                      )}
                    </select>
                  </label>
                  <label>
                    <span>秒數</span>
                    <select value={duration} onChange={(event) => setDuration(Number(event.target.value))}>
                      {DURATION_OPTIONS.map((seconds) => <option value={seconds} key={seconds}>約 {seconds} 秒</option>)}
                    </select>
                  </label>
                  <label>
                    <span>畫面</span>
                    {continuationSource ? (
                      <select value="original" disabled>
                        <option value="original">依照原片 · {formatAspect(continuationSource.width!, continuationSource.height!)}</option>
                      </select>
                    ) : sourceMode === "image" ? (
                      <select value="auto" disabled>
                        <option value="auto">依照圖片{imageAspect ? ` · ${imageAspect}` : ""}</option>
                      </select>
                    ) : sourceMode === "reference" && firstImageFile ? (
                      <select value="first-frame" disabled>
                        <option value="first-frame">依照首幀圖{firstImageDimensions ? ` · ${formatAspect(firstImageDimensions.width, firstImageDimensions.height)}` : " · 讀取中"}</option>
                      </select>
                    ) : sourceMode === "reference" ? (
                      <select value={aspect} onChange={(event) => setAspect(event.target.value as GenerationOptions["aspect"])}>
                        <option value="16:9">16:9 橫向</option>
                        <option value="4:3">4:3 橫向</option>
                        <option value="1:1">1:1 方形</option>
                        <option value="3:4">3:4 直向</option>
                        <option value="9:16">9:16 直向</option>
                      </select>
                    ) : (
                      <select value={aspect} onChange={(event) => setAspect(event.target.value as GenerationOptions["aspect"])}>
                        <option value="16:9">16:9 橫向</option>
                        <option value="9:16">9:16 直向</option>
                        <option value="1:1">1:1 方形</option>
                      </select>
                    )}
                  </label>
                  <label>
                    <span>聲音</span>
                    <select value={soundEnabled ? "on" : "off"} onChange={(event) => setSoundEnabled(event.target.value === "on")} disabled={Boolean(continuationSource)}>
                      <option value="on">開啟 · 立體聲</option>
                      <option value="off">關閉 · 無音軌</option>
                    </select>
                  </label>
                  <label>
                    <span>種子</span>
                    <input
                      className="seed-input"
                      value={seed}
                      inputMode="numeric"
                      onChange={(event) => setSeed(event.target.value.replace(/[^0-9]/g, ""))}
                      placeholder="留空 = 每次隨機"
                      aria-label="生成種子"
                    />
                  </label>
                  <label>
                    <span>降溫（每步秒數）</span>
                    <input
                      className="seed-input"
                      type="number"
                      min={MIN_COOLDOWN_SECONDS}
                      step={1}
                      value={cooldownSeconds}
                      onChange={(event) => setCooldownSeconds(Number(event.target.value))}
                      onBlur={(event) => setCooldownSeconds(Math.max(MIN_COOLDOWN_SECONDS, Math.round(Number(event.target.value)) || MIN_COOLDOWN_SECONDS))}
                      aria-label="每步降溫秒數"
                    />
                  </label>
                </div>

                {sourceMode !== "text" && !continuationSource && <div className="face-generation">
                  <label className="face-toggle"><input type="checkbox" checked={faceEnabled} onChange={(event) => setFaceEnabled(event.target.checked)} />生成後自動人臉精修</label>
                  {faceEnabled && <>
                    <FaceSettings value={faceSettings} onChange={setFaceSettings} references={[
                      ...(sourceMode === "reference" ? referenceImages.filter((reference) => reference.file).map((reference) => `@${reference.label || "參考圖"}`) : []),
                      ...(firstImageFile ? ["首幀圖片"] : []), ...(lastImageFile ? ["尾幀圖片"] : []),
                    ]} />
                    <p className="face-help">生成完成後另跑精修，保留原片並另存成品；沿用每步降溫設定。單人模式依每個鏡頭首次出現時的位置選人，多人模式會自動逐組處理。</p>
                    <p className="face-help">多人交錯仍可能追錯；需要逐鏡頭確認時，可從作品列表預覽選臉。</p>
                  </>}
                </div>}
                <div className="generate-actions">
                  {sourceMode !== "image" && (
                    <button className="generate-button image" onClick={generateImage} disabled={!connected || isGenerating || isOptimizing || enhancementBusy}>
                      <span>✦</span>{isGenerating ? "生成中" : "生成圖片"}
                    </button>
                  )}
                  <button className="generate-button" onClick={generate} disabled={!connected || isGeneratingH3Image || isOptimizing || enhancementBusy}>
                    <span>✦</span>{queueBusy ? "加入佇列" : "生成影片"}
                  </button>
                </div>
              </div>

              <div className="setting-note">
                輸出 {outputSize} · 24 FPS · {soundEnabled ? "原生立體聲" : "無音軌（略省資源）"}
                {continuationSource && <span> · 延伸第 {(continuationSource.clipIndex ?? 1) + 1} 段（接續內容約 {duration} 秒）</span>}
                {(sourceMode === "image" || sourceMode === "reference") && firstImageDimensions && <span> · 首圖 {firstImageDimensions.width} × {firstImageDimensions.height}</span>}
                {sourceMode === "image" && lastImageDimensions && (
                  <span> · 尾圖 {lastImageDimensions.width} × {lastImageDimensions.height}{firstImageDimensions ? "（依首圖比例置中裁切）" : "（作為畫面比例基準）"}</span>
                )}
                {sourceMode === "reference" && <span> · Ref2VA W4A8 · {continuationSource?.inputMode === "reference" ? continuationSource.referenceFiles?.length ?? 0 : referenceImages.filter((reference) => reference.file).length} 張參考圖 · Turbo {referenceVideoSteps(profile)} 步</span>}
                <span> · 每步降溫 {cooldownSeconds} 秒 ×{cooldownSteps} 步 ≈ {cooldownSeconds * cooldownSteps} 秒冷卻</span>
                {sourceMode === "reference" ? <span> · 參考生影片使用 SageAttention，sol-attn 尚不相容 LongMedia 記憶體分塊</span> : attentionMethod === "sol" && <span> · sol-attn 稀疏注意力：速度與畫面會隨片長、解析度而變化，短序列會使用一般注意力</span>}
                {profile === "safe-long" && <span> · 安全長片會低解析生成，再以 CPU 放大為 480P；畫面較柔且不支援延伸</span>}
                {profile === "low-vram" && <span> · Turbo LoRA 改用 merge 模式，省下採樣時最大的一筆顯存配置；長片較不易爆顯存，畫面略柔</span>}
                {resolution !== "safe" && <span> · 較高解析度的顯存與時間需求較高</span>}
                {extremeImageRatio && <span> · 極端圖片比例可能降低生成品質</span>}
                {sourceMode !== "image" && <span> · 「生成圖片」忽略秒數、聲音與首尾圖，輸出 2K PNG（{resolveImageDimensions(aspect).join("×")}）</span>}
              </div>
            </section>

            {!connected && (
              <div className="notice warning">請先執行 <code>start_h3_studio.bat</code>；介面偵測到 ComfyUI 後會自動連線。</div>
            )}
            {notice && <div className="notice success" aria-live="polite">{notice}</div>}
            {error && <div className="notice error">{error}</div>}
            {isGeneratingH3Image && (
              <div className="generation-status" aria-live="polite">
                <div className="status-copy"><strong>{statusText}</strong><span>已經過 {elapsed} 秒，請勿關閉 ComfyUI。</span></div>
                <div className="progress-track"><span /></div>
              </div>
            )}

            </>}
            {!enhancementBusy && <RecentSection videos={videoWorks.slice(0, 3)} onViewAll={() => setView("works")} onDelete={removeVideo} onExtend={extendVideo} onRedo={redoVideo} onRefine={setFaceWork} onReuseSeed={reuseSeed} emptyText="第一支影片，從一句話開始" />}
          </>
        ) : view === "edit" ? (
          <>
            <section className="composer" aria-label="圖像編輯設定">
              <div className="qwen-upload-section">
                <p>{qwenCameraEnabled ? "上傳一張原圖後，透過下方的攝影機視角選項生成新的觀看角度。" : "不加圖片就是文字生圖；加了圖片後預設依第一張的比例，也可在「畫面」指定比例並置中裁切。描述裡打 @ 就能挑要指定哪一張（插入 <image1>、<image2>）。"}</p>
                <div className="qwen-image-grid">
                  {qwenImages.map((image, index) => (
                    <div className="qwen-image-slot" key={image.id}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={image.preview} alt={`參考圖 ${index + 1}`} />
                      <span>&lt;image{index + 1}&gt;</span>
                      <CropActions
                        hasCrop={Boolean(image.crop)}
                        hasEdits={image.file !== image.originalFile}
                        disabled={isOptimizing}
                        onMark={() => setMarkerId(image.id)}
                        onCrop={() => setCropTarget({ kind: "qwen", id: image.id })}
                        onRestore={() => void restoreOriginalImage({ kind: "qwen", id: image.id })}
                      />
                      <button type="button" onClick={() => removeQwenImage(image.id)} disabled={isOptimizing}>移除</button>
                    </div>
                  ))}
                  {qwenImages.length < QWEN_MAX_IMAGES && (
                    <label className="image-dropzone qwen-image-slot" htmlFor="qwen-image-upload" {...imageDropHandlers(chooseQwenImages, isOptimizing)}>
                      <input id="qwen-image-upload" type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => { chooseQwenImages(Array.from(event.target.files ?? [])); event.target.value = ""; }} disabled={isOptimizing} />
                      <span className="upload-icon">＋</span>
                      <strong>加入圖片</strong>
                      <small>可點選或拖入圖片 · 最多 {QWEN_MAX_IMAGES} 張</small>
                    </label>
                  )}
                </div>
              </div>

              <div className="qwen-camera-panel">
                <label className="qwen-camera-toggle">
                  <input type="checkbox" checked={qwenCameraEnabled} onChange={(event) => { setQwenCameraEnabled(event.target.checked); setQwenMention(null); }} disabled={isOptimizing} />
                  <span>攝影機視角</span>
                  <small>自動套用視角 LoRA v2</small>
                </label>
                {qwenCameraEnabled && (
                  <>
                    <div className="qwen-camera-controls">
                      <label>
                        <span>水平方位</span>
                        <select aria-label="攝影機水平方位" value={qwenCamera.azimuth} onChange={(event) => setQwenCamera({ ...qwenCamera, azimuth: Number(event.target.value) as QwenCamera["azimuth"] })} disabled={isOptimizing}>
                          {QWEN_CAMERA_AZIMUTHS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                        </select>
                      </label>
                      <label>
                        <span>拍攝角度</span>
                        <select aria-label="攝影機拍攝角度" value={qwenCamera.elevation} onChange={(event) => setQwenCamera({ ...qwenCamera, elevation: Number(event.target.value) as QwenCamera["elevation"] })} disabled={isOptimizing}>
                          {QWEN_CAMERA_ELEVATIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                        </select>
                      </label>
                      <label>
                        <span>景別</span>
                        <select aria-label="攝影機景別" value={qwenCamera.framing} onChange={(event) => setQwenCamera({ ...qwenCamera, framing: event.target.value as QwenCamera["framing"] })} disabled={isOptimizing}>
                          <option value="standard">一般</option>
                          <option value="close-up">近景</option>
                        </select>
                      </label>
                      <label>
                        <span>LoRA 強度 · {(qwenCamera.strength ?? 1).toFixed(2)} <small>（建議 0.8）</small></span>
                        <input type="range" aria-label="攝影機 LoRA 強度" min={0} max={1} step={0.05} value={qwenCamera.strength ?? 1} onChange={(event) => setQwenCamera({ ...qwenCamera, strength: Number(event.target.value) })} disabled={isOptimizing} />
                      </label>
                    </div>
                    <p>請上傳一張原圖，選好視角即可生成，無須填寫提示詞。方位以主體正面為基準，角度為模型的訓練視角，效果可能有偏差。</p>
                    <p>已自動加入保留原場景、背景與光線的要求。強度建議先用 0.80；降低可能減少場景變化，也可能讓轉向變弱，仍無法保證背景完整保留。</p>
                    {qwenImages.length !== 1 && <p role="status">{qwenImages.length === 0 ? "請先加入一張原圖。" : "目前有多張圖片，請保留一張原圖。"}</p>}
                  </>
                )}
              </div>

              <div className="prompt-editor" hidden={qwenCameraEnabled}>
                <textarea
                  ref={qwenPromptRef}
                  value={qwenPrompt}
                  onChange={(event) => {
                    setQwenPrompt(event.target.value);
                    setQwenPromptBeforeOptimization(null);
                    syncQwenMention(event.target);
                  }}
                  onKeyUp={(event) => syncQwenMention(event.currentTarget)}
                  onClick={(event) => syncQwenMention(event.currentTarget)}
                  onKeyDown={handleQwenPromptKeys}
                  onBlur={() => setQwenMention(null)}
                  disabled={isOptimizing}
                  placeholder={qwenImages.length
                    ? "例如：保留 <image1> 的人物、五官與姿勢，把 <image2> 的淺藍色丹寧襯衫穿到人物身上，衣服自然貼合，維持原本背景與光線。"
                    : "例如：雨後黃昏的台北街道，霓虹招牌上寫著「夜市」兩個字，一位穿深色風衣的人走過，水面倒影細緻，電影感寫實風格。"}
                  aria-label="圖像描述"
                />
                {qwenMentionMatches.length > 0 && (
                  <ul className="mention-menu" aria-label="參考圖清單">
                    {qwenMentionMatches.map(({ image, index }, position) => (
                      <li key={image.id}>
                        <button
                          type="button"
                          className={position === qwenMentionActive ? "active" : ""}
                          // The caret has to survive the click, so the textarea must not lose focus.
                          onMouseDown={(event) => {
                            event.preventDefault();
                            insertQwenMention(index);
                          }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={image.preview} alt="" />
                          <span>參考圖 {index + 1}</span>
                          <code>&lt;image{index + 1}&gt;</code>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="prompt-tools qwen-prompt-tools">
                  <div>
                    <button
                      className="prompt-optimize-button"
                      onClick={optimizeQwenPrompt}
                      disabled={!connected || isOptimizing}
                    >
                      <span>✦</span>{isOptimizing ? "Codex 正在優化…" : "優化提示詞"}
                    </button>
                    {qwenPromptBeforeOptimization !== null && (
                      <button className="prompt-restore-button" onClick={restoreQwenPrompt} disabled={isOptimizing}>還原原文</button>
                    )}
                  </div>
                  <small>
                    {qwenPromptBeforeOptimization !== null
                      ? "已填入優化結果，請確認內容後再生成。"
                      : "Codex CLI 使用 gpt-6-sol（推理強度 low），依照原意整理並保留 &lt;imageN&gt; 標記。"}
                  </small>
                </div>
              </div>

              <div className="composer-footer">
                <div className="controls">
                  <label>
                    <span>模型</span>
                    <select value={qwenModel} onChange={(event) => setQwenModel(event.target.value as QwenModel)} aria-label="Qwen 圖像模型">
                      {Object.entries(QWEN_MODELS).map(([value, model]) => (
                        <option key={value} value={value}>{model.label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>畫面</span>
                    <select value={qwenImages.length ? qwenEditAspect : qwenAspect} onChange={(event) => {
                      if (qwenImages.length) setQwenEditAspect(event.target.value as QwenAspect | "auto");
                      else setQwenAspect(event.target.value as QwenAspect);
                    }} aria-label="Qwen 輸出比例">
                      {qwenImages.length > 0 && <option value="auto">依照 &lt;image1&gt;</option>}
                      <option value="1:1">1:1 方形</option>
                      <option value="16:9">16:9 橫向</option>
                      <option value="9:16">9:16 直向</option>
                      <option value="3:2">3:2 橫向</option>
                      <option value="2:3">2:3 直向</option>
                      <option value="4:3">4:3 橫向</option>
                      <option value="3:4">3:4 直向</option>
                    </select>
                  </label>
                  <label>
                    <span>尺寸</span>
                    <select value={qwenSize} onChange={(event) => setQwenSize(event.target.value as QwenSize)}>
                      <option value="1mp">{qwenImages.length ? "約 1024 像素" : QWEN_DIMENSIONS["1mp"][qwenAspect].join(" × ")} · 1MP</option>
                      <option value="2k">{qwenImages.length ? "約 2048 像素" : QWEN_DIMENSIONS["2k"][qwenAspect].join(" × ")} · 2K</option>
                    </select>
                  </label>
                  <label>
                    <span>步數</span>
                    <input
                      className="seed-input"
                      type="number"
                      min={4}
                      max={50}
                      step={1}
                      value={qwenSteps}
                      onChange={(event) => setQwenSteps(Number(event.target.value))}
                      onBlur={(event) => setQwenSteps(Math.min(50, Math.max(4, Math.round(Number(event.target.value)) || QWEN_DEFAULT_STEPS)))}
                      aria-label="採樣步數"
                    />
                  </label>
                  <label>
                    <span>種子</span>
                    <input
                      className="seed-input"
                      value={qwenSeed}
                      inputMode="numeric"
                      onChange={(event) => setQwenSeed(event.target.value.replace(/[^0-9]/g, ""))}
                      placeholder="留空 = 每次隨機"
                      aria-label="生成種子"
                    />
                  </label>
                  <label>
                    <span>張數</span>
                    <select value={qwenCount} onChange={(event) => setQwenCount(Number(event.target.value))} aria-label="每次生成張數">
                      {Array.from({ length: QWEN_MAX_COUNT }, (_, index) => index + 1).map((count) => (
                        <option key={count} value={count}>{count} 張</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>降溫（每步秒數）</span>
                    <input
                      className="seed-input"
                      type="number"
                      min={QWEN_MIN_COOLDOWN_SECONDS}
                      step={1}
                      value={qwenCooldownSeconds}
                      onChange={(event) => setQwenCooldownSeconds(Number(event.target.value))}
                      onBlur={(event) => setQwenCooldownSeconds(Math.max(QWEN_MIN_COOLDOWN_SECONDS, Math.round(Number(event.target.value)) || QWEN_MIN_COOLDOWN_SECONDS))}
                      aria-label="每步降溫秒數"
                    />
                  </label>
                  <label>
                    <span>加速</span>
                    <select value={qwenFast ? "easycache" : "off"} onChange={(event) => setQwenFast(event.target.value === "easycache")} aria-label="EasyCache 加速">
                      <option value="off">標準</option>
                      <option value="easycache">EasyCache 快速</option>
                    </select>
                  </label>
                </div>

                <div className="generate-actions">
                  <button className="generate-button" onClick={generateQwenImage} disabled={!connected || isGeneratingH3Image || enhancementBusy || isOptimizing || (qwenCameraEnabled && qwenImages.length !== 1)}>
                    <span>✦</span>{queueBusy ? "加入佇列" : qwenCameraEnabled ? "生成新視角" : qwenImages.length ? "編輯圖像" : "生成圖像"}
                  </button>
                </div>
              </div>

              <div className="setting-note">
                Qwen-Image 2.1 int8 · {qwenImages.length
                  ? `${qwenImages.length} 張參考圖 · ${qwenEditAspect === "auto" ? "依 <image1> 比例" : `第一張置中裁切為 ${qwenEditAspect}`}，約 ${qwenSize === "2k" ? 2048 : 1024} 像素`
                  : `輸出 ${QWEN_DIMENSIONS[qwenSize][qwenAspect].join(" × ")}`}
                <span> · {qwenSteps} 步 · 每步降溫 {qwenCooldownSeconds} 秒 ≈ {qwenCooldownSeconds * Math.max(0, qwenSteps - 1)} 秒冷卻（最後一步不休息）</span>
                {qwenFast && <span> · EasyCache 會跳過變化小的步數，較快但細節可能略軟</span>}
                {qwenImages.length > 0 && qwenEditAspect !== "auto" && <span> · 裁切會移除邊緣內容，可先用第一張圖的裁切工具調整構圖；輸出尺寸會對齊 32 像素</span>}
                {qwenCooldownSeconds === 0 && <span> · 0 秒＝完全不降溫，長時間連跑請自行留意溫度</span>}
                {qwenCount > 1 && <span> · {qwenCount} 張各自不同種子{qwenSeed.trim() ? `（${qwenSeed} 起連號）` : ""}，逐張生成</span>}
                <span> · PNG 儲存到 ComfyUI/output/H3_Image</span>
                {qwenSize === "2k" && <span> · 2K 在 12 GB 顯存上尚未實測</span>}
              </div>
            </section>

            {!connected && (
              <div className="notice warning">請先執行 <code>start_h3_studio.bat</code>；介面偵測到 ComfyUI 後會自動連線。</div>
            )}
            {notice && <div className="notice success" aria-live="polite">{notice}</div>}
            {error && <div className="notice error">{error}</div>}
            {isGeneratingH3Image && (
              <div className="generation-status" aria-live="polite">
                <div className="status-copy"><strong>{statusText}</strong><span>已經過 {elapsed} 秒，請勿關閉 ComfyUI。</span></div>
                <div className="progress-track"><span /></div>
              </div>
            )}

            <section className="recent-section">
              <div className="section-heading"><div><p className="eyebrow">LOCAL CREATIONS</p><h2>最近作品</h2></div><button onClick={() => { setWorksTab("image"); setView("works"); }}>查看全部 →</button></div>
              <ImageGrid videos={qwenWorks.slice(0, 3)} onDelete={removeVideo} onRedo={redoImage} onReuseSeed={reuseSeed} emptyText="第一張圖，從一句話開始" />
            </section>
          </>
        ) : view === "works" ? (
          <section className="works-page">
            <div className="works-heading">
              <div>
                <p className="eyebrow">LOCAL CREATIONS</p><h1>我的作品</h1>
                <p>{worksTab === "image" ? "圖片儲存在本機 ComfyUI/output/H3_Image。" : worksTab === "audio" ? "聲音儲存在本機 ComfyUI/output/H3_Audio。" : "影片都儲存在本機 ComfyUI/output/video。"}</p>
              </div>
              <button className="secondary-button" onClick={refreshHistory}>↻ 重新整理</button>
            </div>
            <div className="works-tabs" role="tablist">
              <button role="tab" aria-selected={worksTab === "video"} className={worksTab === "video" ? "active" : ""} onClick={() => setWorksTab("video")}>影片（{videoWorks.length}）</button>
              <button role="tab" aria-selected={worksTab === "image"} className={worksTab === "image" ? "active" : ""} onClick={() => setWorksTab("image")}>圖片（{imageWorks.length}）</button>
              <button role="tab" aria-selected={worksTab === "audio"} className={worksTab === "audio" ? "active" : ""} onClick={() => setWorksTab("audio")}>聲音（{audioWorks.length}）</button>
            </div>
            {worksTab === "image"
              ? <ImageGrid videos={imageWorks} onDelete={removeVideo} onRedo={redoImage} onReuseSeed={reuseSeed} emptyText="目前還沒有本次工作階段的圖片" />
              : worksTab === "audio"
                ? <AudioGrid audios={audioWorks} onDelete={removeVideo} onRedo={(audio) => { setDramaWork(audio); setView("tts"); }} />
              : <VideoGrid videos={videoWorks} onDelete={removeVideo} onExtend={extendVideo} onRedo={redoVideo} onRefine={setFaceWork} onReuseSeed={reuseSeed} emptyText="目前還沒有本次工作階段的作品" />}
          </section>
        ) : <SpeechStudio key={dramaWork?.filename ?? "speech"} enqueue={generationQueue.add} disabled={enhancementBusy || isGeneratingH3Image} initialSettings={dramaWork?.drama3} onGenerated={(audio) => {
          setVideos((current) => [audio, ...current.filter((item) => item.filename !== audio.filename || item.subfolder !== audio.subfolder)]);
          setWorksTab("audio");
        }} />}
          </div>
          {generationJobs.length > 0 && <GenerationQueuePanel jobs={generationJobs} elapsed={elapsed} onRemove={generationQueue.remove} />}
          {activeFaceControl && <button type="button" className="face-stop" onClick={() => void cancelFace(activeFaceControl).catch((caught) => setError(String(caught)))}>停止人臉精修（保留原片）</button>}
        </div>
      </section>

      {faceWork && <FaceRefineStudio key={`${faceWork.subfolder}/${faceWork.filename}`} source={faceWork} queueBusy={queueBusy} disabled={!connected || enhancementBusy || isGeneratingH3Image} enqueue={generationQueue.add} removeJob={generationQueue.remove} onBusyChange={setEnhancementBusy} onClose={() => setFaceWork(null)} onComplete={(video) => { setVideos((current) => [video, ...current.filter((item) => item.filename !== video.filename)]); void refreshHistory(); }} />}
      {markerImage && (
        <ImageMarker
          key={markerImage.id}
          file={markerImage.file}
          onCancel={() => setMarkerId(null)}
          onApply={(file) => {
            const preview = URL.createObjectURL(file);
            setQwenImages((images) => images.map((image) => {
              if (image.id !== markerId) return image;
              URL.revokeObjectURL(image.preview);
              return { ...image, file, cropSourceFile: file, crop: null, preview };
            }));
            setQwenPromptBeforeOptimization(null);
            setMarkerId(null);
          }}
        />
      )}
      {cropTarget && cropFile && (
        <ImageCropper
          file={cropFile}
          title={cropTarget.kind === "reference" || cropTarget.kind === "qwen"
            ? `裁切參考圖 ${cropReferenceIndex}`
            : cropTarget.kind === "first" ? "裁切首幀圖片" : "裁切尾幀圖片"}
          hint={cropTarget.kind === "qwen"
            ? cropReferenceIndex === 1 && qwenEditAspect !== "auto"
              ? `裁切框鎖定 ${qwenEditAspect}，拖曳選擇要保留的構圖；第一張參考圖會決定輸出比例。`
              : "只留下要參考的部分。參考圖會被縮到設定的像素量，裁得越準細節越多；預設依 <image1> 裁完的比例輸出。"
            : cropTarget.kind === "reference"
              ? "只留下要參考的部分，例如臉部。參考圖會被縮到與輸出畫面相同的像素量，所以裁得越準，臉的細節就越多。裁切比例不影響輸出畫面。"
              : `裁切框鎖定 ${aspect}，因為首尾圖的比例決定輸出影片的畫面比例。`}
          aspect={cropTarget.kind === "qwen"
            ? cropReferenceIndex === 1 && qwenEditAspect !== "auto" ? CROP_ASPECT[qwenEditAspect] : undefined
            : cropTarget.kind === "reference" ? undefined : CROP_ASPECT[aspect]}
          onCancel={() => setCropTarget(null)}
          onApply={(rect) => void applyCrop(rect)}
        />
      )}
    </main>
  );
}

function CropActions({ hasCrop, hasEdits = hasCrop, onCrop, onMark, onRemove, onRestore, disabled = false }: { hasCrop: boolean; hasEdits?: boolean; onCrop: () => void; onMark?: () => void; onRemove?: () => void; onRestore: () => void; disabled?: boolean }) {
  // The thumbnail is a <label> for the file input, so a plain click here would
  // also reopen the file picker.
  function intercept(action: () => void) {
    return (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      action();
    };
  }

  return (
    <span className="crop-actions">
      <button type="button" onClick={intercept(onCrop)} disabled={disabled}>{hasCrop ? "重新裁切" : "裁切"}</button>
      {onMark && <button type="button" onClick={intercept(onMark)} disabled={disabled}>畫記號</button>}
      {hasEdits && <button type="button" onClick={intercept(onRestore)} disabled={disabled}>還原原圖</button>}
      {onRemove && <button type="button" onClick={intercept(onRemove)} disabled={disabled}>移除圖片</button>}
    </span>
  );
}

function formatAspect(width: number, height: number) {
  const divisor = greatestCommonDivisor(width, height);
  const reducedWidth = width / divisor;
  const reducedHeight = height / divisor;
  if (reducedWidth <= 30 && reducedHeight <= 30) return `${reducedWidth}:${reducedHeight}`;
  return width >= height ? `${(width / height).toFixed(2)}:1` : `1:${(height / width).toFixed(2)}`;
}

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

function highlightReferenceTags(value: string, tags: string[]) {
  const uniqueTags = [...new Set(tags)].sort((left, right) => right.length - left.length);
  if (!value || !uniqueTags.length) return value;
  const escapedTags = uniqueTags.map((tag) => tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`@(?:${escapedTags.join("|")})(?![\\p{L}\\p{N}_-])`, "gu");
  const parts: Array<string | React.ReactElement> = [];
  let start = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > start) parts.push(value.slice(start, index));
    parts.push(<mark className="prompt-tag-highlight" key={`${index}-${match[0]}`}>{match[0]}</mark>);
    start = index + match[0].length;
  }
  if (start < value.length) parts.push(value.slice(start));
  return parts;
}

function aspectFromDimensions(width?: number, height?: number): GenerationOptions["aspect"] {
  if (!width || !height) return "16:9";
  const ratio = width / height;
  const candidates: Array<[GenerationOptions["aspect"], number]> = [["16:9", 16 / 9], ["4:3", 4 / 3], ["1:1", 1], ["3:4", 3 / 4], ["9:16", 9 / 16]];
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate[1] - ratio) < Math.abs(best[1] - ratio) ? candidate : best,
  )[0];
}

async function restoreInputImage(path: string) {
  const response = await fetch(inputImageUrl(path));
  if (!response.ok) throw new Error("Input image not found");
  const blob = await response.blob();
  const filename = path.replaceAll("\\", "/").split("/").pop() ?? "reference-image";
  const file = new File([blob], filename, { type: blob.type });
  const bitmap = await createImageBitmap(file);
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return { file, preview: URL.createObjectURL(file), dimensions };
}

function readVideoDuration(video: GeneratedVideo) {
  return new Promise<number>((resolve, reject) => {
    const media = document.createElement("video");
    media.preload = "metadata";
    media.onloadedmetadata = () => {
      const seconds = Math.max(1, Math.min(15, Math.round(media.duration)));
      media.removeAttribute("src");
      resolve(seconds);
    };
    media.onerror = () => {
      media.removeAttribute("src");
      reject(new Error("Video metadata unavailable"));
    };
    media.src = outputUrl(video);
  });
}

type VideoGridActions = {
  videos: GeneratedVideo[];
  onDelete: (video: GeneratedVideo) => Promise<void>;
  onReuseSeed: (seed: number) => void;
  onExtend: (video: GeneratedVideo) => void;
  onRedo: (video: GeneratedVideo) => Promise<void>;
  onRefine: (video: GeneratedVideo) => void;
  emptyText: string;
};

function RecentSection({ videos, onViewAll, onDelete, onExtend, onRedo, onRefine, onReuseSeed, emptyText }: VideoGridActions & { onViewAll: () => void }) {
  return (
    <section className="recent-section">
      <div className="section-heading"><div><p className="eyebrow">LOCAL CREATIONS</p><h2>最近作品</h2></div><button onClick={onViewAll}>查看全部 →</button></div>
      <VideoGrid videos={videos} onDelete={onDelete} onExtend={onExtend} onRedo={onRedo} onRefine={onRefine} onReuseSeed={onReuseSeed} emptyText={emptyText} />
    </section>
  );
}

function VideoGrid({ videos, onDelete, onExtend, onRedo, onRefine, onReuseSeed, emptyText }: VideoGridActions) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [loadingRedo, setLoadingRedo] = useState<string | null>(null);

  async function confirmDelete(video: GeneratedVideo) {
    const key = `${video.subfolder}/${video.filename}`;
    setOpenMenu(null);
    if (!window.confirm(`確定要刪除「${video.filename}」嗎？\n影片會移到 Windows 資源回收筒。`)) return;
    setDeleting(key);
    try {
      await onDelete(video);
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : "刪除失敗，請稍後再試。 ");
    } finally {
      setDeleting(null);
    }
  }

  async function loadForRedo(video: GeneratedVideo) {
    const key = `${video.subfolder}/${video.filename}`;
    setOpenMenu(null);
    setLoadingRedo(key);
    try {
      await onRedo(video);
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : "無法載入這支作品的設定。 ");
    } finally {
      setLoadingRedo(null);
    }
  }

  if (videos.length === 0) {
    return <div className="empty-state"><span>✦</span><strong>{emptyText}</strong><p>完成生成後，影片會自動出現在這裡。</p></div>;
  }
  return (
    <div className="video-grid">
      {videos.map((video) => {
        const src = outputUrl(video);
        const key = `${video.subfolder}/${video.filename}`;
        return (
          <article className="video-card" key={key}>
            {/* Generated clips do not have a separate caption file. */}
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video controls preload="metadata" src={src} />
            <div>
              <div className="video-meta">
                <span title={video.filename}>{video.filename}</span>
                {video.faceRefined && <small title={`來源：${video.faceRefineSource?.filename}`}>人臉精修{video.faceRefinePeopleTotal ? ` · 逐人修復 ${video.faceRefinePeopleCompleted}/${video.faceRefinePeopleTotal} 組` : ""} · {video.faceRefineSteps ?? 20} 步{video.faceRefine?.mode === "turbo-8" ? " · 無音訊約束" : ""} · 強度 {video.faceRefine?.strength}</small>}
                {video.enhanced && <small title={`來源：${video.enhancementSource}`}>畫質提升 · 720p · {video.enhancementStrength}%</small>}
                {video.rtxOperation && <small title={`來源：${video.rtxSource}`}>RTX {video.rtxOperation === "fps" ? "補幀" : "超解析"} · {video.rtxMultiplier} 倍 · {video.width} × {video.height} · {video.fps} fps</small>}
                {video.swapMode && <small title={`來源：${video.swapSource}`}>{SWAP_LABELS[video.swapMode]} · {video.steps} 步 · {video.swapCompletedSegments}／{video.swapTotalSegments} 段</small>}
                {video.generationSeconds !== undefined && <small>耗時 {video.generationSeconds} 秒</small>}
                {video.attentionMethod && <small>注意力 · {video.attentionMethod === "sol" ? "sol-attn + Comfy Kitchen" : "SageAttention"}</small>}
                {video.extraLoras?.length ? (
                  <small title={video.extraLoras.map((l) => `${l.name} @${l.strength}`).join(", ")}>
                    LoRA {video.extraLoras.map((l) => `${l.name.replace(/\.safetensors$/, "")} @${l.strength}`).join("、")}
                  </small>
                ) : null}
                {video.seed !== undefined && (
                  <small className="seed-line">
                    種子 <code>{video.seed}</code>
                    <button type="button" onClick={() => onReuseSeed(video.seed!)}>沿用</button>
                  </small>
                )}
                {video.extendable && <small>第 {video.clipIndex ?? 1} 段 · 可延伸</small>}
              </div>
              <div className="card-actions">
                <a href={src} target="_blank" rel="noreferrer">開啟 ↗</a>
                <div className="more-menu">
                  <button className="more-button" onClick={() => setOpenMenu(openMenu === key ? null : key)} aria-label={`${video.filename} 影片操作`} aria-haspopup="menu" aria-expanded={openMenu === key}>影片操作 ▾</button>
                  {openMenu === key && (
                    <div className="menu-popover" role="menu">
                      <a className="download-action" href={src} download={video.filename} role="menuitem" onClick={() => setOpenMenu(null)}>下載影片</a>
                      <button role="menuitem" onClick={() => { setOpenMenu(null); onRefine(video); }}>人臉精修</button>
                      <button className="extend-action" role="menuitem" onClick={() => { setOpenMenu(null); onExtend(video); }} disabled={!video.extendable}>
                        {video.extendable ? "延伸影片" : video.inputMode === "reference" && (video.referenceFiles?.length ?? 0) > 8 ? "延伸影片（最多沿用 8 張參考圖）" : "延伸影片（作品無延伸資料）"}
                      </button>
                      <button className="redo-action" role="menuitem" onClick={() => void loadForRedo(video)} disabled={loadingRedo === key || !video.prompt || !video.profile || !video.resolution || video.sound === undefined}>
                        {loadingRedo === key ? "正在載入設定…" : video.prompt && video.profile && video.resolution && video.sound !== undefined ? "再做一次" : "再做一次（作品無原始設定）"}
                      </button>
                      <button className="delete-action" role="menuitem" onClick={() => void confirmDelete(video)} disabled={deleting === key}>刪除影片</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

type ImageGridActions = {
  videos: GeneratedVideo[];
  onDelete: (video: GeneratedVideo) => Promise<void>;
  onRedo: (video: GeneratedVideo) => Promise<void>;
  onReuseSeed: (seed: number, source: GeneratedVideo) => void;
  emptyText: string;
};

function ImageGrid({ videos, onDelete, onRedo, onReuseSeed, emptyText }: ImageGridActions) {
  const [deleting, setDeleting] = useState<string | null>(null);
  const [loadingRedo, setLoadingRedo] = useState<string | null>(null);

  async function loadForRedo(image: GeneratedVideo) {
    const key = `${image.subfolder}/${image.filename}`;
    setLoadingRedo(key);
    try {
      await onRedo(image);
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : "無法載入這張圖片的設定。 ");
    } finally {
      setLoadingRedo(null);
    }
  }

  async function confirmDelete(image: GeneratedVideo) {
    const key = `${image.subfolder}/${image.filename}`;
    if (!window.confirm(`確定要刪除「${image.filename}」嗎？\n圖片會移到 Windows 資源回收筒。`)) return;
    setDeleting(key);
    try {
      await onDelete(image);
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : "刪除失敗，請稍後再試。 ");
    } finally {
      setDeleting(null);
    }
  }

  if (videos.length === 0) {
    return <div className="empty-state"><span>✦</span><strong>{emptyText}</strong><p>完成生成後，圖片會自動出現在這裡。</p></div>;
  }
  return (
    <div className="video-grid">
      {videos.map((image) => {
        const src = outputUrl(image);
        const key = `${image.subfolder}/${image.filename}`;
        return (
          <article className="video-card image-card" key={key}>
            {/* Local ComfyUI output served from localhost; next/image optimization is unnecessary. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <a href={src} target="_blank" rel="noreferrer"><img src={src} alt={image.prompt ?? image.filename} loading="lazy" /></a>
            <div>
              <div className="video-meta">
                <span title={image.filename}>{image.filename}</span>
                {image.generationSeconds !== undefined && <small>耗時 {image.generationSeconds} 秒</small>}
                {image.width && image.height ? <small>{image.width} × {image.height}</small> : null}
                {(image.model === "qwen-image-2.1" || image.seed !== undefined) && (
                  <div className="image-generation-info">
                    {image.model === "qwen-image-2.1" && <small>{QWEN_MODELS[image.qwenModel ?? "original"].label}{image.steps ? ` · ${image.steps} 步` : ""}{image.qwenFast ? " · EasyCache" : ""}</small>}
                    {image.seed !== undefined && (
                      <small className="seed-line">
                        種子 <code>{image.seed}</code>
                        <button type="button" onClick={() => onReuseSeed(image.seed!, image)}>沿用</button>
                      </small>
                    )}
                  </div>
                )}
              </div>
              <div className="card-actions">
                <a href={src} target="_blank" rel="noreferrer">開啟 ↗</a>
                <a className="img-action" href={src} download={image.filename}>下載</a>
                <button className="img-action" onClick={() => void loadForRedo(image)} disabled={loadingRedo === key || !image.prompt} title={image.prompt ? undefined : "作品無原始設定"}>
                  {loadingRedo === key ? "載入中…" : "再做一次"}
                </button>
                <button className="img-action delete" onClick={() => void confirmDelete(image)} disabled={deleting === key}>刪除</button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function AudioGrid({ audios, onDelete, onRedo }: { audios: GeneratedVideo[]; onDelete: (audio: GeneratedVideo) => Promise<void>; onRedo: (audio: GeneratedVideo) => void }) {
  const [deleting, setDeleting] = useState<string | null>(null);

  async function confirmDelete(audio: GeneratedVideo) {
    const key = `${audio.subfolder}/${audio.filename}`;
    if (!window.confirm(`確定要刪除「${audio.filename}」嗎？\n聲音會移到 Windows 資源回收筒。`)) return;
    setDeleting(key);
    try {
      await onDelete(audio);
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : "刪除失敗，請稍後再試。 ");
    } finally {
      setDeleting(null);
    }
  }

  if (audios.length === 0) {
    return <div className="empty-state"><span>♫</span><strong>還沒有聲音作品</strong><p>到「語音生成」製作第一段語音。</p></div>;
  }
  return (
    <div className="video-grid">
      {audios.map((audio) => (
        <article className="video-card audio-card" key={`${audio.subfolder}/${audio.filename}`}>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls preload="metadata" src={outputUrl(audio)} />
          <div>
            <div className="video-meta">
              <span title={audio.filename}>{audio.filename}</span>
              {audio.voice && <small>聲線 {audio.voice}</small>}
              {audio.model === "gemini-3.8-flash-tts" && <small>Gemini 3.8 Flash TTS</small>}
              {audio.model === "gemini-3.8-flash-lite-tts" && <small>Gemini 3.8 Flash-Lite TTS</small>}
              {audio.model === "drama3" && <small>Drama3 多人配音 · 種子 {audio.seed}</small>}
            </div>
            <div className="card-actions">
              <a className="img-action" href={audio.model === "drama3" ? drama3DownloadUrl(audio.filename) : audioDownloadUrl(audio.filename)}>下載 {audio.model === "drama3" ? "FLAC" : "WAV"}</a>
              {audio.model === "drama3" && audio.drama3 && <button className="img-action" onClick={() => onRedo(audio)}>再做一次</button>}
              <button className="img-action delete" onClick={() => void confirmDelete(audio)} disabled={deleting === `${audio.subfolder}/${audio.filename}`}>刪除</button>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
