"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildReferencePrompt,
  checkConnection,
  createImage,
  createVideo,
  deleteVideo,
  GeneratedVideo,
  GenerationOptions,
  ExtraLora,
  getAvailableLoras,
  getRecentVideos,
  inputImageUrl,
  MIN_COOLDOWN_SECONDS,
  optimizeVideoPrompt,
  outputUrl,
  PromptEngine,
  ReferenceImageInput,
  resolveOutputDimensions,
} from "@/lib/comfy";
import { CropRect, cropImageFile, ImageCropper, readImageDimensions } from "./image-cropper";

type View = "create" | "works";
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
type CropTarget = { kind: "first" } | { kind: "last" } | { kind: "reference"; id: number };

const CROP_ASPECT: Record<GenerationOptions["aspect"], number> = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1 };

const EXAMPLE_PROMPT =
  "電影感寫實風格，雨後黃昏的台北街道，一位穿深色風衣的人緩慢走過霓虹燈下，鏡頭低角度向前跟拍，水面倒影細緻，微風吹動衣角。環境音：細雨、遠方車流、輕柔低沉的配樂。不要文字、字幕、Logo 或浮水印。";
const DURATION_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

function emptyReferenceImage(id: number): ReferenceImageDraft {
  return { id, file: null, originalFile: null, crop: null, preview: null, dimensions: null, label: "", description: "" };
}

