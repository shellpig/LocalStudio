"use client";

/* eslint-disable jsx-a11y/media-has-caption -- Generated videos have no separate caption track. */

import { useEffect, useState } from "react";
import { GeneratedVideo, outputUrl } from "@/lib/comfy";
import { RTX_MULTIPLIERS, RTXInput, RTXOperation, prepareRTX, runRTX } from "@/lib/rtx";

export default function RTXStudio({ videos, connected, disabled, queueBusy, enqueue, onComplete }: {
  videos: GeneratedVideo[];
  connected: boolean;
  disabled: boolean;
  queueBusy: boolean;
  enqueue: (label: string, run: (onStatus: (message: string) => void) => Promise<void>) => number;
  onComplete: () => void;
}) {
  const [source, setSource] = useState<File | GeneratedVideo | null>(null);
  const [selected, setSelected] = useState("");
  const [preview, setPreview] = useState("");
  const [operation, setOperation] = useState<RTXOperation>("fps");
  const [multiplier, setMultiplier] = useState(2);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<GeneratedVideo | null>(null);
  const [details, setDetails] = useState<RTXInput | null>(null);
  const [sourceError, setSourceError] = useState("");
  const file = source instanceof File ? source : null;
  const locked = disabled;

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    let active = true;
    if (source) void prepareRTX(source).then(
      (info) => { if (active) setDetails(info); },
      (caught) => { if (active) setSourceError(caught instanceof Error ? caught.message : "無法讀取來源影片資訊。"); },
    );
    return () => { active = false; };
  }, [source]);
  function reset() { setResult(null); setStatus(""); setError(""); }

  function enhance() {
    if (!source || !details) return;
    const input = { ...details };
    const chosenSource = source;
    const chosenOperation = operation;
    const chosenMultiplier = multiplier;
    const sourceName = source instanceof File ? source.name : source.filename;
    reset(); setStatus("已加入生成佇列。");
    enqueue(`RTX · ${operation === "fps" ? "補幀" : "超解析"} ${multiplier} 倍 · ${sourceName}`, async (onStatus) => {
      try {
        const completed = await runRTX(chosenSource, chosenOperation, chosenMultiplier, (message) => { setStatus(message); onStatus(message); }, input);
        setResult(completed); onComplete(); setStatus("RTX 提升完成，已另存至 Studio 作品。");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "RTX 提升失敗。"); setStatus("");
        throw caught;
      }
    });
  }

  return <section className="composer enhancement-panel" aria-label="RTX提升設定">
    <div className="enhancement-fields">
      <h2>RTX提升</h2>
      <p>提高 FPS 讓動作更流暢，或提高解析度改善畫質。保留影片時長與聲音，另存新作品。</p>
      <label><span>功能</span><select aria-label="功能" value={operation} disabled={locked} onChange={(event) => { reset(); setOperation(event.target.value as RTXOperation); setMultiplier(2); }}><option value="fps">提高 FPS（補幀）</option><option value="upscale">提高解析度（超解析）</option></select></label>
      <label><span>倍數</span><select aria-label="倍數" value={multiplier} disabled={locked} onChange={(event) => { reset(); setMultiplier(Number(event.target.value)); }}>{RTX_MULTIPLIERS[operation].map((value) => <option key={value} value={value}>{value} 倍</option>)}</select></label>
      <p>{operation === "fps" ? `例如 24 fps → ${24 * multiplier} fps；時長不變。需要 RTX 40 系列或更新顯示卡。` : `寬與高各放大 ${multiplier} 倍，採 ULTRA AI 超解析；幀率不變，輸出尺寸會對齊至 8 的倍數。`}</p>
      <label><span>上傳影片（MP4／MOV／WebM，上限 1 GB）</span><input key={selected} type="file" accept="video/mp4,video/webm,video/quicktime,.mov" disabled={locked} onChange={(event) => { reset(); setDetails(null); setSourceError(""); setSelected(""); const chosen = event.target.files?.[0] ?? null; setSource(chosen); setPreview(chosen ? URL.createObjectURL(chosen) : ""); }} /></label>
      <label><span>或從 Studio 作品選取</span><select aria-label="或從 Studio 作品選取" value={selected} disabled={locked} onChange={(event) => { reset(); setDetails(null); setSourceError(""); setSource(videos.find((video) => `${video.subfolder}/${video.filename}` === event.target.value) ?? null); setPreview(""); setSelected(event.target.value); }}><option value="">選擇影片</option>{videos.map((video) => <option key={`${video.subfolder}/${video.filename}`} value={`${video.subfolder}/${video.filename}`}>{video.filename}</option>)}</select></label>
      {source && <video key={file ? preview : selected} controls preload="metadata" src={file ? preview : outputUrl(source as GeneratedVideo)} aria-label="RTX來源影片預覽" />}
      {source && !details && !sourceError && <p role="status">正在上傳／讀取來源影片資訊…</p>}
      {details && <p aria-label="來源影片資訊">來源 {details.width} × {details.height} · {Number(details.fps.toFixed(3))} fps · {details.duration.toFixed(2)} 秒{operation === "upscale" ? ` → ${Math.max(8, Math.round(details.width * multiplier / 8) * 8)} × ${Math.max(8, Math.round(details.height * multiplier / 8) * 8)}` : ` → ${Number((details.fps * multiplier).toFixed(3))} fps`}</p>}
      <button className="generate-button" disabled={!connected || locked || !source || !details} onClick={enhance}>{queueBusy ? "加入佇列" : "開始 RTX 提升"}</button>
      <p role="status">{status}</p>
      {error && <p className="error-message" role="alert">{error}</p>}
      {sourceError && <p className="error-message" role="alert">{sourceError}</p>}
      {result && <div><h3>RTX {result.rtxOperation === "fps" ? "補幀" : "超解析"} · {result.rtxMultiplier} 倍</h3><p>{result.width} × {result.height} · {result.fps} fps · {result.duration?.toFixed(2)} 秒 · 處理耗時 {result.generationSeconds} 秒</p><video controls src={outputUrl(result)} aria-label="RTX提升成品" /><a href={outputUrl(result)} download={result.filename}>下載成品</a></div>}
    </div>
  </section>;
}
