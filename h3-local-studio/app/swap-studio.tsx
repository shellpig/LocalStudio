"use client";

/* eslint-disable jsx-a11y/media-has-caption -- Source and generated videos have no separate caption track. */

import { DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_COOLDOWN_SECONDS, GeneratedVideo, inputImageUrl, MIN_COOLDOWN_SECONDS, outputUrl } from "@/lib/comfy";
import { buildSwapPrompt, runSwap, SWAP_LABELS, SWAP_SEGMENT_SECONDS, SwapControl, SwapMode, SwapOptions, SwapResolution, swapDimensions } from "@/lib/swap";
import { cropImageFile, ImageCropper } from "./image-cropper";

const isVideoFile = (file: File) => ["video/mp4", "video/webm", "video/quicktime"].includes(file.type) || (!file.type && /\.(mp4|mov|webm)$/i.test(file.name));
const isImageFile = (file: File) => ["image/png", "image/jpeg", "image/webp"].includes(file.type) || (!file.type && /\.(png|jpe?g|webp)$/i.test(file.name));

export default function SwapStudio({ connected, disabled, enqueue, onComplete, initialWork }: {
  connected: boolean;
  disabled: boolean;
  enqueue: (label: string, run: (onStatus: (message: string) => void) => Promise<void>) => number;
  onComplete: () => void;
  initialWork: GeneratedVideo | null;
}) {
  const [video, setVideo] = useState<File | null>(null);
  const [reference, setReference] = useState<File | null>(null);
  const [originalReference, setOriginalReference] = useState<File | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0, duration: 0 });
  const [mode, setMode] = useState<SwapMode>("head");
  const [steps, setSteps] = useState<SwapOptions["steps"]>(20);
  const [resolution, setResolution] = useState<SwapResolution>("p480");
  const [strength, setStrength] = useState(1);
  const [seed, setSeed] = useState("");
  const [cooldown, setCooldown] = useState(DEFAULT_COOLDOWN_SECONDS);
  const [target, setTarget] = useState("");
  const [prompt, setPrompt] = useState(buildSwapPrompt("head"));
  const [busy, setBusy] = useState(false);
  const control = useRef<SwapControl | null>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const referenceInput = useRef<HTMLInputElement>(null);
  const [stopping, setStopping] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<GeneratedVideo | null>(null);
  const preview = useMemo(() => video ? URL.createObjectURL(video) : "", [video]);
  const referencePreview = useMemo(() => reference ? URL.createObjectURL(reference) : "", [reference]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => () => { if (referencePreview) URL.revokeObjectURL(referencePreview); }, [referencePreview]);
  useEffect(() => {
    if (!initialWork?.swapSourceFile || !initialWork.swapReferenceFile) return;
    let active = true;
    async function restore() {
      try {
        const files = await Promise.all([initialWork!.swapSourceFile!, initialWork!.swapReferenceFile!].map(async (path) => {
          const response = await fetch(inputImageUrl(path));
          if (!response.ok) throw new Error("換角來源或參考圖已不存在，請重新上傳。");
          return new File([await response.blob()], path.split("/").pop()!, { type: response.headers.get("content-type") ?? "" });
        }));
        if (!active) return;
        const work = initialWork!;
        setDimensions({ width: 0, height: 0, duration: 0 });
        setVideo(files[0]); setReference(files[1]); setOriginalReference(files[1]);
        setMode(work.swapMode!); setPrompt(work.prompt ?? buildSwapPrompt(work.swapMode!));
        setSteps((work.swapMode === "akatz-v1.5" ? 20 : work.swapMode === "untmods-face" && work.steps !== 20 ? 8 : [4, 6, 8, 20].includes(work.steps ?? 0) ? work.steps : 20) as SwapOptions["steps"]);
        setResolution((["p480", "p540", "native"].includes(work.resolution ?? "") ? work.resolution : "p480") as SwapResolution);
        setStrength(work.swapStrength ?? 1); setSeed(work.seed === undefined ? "" : String(work.seed)); setTarget(work.swapTarget ?? "");
        setCooldown(work.cooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS); setError(""); setResult(null);
        setStatus("已載入換角設定，確認後可重新生成。");
      } catch (caught) { if (active) setError(caught instanceof Error ? caught.message : "無法載入換角來源。"); }
    }
    void restore();
    return () => { active = false; };
  }, [initialWork]);

  const locked = busy || disabled;

  function chooseVideo(file: File | null) {
    setVideo(file); setDimensions({ width: 0, height: 0, duration: 0 }); setResult(null); setError("");
  }

  function chooseReference(file: File | null) {
    setReference(file); setOriginalReference(file); setError("");
  }

  function dropHandlers(accept: (file: File) => boolean, message: string, onFile: (file: File) => void) {
    return {
      onDragOver(event: DragEvent<HTMLDivElement>) {
        event.preventDefault();
        event.dataTransfer.dropEffect = locked ? "none" : "copy";
      },
      onDrop(event: DragEvent<HTMLDivElement>) {
        event.preventDefault();
        if (locked) return;
        const file = Array.from(event.dataTransfer.files).find(accept);
        if (file) onFile(file); else setError(message);
      },
    };
  }

  function submit() {
    if (!video || !reference || !dimensions.width || !dimensions.height || !Number.isFinite(dimensions.duration) || dimensions.duration <= 0) return;
    const options: SwapOptions = { mode, steps, resolution, prompt, strength, seed: seed.trim() ? Number(seed) : Math.floor(Math.random() * Number.MAX_SAFE_INTEGER), cooldownSeconds: cooldown, target };
    const source = video;
    const image = reference;
    const size = { ...dimensions };
    const currentControl = { stop: false };
    setStatus("已加入生成佇列。"); setError("");
    enqueue(`H3 換角 · ${SWAP_LABELS[mode]} · ${source.name}`, async (onStatus) => {
      setBusy(true); control.current = currentControl; setStopping(false); setError(""); setResult(null);
      try {
        const completed = await runSwap(source, image, size, options, currentControl, (message) => { setStatus(message); onStatus(message); });
        setResult(completed.result); setError(completed.warning); onComplete();
        setStatus(`已完成 ${completed.result.swapCompletedSegments}／${completed.result.swapTotalSegments} 段 · ${completed.result.duration?.toFixed(2)} 秒`);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "影片換角失敗。");
        throw caught;
      } finally { setBusy(false); control.current = null; setStopping(false); }
    });
  }

  const segmentCount = Math.ceil(Math.ceil(dimensions.duration * 24) / (SWAP_SEGMENT_SECONDS * 24));
  const label = (value: SwapResolution) => dimensions.width ? swapDimensions(value, dimensions.width, dimensions.height).join(" × ") : "";
  return <section className="composer enhancement-panel" aria-label="影片換角設定">
    <div className="enhancement-fields swap-fields">
      <h2>影片換角</h2>
      <p>來源影片提供動作、鏡頭與場景；參考圖提供新人物。15 秒以內整段一次生成；超過會分段（每段最長 15 秒），完成後合回原音軌。</p>
      <label><span>換角模式</span><select value={mode} disabled={locked} onChange={(event) => { const value = event.target.value as SwapMode; setMode(value); setPrompt(buildSwapPrompt(value, target)); if (value === "akatz-v1.5" || value === "untmods-face") { setSteps(value === "untmods-face" ? 8 : 20); setStrength(1); } }}><option value="head">BFS 換頭 · 臉部＋髮型，保留原身體與服裝</option><option value="character">BFS 整個角色替換 · 外貌、身形與服裝</option><option value="akatz-v1.5">Akatz V1.5 整個角色替換 · 外貌、身形與服裝</option><option value="untmods-face">UntMods FaceSwap · 臉部身份替換</option></select></label>
      {mode === "akatz-v1.5" && <p>Akatz V1.5 會替換整個角色，包含臉部、髮型與服裝。目前提供 20 步原生生成，建議強度 1.0，先以短片測試。</p>}
      {mode === "untmods-face" && <p>UntMods FaceSwap 以參考圖替換臉部身份，沿用來源影片的動作、身體與服裝。預設 8 步專用 Turbo、強度 1.0，也可選 20 步原生生成。</p>}
      <div className="swap-upload-grid">
        <div className="swap-upload">
          <span>來源影片（MP4／MOV／WebM，上限 1 GB）</span>
          <div className="image-dropzone" role="button" tabIndex={0} aria-disabled={locked} {...dropHandlers(isVideoFile, "請拖入 MP4、MOV 或 WebM 影片。", chooseVideo)} onClick={() => { if (!video) videoInput.current?.click(); }} onKeyDown={(event) => { if (event.key === "Enter" && !video) videoInput.current?.click(); }}>
            <input ref={videoInput} type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.mov,.webm" disabled={locked} onChange={(event) => { chooseVideo(event.target.files?.[0] ?? null); event.target.value = ""; }} />
            {video ? <>
              <video controls preload="metadata" src={preview} aria-label="換角來源影片" onLoadedMetadata={(event) => { const element = event.currentTarget; setDimensions({ width: element.videoWidth, height: element.videoHeight, duration: element.duration }); }} onError={() => setError("瀏覽器無法讀取影片，請選擇可播放的 MP4／MOV／WebM。")} />
              <span className="crop-actions swap-video-actions">
                <button type="button" disabled={locked} onClick={(event) => { event.stopPropagation(); videoInput.current?.click(); }}>更換影片</button>
                <button type="button" disabled={locked} onClick={(event) => { event.stopPropagation(); chooseVideo(null); }}>移除影片</button>
              </span>
            </> : <>
              <span className="upload-icon">＋</span>
              <strong>選擇來源影片</strong>
              <small>可點選或拖入影片 · 提供動作、鏡頭與場景</small>
            </>}
          </div>
        </div>
        <div className="swap-upload">
          <span>{mode === "head" ? "頭部參考圖（建議保留完整髮型）" : mode === "untmods-face" ? "臉部參考圖（清楚、完整的臉部）" : "角色參考圖（全身圖或設定稿）"}</span>
          <div className="image-dropzone" role="button" tabIndex={0} aria-disabled={locked} {...dropHandlers(isImageFile, "請拖入 JPG、PNG 或 WebP 圖片。", chooseReference)} onClick={() => referenceInput.current?.click()} onKeyDown={(event) => { if (event.key === "Enter") referenceInput.current?.click(); }}>
            <input ref={referenceInput} type="file" accept="image/png,image/jpeg,image/webp" disabled={locked} onChange={(event) => { chooseReference(event.target.files?.[0] ?? null); event.target.value = ""; }} />
            {reference ? <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={referencePreview} alt="換角角色參考圖" />
              <span className="crop-actions">
                <button type="button" disabled={locked} onClick={(event) => { event.stopPropagation(); setCropOpen(true); }}>{reference !== originalReference ? "重新裁切" : "裁切"}</button>
                {reference !== originalReference && <button type="button" disabled={locked} onClick={(event) => { event.stopPropagation(); setReference(originalReference); }}>還原原圖</button>}
                <button type="button" disabled={locked} onClick={(event) => { event.stopPropagation(); chooseReference(null); }}>移除圖片</button>
              </span>
            </> : <>
              <span className="upload-icon">＋</span>
              <strong>選擇{mode === "head" ? "頭部" : "角色"}參考圖</strong>
              <small>可點選或拖入圖片 · 可裁切</small>
            </>}
          </div>
        </div>
      </div>
      {dimensions.width > 0 && <p>來源 {dimensions.width} × {dimensions.height} · {dimensions.duration.toFixed(2)} 秒 · {segmentCount > 1 ? `分 ${segmentCount} 段` : "整段一次生成"}<br />畫面比例自動跟隨來源影片，輸出 24 fps。</p>}
      {segmentCount > 1 && <p className="error-message" role="alert">來源影片超過 {SWAP_SEGMENT_SECONDS} 秒，將分成 {segmentCount} 段各自生成，段落接縫處人物、光線可能不連續。建議先剪成 {SWAP_SEGMENT_SECONDS} 秒以內。</p>}
      <label><span>要替換的人物（單人片可留白）</span><input value={target} disabled={locked} placeholder="例如：畫面左側穿黑色外套的人" onChange={(event) => { const value = event.target.value; if (prompt === buildSwapPrompt(mode, target)) setPrompt(buildSwapPrompt(mode, value)); setTarget(value); }} /></label>
      <label><span>提示詞</span><textarea rows={12} value={prompt} disabled={locked} onChange={(event) => setPrompt(event.target.value)} /></label>
      <button type="button" className="prompt-restore-button" disabled={locked} onClick={() => setPrompt(buildSwapPrompt(mode, target))}>套用換角預設提示詞</button>
      <div className="swap-controls">
        <label><span>步數</span><select value={steps} disabled={locked} onChange={(event) => setSteps(Number(event.target.value) as SwapOptions["steps"])}>{mode !== "akatz-v1.5" && <>{mode !== "untmods-face" && <><option value={4}>4 步 · Turbo</option><option value={6}>6 步 · Turbo</option></>}<option value={8}>8 步 · Turbo</option></>}<option value={20}>20 步 · 原生</option></select></label>
        <label><span>解析度</span><select value={resolution} disabled={locked} onChange={(event) => setResolution(event.target.value as SwapResolution)}><option value="p480">{label("p480")} · 480P</option><option value="p540">{label("p540")} · 540P</option><option value="native">{label("native")} · 原生 H3</option></select></label>
        <label><span>LoRA 強度</span><input type="number" min={0} max={2} step={0.05} value={strength} disabled={locked} onChange={(event) => setStrength(Number(event.target.value))} /></label>
        <label><span>種子（留白隨機）</span><input type="number" min={0} max={Number.MAX_SAFE_INTEGER} step={1} value={seed} disabled={locked} onChange={(event) => setSeed(event.target.value)} /></label>
        <label><span>每步降溫（秒）</span><input type="number" min={MIN_COOLDOWN_SECONDS} max={600} step={1} value={cooldown} disabled={locked} onChange={(event) => setCooldown(Number(event.target.value))} /></label>
      </div>
      <button className="generate-button" disabled={!connected || locked || !video || !reference || !dimensions.width || !dimensions.height || !Number.isFinite(dimensions.duration) || dimensions.duration <= 0 || !prompt.trim()} onClick={submit}>加入生成佇列</button>
      {busy && <button type="button" disabled={stopping} onClick={() => { if (control.current) control.current.stop = true; setStopping(true); }}>{stopping ? "將保留已完成片段並停止" : "完成目前這段後停止"}</button>}
      <p role="status">{status}</p>
      {error && <p className="error-message" role="alert">{error}</p>}
      {result && <div><h3>{result.swapMode && SWAP_LABELS[result.swapMode]} · {result.duration?.toFixed(2)} 秒</h3><video controls src={outputUrl(result)} aria-label="影片換角成品" /><a href={outputUrl(result)} download={result.filename}>下載成品</a></div>}
    </div>
    {cropOpen && originalReference && <ImageCropper file={originalReference} title="裁切換角參考圖" hint={mode === "untmods-face" ? "FaceSwap 請保留清楚、完整的臉部。" : "換頭請保留臉部與完整髮型；角色替換可保留全身。"} onCancel={() => setCropOpen(false)} onApply={(rect) => { void cropImageFile(originalReference, rect).then((file) => { setReference(file); setCropOpen(false); }).catch((caught) => setError(String(caught))); }} />}
  </section>;
}