export default function Home() {
  const [view, setView] = useState<View>("create");
  const [worksTab, setWorksTab] = useState<"video" | "image">("video");
  const [sourceMode, setSourceMode] = useState<SourceMode>("text");
  const [connected, setConnected] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [profile, setProfile] = useState<GenerationOptions["profile"]>("fast");
  const [resolution, setResolution] = useState<GenerationOptions["resolution"]>("safe");
  const [duration, setDuration] = useState(5);
  const [aspect, setAspect] = useState<GenerationOptions["aspect"]>("16:9");
  const [soundEnabled, setSoundEnabled] = useState(true);
  // Per-step cooldown seconds; defaults to the last successful run once history loads.
  const [cooldownSeconds, setCooldownSeconds] = useState(MIN_COOLDOWN_SECONDS);
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
  const nextReferenceId = useRef(2);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [promptEngine, setPromptEngine] = useState<PromptEngine>("codex");
  const [promptBeforeOptimization, setPromptBeforeOptimization] = useState<string | null>(null);
  const [optimizedPromptMode, setOptimizedPromptMode] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [videos, setVideos] = useState<GeneratedVideo[]>([]);
  const [continuationSource, setContinuationSource] = useState<GeneratedVideo | null>(null);
  const promptHighlightRef = useRef<HTMLDivElement>(null);

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
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [isGenerating]);

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

  const sizeLabels = useMemo(() => {
    const label = (preset: GenerationOptions["resolution"]) => {
      if (continuationSource?.width && continuationSource?.height) return `${continuationSource.width} × ${continuationSource.height}`;
      if (sourceMode === "image" && !anchorImageDimensions) return "選圖後計算";
      const [width, height] = resolveOutputDimensions({
        resolution: preset,
        aspect,
        sourceWidth: sourceMode === "image" ? anchorImageDimensions?.width : undefined,
        sourceHeight: sourceMode === "image" ? anchorImageDimensions?.height : undefined,
      });
      return `${width} × ${height}`;
    };
    return { safe: label("safe"), clear: label("clear"), p480: label("p480"), p540: label("p540"), native: label("native") };
  }, [anchorImageDimensions, aspect, continuationSource, sourceMode]);

  const outputSize = sizeLabels[resolution];
  const videoWorks = useMemo(() => videos.filter((item) => item.kind !== "image"), [videos]);
  const imageWorks = useMemo(() => videos.filter((item) => item.kind === "image"), [videos]);
  // Steps that actually run per profile, for the cooldown-time estimate. Ref2VA and image are always 8.
  const cooldownSteps = profile === "cooled-turbo-4" ? 4 : sourceMode === "reference" ? 8 : profile === "quality" ? 20 : profile === "cooled-turbo-8" ? 8 : 6;
  const imageAspect = anchorImageDimensions ? formatAspect(anchorImageDimensions.width, anchorImageDimensions.height) : null;
  const extremeImageRatio = anchorImageDimensions
    ? Math.max(anchorImageDimensions.width / anchorImageDimensions.height, anchorImageDimensions.height / anchorImageDimensions.width) > 2.4
    : false;
  const validReferenceTags = useMemo(() => sourceMode === "reference"
    ? referenceImages
        .filter((reference) => reference.file && reference.label.trim())
        .map((reference) => reference.label.replace(/^@+/, "").trim())
    : [], [referenceImages, sourceMode]);

  async function chooseImage(event: ChangeEvent<HTMLInputElement>, position: "first" | "last") {
    const file = event.target.files?.[0] ?? null;
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

  async function chooseReferenceImage(event: ChangeEvent<HTMLInputElement>, id: number) {
    const file = event.target.files?.[0] ?? null;
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
    const original = croppableFile(target);
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
    if (!continuationSource && sourceMode === "image" && firstImageFile && !firstImageDimensions) {
      setError("尚未讀取到首幀圖片尺寸，請重新選擇圖片。 ");
      return;
    }
    if (!continuationSource && sourceMode === "image" && lastImageFile && !lastImageDimensions) {
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

    setError("");
    setNotice("");
    setElapsed(0);
    setStatusText("正在送入本機 H3 佇列…");
    setIsGenerating(true);
    try {
      const result = await createVideo(
        {
          prompt: sourceMode === "reference" && optimizedPromptMode !== "Ref2VA"
            ? buildReferencePrompt(
                continuationSource ? `Continue seamlessly from the supplied first-frame anchor. ${prompt.trim()}` : prompt,
                referenceDefinitions,
              )
            : prompt.trim(),
          profile, resolution, duration, aspect, sound: soundEnabled, sourceMode,
          cooldownSeconds: Math.max(MIN_COOLDOWN_SECONDS, cooldownSeconds),
          seed: seed.trim() ? Number(seed) : undefined,
          extraLoras: extraLoras.length ? extraLoras.map(({ name, strength }) => ({ name, strength })) : undefined,
          inputMode: sourceMode === "reference" ? "reference" : "standard",
          sourceWidth: !continuationSource && sourceMode === "image" ? anchorImageDimensions?.width : undefined,
          sourceHeight: !continuationSource && sourceMode === "image" ? anchorImageDimensions?.height : undefined,
          outputWidth: continuationSource?.width,
          outputHeight: continuationSource?.height,
          continuationSource: continuationSource ?? undefined,
        },
        !continuationSource && sourceMode === "image" ? firstImageFile : null,
        !continuationSource && sourceMode === "image" ? lastImageFile : null,
        (phase) => setStatusText(phase),
        references,
      );
      setVideos((current) => [result, ...current.filter((item) => item.filename !== result.filename)]);
      setStatusText(continuationSource ? "延伸影片已完成並無縫接到原片尾端。 " : "影片已完成並儲存到 ComfyUI output/video。 ");
      setContinuationSource(null);
      setView("works");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "生成失敗，請查看 ComfyUI 視窗。 ");
    } finally {
      setIsGenerating(false);
      void refreshHistory();
    }
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
    setIsGenerating(true);
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
      setIsGenerating(false);
      void refreshHistory();
    }
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
        !continuationSource && sourceMode === "image" ? firstImageFile : null,
        !continuationSource && sourceMode === "image" ? lastImageFile : null,
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

  function addExtraLora() {
    const unused = availableLoras.find((name) => !extraLoras.some((item) => item.name === name));
    if (!unused) return;
    setExtraLoras((current) => [...current, { id: nextLoraId.current++, name: unused, strength: 0.8 }]);
  }

  function updateExtraLora(id: number, patch: Partial<ExtraLora>) {
    setExtraLoras((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function removeExtraLora(id: number) {
    setExtraLoras((current) => current.filter((item) => item.id !== id));
  }

  function reuseSeed(value: number) {
    setSeed(String(value));
    setView("create");
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
    if (!video.prompt || !video.profile || !video.resolution || video.sound === undefined) {
      throw new Error("這支舊作品沒有保存完整生成設定，無法載入。 ");
    }

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

    let nextDuration = video.duration;
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
    setProfile(video.profile);
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
    setContinuationSource(video);
    setSourceMode(video.inputMode === "reference" ? "reference" : "text");
    setProfile(video.inputMode === "reference" ? "cooled-turbo-8" : "quality");
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

  function chooseProfile(nextProfile: GenerationOptions["profile"]) {
    setProfile(nextProfile);
    if (nextProfile === "safe-long") setResolution("p480");
  }

  function chooseSourceMode(nextMode: SourceMode) {
    setSourceMode(nextMode);
    setPromptBeforeOptimization(null);
    setOptimizedPromptMode(null);
    if (nextMode === "reference") {
      setProfile("cooled-turbo-8");
      setResolution("native");
      setAspect("16:9");
    } else if (resolution === "native") {
      setResolution("safe");
    }
  }

  const navItems: Array<{ id: View; icon: string; label: string }> = [
    { id: "create", icon: "✦", label: "創作" },
    { id: "works", icon: "▦", label: "作品" },
  ];

  const cropFile = cropTarget ? croppableFile(cropTarget) : null;
  const cropReferenceIndex = cropTarget?.kind === "reference"
    ? referenceImages.findIndex((reference) => reference.id === cropTarget.id) + 1
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
        {view === "create" ? (
          <>
            <div className="hero">
              <p className="eyebrow">MINIMAX H3 · LOCAL</p>
              <h1>讓靈感，躍然成片</h1>
              <p>文字、首尾幀或多圖參考，在你的 RTX 4080 Laptop 上生成有聲影片。</p>
            </div>

            <div className="mode-tabs" role="tablist" aria-label="生成來源">
              <button className={sourceMode === "text" ? "active" : ""} onClick={() => chooseSourceMode("text")} disabled={Boolean(continuationSource)}>文字轉影片</button>
              <button className={sourceMode === "image" ? "active" : ""} onClick={() => chooseSourceMode("image")} disabled={Boolean(continuationSource)}>首尾圖生影片</button>
              <button className={sourceMode === "reference" ? "active" : ""} onClick={() => chooseSourceMode("reference")} disabled={Boolean(continuationSource)}>參考生影片</button>
            </div>

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
              {!continuationSource && sourceMode === "image" && (
                <div className="keyframe-upload-section">
                  <p>首圖與尾圖至少選擇一張；只選尾圖也能生成。</p>
                  <div className="keyframe-upload-grid">
                    <label className="image-dropzone" htmlFor="first-frame-upload">
                      <input id="first-frame-upload" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void chooseImage(event, "first")} />
                      {firstImagePreview ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={firstImagePreview} alt="首幀預覽" />
                          <span>更換首幀圖片</span>
                          <CropActions
                            hasCrop={Boolean(firstImageCrop)}
                            onCrop={() => setCropTarget({ kind: "first" })}
                            onRestore={() => void restoreOriginalImage({ kind: "first" })}
                          />
                        </>
                      ) : (
                        <>
                          <span className="upload-icon">＋</span>
                          <strong>選擇首幀圖片</strong>
                          <small>選填 · 控制影片起始畫面</small>
                        </>
                      )}
                    </label>
                    <label className="image-dropzone" htmlFor="last-frame-upload">
                      <input id="last-frame-upload" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void chooseImage(event, "last")} />
                      {lastImagePreview ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={lastImagePreview} alt="尾幀預覽" />
                          <span>更換尾幀圖片</span>
                          <CropActions
                            hasCrop={Boolean(lastImageCrop)}
                            onCrop={() => setCropTarget({ kind: "last" })}
                            onRestore={() => void restoreOriginalImage({ kind: "last" })}
                          />
                        </>
                      ) : (
                        <>
                          <span className="upload-icon">＋</span>
                          <strong>選擇尾幀圖片</strong>
                          <small>選填 · 控制影片結尾畫面</small>
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
                        <label className="reference-image" htmlFor={`reference-image-${reference.id}`}>
                          <input
                            id={`reference-image-${reference.id}`}
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            onChange={(event) => void chooseReferenceImage(event, reference.id)}
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
                            <><span className="upload-icon">＋</span><strong>選擇參考圖 {index + 1}</strong></>
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
                        disabled={isGenerating || isOptimizing}
                      >
                        {engine === "grok" ? "Grok" : "Codex"}
                      </button>
                    ))}
                  </div>
                  <button
                    className="prompt-optimize-button"
                    onClick={optimizePrompt}
                    disabled={!connected || isGenerating || isOptimizing || Boolean(continuationSource)}
                  >
                    <span>✦</span>{isOptimizing ? `${engineLabel} 正在依官方 Skill 優化…` : "官方 H3 Prompt 優化"}
                  </button>
                  {promptBeforeOptimization !== null && (
                    <button className="prompt-restore-button" onClick={restorePrompt} disabled={isGenerating || isOptimizing}>還原原始描述</button>
                  )}
                </div>
                <small>
                  {continuationSource?.inputMode === "reference"
                    ? `會沿用原本的 ${continuationSource.referenceDefinitions?.map((reference) => `@${reference.label}`).join("、") ?? "參考標籤"}，並映射回同一組 Subject／Picture。`
                    : optimizedPromptMode
                    ? `已套用 MiniMax 官方 ${optimizedPromptMode} 格式；請確認內容後再生成。`
                    : sourceMode === "reference"
                      ? `${engineLabel} 會分析全部參考圖，將 @標籤整理為 Ref2VA 的 Subject／Picture 對應。`
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
                      <select value={item.name} onChange={(event) => updateExtraLora(item.id, { name: event.target.value })}>
                        {availableLoras.map((name) => (
                          <option
                            value={name}
                            key={name}
                            disabled={name !== item.name && extraLoras.some((other) => other.name === name)}
                          >{name.replace(/\.safetensors$/, "")}</option>
                        ))}
                      </select>
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
                  {extraLoras.length > 0 && (
                    <p className="lora-stack-note">
                      疊加時所有 LoRA 會改用 merge 模式，否則後面的會蓋掉前面的。畫面會比單一 LoRA 稍軟。
                    </p>
                  )}
                </div>
              )}

              <div className="composer-footer">
                <div className="controls">
                  <label>
                    <span>模式</span>
                    <select value={profile} onChange={(event) => chooseProfile(event.target.value as GenerationOptions["profile"])} disabled={Boolean(continuationSource)}>
                      {sourceMode === "reference" ? (
                        <>
                          <option value="cooled-turbo-8">COOLED TURBO 8 · Turbo 8 步／每步降溫</option>
                          <option value="cooled-turbo-4">COOLED TURBO 4 · Turbo 4 步／每步降溫</option>
                          <option value="low-vram">低顯存 · Turbo 8 步／LoRA merge</option>
                        </>
                      ) : (
                        <>
                          <option value="fast">FAST · Turbo 6 步</option>
                          <option value="cooled-fast">COOLED FAST · Turbo 6 步／分段降溫</option>
                          <option value="cooled-turbo-8">COOLED TURBO 8 · Turbo 8 步／每步降溫</option>
                          <option value="cooled-turbo-4">COOLED TURBO 4 · Turbo 4 步／每步降溫</option>
                          <option value="quality">QUALITY · 原生 20 步／每步降溫</option>
                          <option value="low-vram">低顯存 · Turbo 6 步／LoRA merge</option>
                          <option value="safe-long">安全長片 · 低解析生成／480P 輸出</option>
                        </>
                      )}
                    </select>
                  </label>
                  <label>
                    <span>解析度</span>
                    <select value={resolution} onChange={(event) => setResolution(event.target.value as GenerationOptions["resolution"])} disabled={Boolean(continuationSource) || profile === "safe-long"}>
                      {sourceMode === "reference" ? (
                        <>
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
                    ) : sourceMode === "reference" ? (
                      <select value="16:9" disabled><option value="16:9">16:9 橫向 · 固定</option></select>
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

                <div className="generate-actions">
                  {sourceMode !== "image" && (
                    <button className="generate-button image" onClick={generateImage} disabled={!connected || isGenerating || isOptimizing}>
                      <span>✦</span>{isGenerating ? "生成中" : "生成圖片"}
                    </button>
                  )}
                  <button className="generate-button" onClick={generate} disabled={!connected || isGenerating || isOptimizing}>
                    <span>✦</span>{isGenerating ? "生成中" : "生成影片"}
                  </button>
                </div>
              </div>

              <div className="setting-note">
                輸出 {outputSize} · 24 FPS · {soundEnabled ? "原生立體聲" : "無音軌（略省資源）"}
                {continuationSource && <span> · 延伸第 {(continuationSource.clipIndex ?? 1) + 1} 段（接續內容約 {duration} 秒）</span>}
                {sourceMode === "image" && firstImageDimensions && <span> · 首圖 {firstImageDimensions.width} × {firstImageDimensions.height}</span>}
                {sourceMode === "image" && lastImageDimensions && (
                  <span> · 尾圖 {lastImageDimensions.width} × {lastImageDimensions.height}{firstImageDimensions ? "（依首圖比例置中裁切）" : "（作為畫面比例基準）"}</span>
                )}
                {sourceMode === "reference" && <span> · Ref2VA W4A8 · {continuationSource?.inputMode === "reference" ? continuationSource.referenceFiles?.length ?? 0 : referenceImages.filter((reference) => reference.file).length} 張參考圖 · Turbo {profile === "cooled-turbo-4" ? 4 : 8} 步</span>}
                <span> · 每步降溫 {cooldownSeconds} 秒 ×{cooldownSteps} 步 ≈ {cooldownSeconds * cooldownSteps} 秒冷卻</span>
                {profile === "safe-long" && <span> · 安全長片會低解析生成，再以 CPU 放大為 480P；畫面較柔且不支援延伸</span>}
                {profile === "low-vram" && <span> · Turbo LoRA 改用 merge 模式，省下採樣時最大的一筆顯存配置；長片較不易爆顯存，畫面略柔</span>}
                {resolution !== "safe" && <span> · 較高解析度的顯存與時間需求較高</span>}
                {extremeImageRatio && <span> · 極端圖片比例可能降低生成品質</span>}
                {sourceMode !== "image" && <span> · 「生成圖片」忽略秒數與聲音，輸出 2K PNG（{aspect === "16:9" ? "2048×1152" : aspect === "9:16" ? "1152×2048" : "1440×1440"}）</span>}
              </div>
            </section>

            {!connected && (
              <div className="notice warning">請先執行 <code>start_h3_studio.bat</code>；介面偵測到 ComfyUI 後會自動連線。</div>
            )}
            {notice && <div className="notice success" aria-live="polite">{notice}</div>}
            {error && <div className="notice error">{error}</div>}
            {isGenerating && (
              <div className="generation-status" aria-live="polite">
                <div className="status-copy"><strong>{statusText}</strong><span>已經過 {elapsed} 秒，請勿關閉 ComfyUI。</span></div>
                <div className="progress-track"><span /></div>
              </div>
            )}

            <RecentSection videos={videoWorks.slice(0, 3)} onViewAll={() => setView("works")} onDelete={removeVideo} onExtend={extendVideo} onRedo={redoVideo} onReuseSeed={reuseSeed} emptyText="第一支影片，從一句話開始" />
          </>
        ) : (
          <section className="works-page">
            <div className="works-heading">
              <div>
                <p className="eyebrow">LOCAL CREATIONS</p><h1>我的作品</h1>
                <p>{worksTab === "image" ? "圖片儲存在本機 ComfyUI/output/H3_Image。" : "影片都儲存在本機 ComfyUI/output/video。"}</p>
              </div>
              <button className="secondary-button" onClick={refreshHistory}>↻ 重新整理</button>
            </div>
            <div className="works-tabs" role="tablist">
              <button role="tab" aria-selected={worksTab === "video"} className={worksTab === "video" ? "active" : ""} onClick={() => setWorksTab("video")}>影片（{videoWorks.length}）</button>
              <button role="tab" aria-selected={worksTab === "image"} className={worksTab === "image" ? "active" : ""} onClick={() => setWorksTab("image")}>圖片（{imageWorks.length}）</button>
            </div>
            {worksTab === "image"
              ? <ImageGrid videos={imageWorks} onDelete={removeVideo} onReuseSeed={reuseSeed} emptyText="目前還沒有本次工作階段的圖片" />
              : <VideoGrid videos={videoWorks} onDelete={removeVideo} onExtend={extendVideo} onRedo={redoVideo} onReuseSeed={reuseSeed} emptyText="目前還沒有本次工作階段的作品" />}
          </section>
        )}
      </section>

      {cropTarget && cropFile && (
        <ImageCropper
          file={cropFile}
          title={cropTarget.kind === "reference"
            ? `裁切參考圖 ${cropReferenceIndex}`
            : cropTarget.kind === "first" ? "裁切首幀圖片" : "裁切尾幀圖片"}
          hint={cropTarget.kind === "reference"
            ? "只留下要參考的部分，例如臉部。參考圖會被縮到與輸出畫面相同的像素量，所以裁得越準，臉的細節就越多。裁切比例不影響輸出畫面。"
            : `裁切框鎖定 ${aspect}，因為首尾圖的比例決定輸出影片的畫面比例。`}
          aspect={cropTarget.kind === "reference" ? undefined : CROP_ASPECT[aspect]}
          onCancel={() => setCropTarget(null)}
          onApply={(rect) => void applyCrop(rect)}
        />
      )}
    </main>
  );
}

function CropActions({ hasCrop, onCrop, onRestore }: { hasCrop: boolean; onCrop: () => void; onRestore: () => void }) {
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
      <button type="button" onClick={intercept(onCrop)}>{hasCrop ? "重新裁切" : "裁切"}</button>
      {hasCrop && <button type="button" onClick={intercept(onRestore)}>還原原圖</button>}
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
  const candidates: Array<[GenerationOptions["aspect"], number]> = [["16:9", 16 / 9], ["9:16", 9 / 16], ["1:1", 1]];
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
  emptyText: string;
};

function RecentSection({ videos, onViewAll, onDelete, onExtend, onRedo, onReuseSeed, emptyText }: VideoGridActions & { onViewAll: () => void }) {
  return (
    <section className="recent-section">
      <div className="section-heading"><div><p className="eyebrow">LOCAL CREATIONS</p><h2>最近作品</h2></div><button onClick={onViewAll}>查看全部 →</button></div>
      <VideoGrid videos={videos} onDelete={onDelete} onExtend={onExtend} onRedo={onRedo} onReuseSeed={onReuseSeed} emptyText={emptyText} />
    </section>
  );
}

function VideoGrid({ videos, onDelete, onExtend, onRedo, onReuseSeed, emptyText }: VideoGridActions) {
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
                {video.generationSeconds !== undefined && <small>耗時 {video.generationSeconds} 秒</small>}
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
  onReuseSeed: (seed: number) => void;
  emptyText: string;
};

function ImageGrid({ videos, onDelete, onReuseSeed, emptyText }: ImageGridActions) {
  const [deleting, setDeleting] = useState<string | null>(null);

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
          <article className="video-card" key={key}>
            {/* Local ComfyUI output served from localhost; next/image optimization is unnecessary. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <a href={src} target="_blank" rel="noreferrer"><img src={src} alt={image.prompt ?? image.filename} loading="lazy" /></a>
            <div>
              <div className="video-meta">
                <span title={image.filename}>{image.filename}</span>
                {image.generationSeconds !== undefined && <small>耗時 {image.generationSeconds} 秒</small>}
                {image.width && image.height ? <small>{image.width} × {image.height}</small> : null}
                {image.seed !== undefined && (
                  <small className="seed-line">
                    種子 <code>{image.seed}</code>
                    <button type="button" onClick={() => onReuseSeed(image.seed!)}>沿用</button>
                  </small>
                )}
              </div>
              <div className="card-actions">
                <a href={src} target="_blank" rel="noreferrer">開啟 ↗</a>
                <a className="img-action" href={src} download={image.filename}>下載</a>
                <button className="img-action delete" onClick={() => void confirmDelete(image)} disabled={deleting === key}>刪除</button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
