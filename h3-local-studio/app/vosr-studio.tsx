"use client";

/* eslint-disable jsx-a11y/media-has-caption -- User videos have no separate caption track. */
import { useEffect, useState } from "react";
import { GeneratedVideo, outputUrl } from "@/lib/comfy";
import { prepareVOSR, runVOSR, VOSRInput, vosrPreview } from "@/lib/vosr";

export default function VOSRStudio({ videos, connected, disabled, enqueue, initialWork, redo, onComplete }: {
  videos: GeneratedVideo[]; connected: boolean; disabled: boolean;
  enqueue: (label: string, run: (onStatus: (message: string) => void) => Promise<void>) => number;
  initialWork?: GeneratedVideo | null; redo?: boolean; onComplete: () => void;
}) {
  const [restoreOriginal, setRestoreOriginal] = useState(Boolean(redo));
  const [source, setSource] = useState<File | GeneratedVideo | null>(initialWork ?? null);
  const [selected, setSelected] = useState(initialWork && !initialWork.vosrRefined ? `${initialWork.subfolder}/${initialWork.filename}` : "");
  const [prepared, setPrepared] = useState<VOSRInput | null>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<GeneratedVideo | null>(null);
  useEffect(() => {
    let active = true;
    if (source) void prepareVOSR(source, restoreOriginal).then(
      (input) => { if (active) setPrepared(input); },
      (caught) => { if (active) setError(caught instanceof Error ? caught.message : "無法準備來源影片。"); },
    );
    return () => { active = false; };
  }, [source, restoreOriginal]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function choose(value: File | GeneratedVideo | null) {
    setRestoreOriginal(false); setSource(value); setPrepared(null); setError(""); setStatus(""); setResult(null);
    setPreview(value instanceof File ? URL.createObjectURL(value) : "");
  }
  function refine() {
    if (!prepared) return;
    const input = { ...prepared };
    setError(""); setResult(null); setStatus("已加入生成佇列。");
    enqueue(`VOSR 1× 精修 · ${input.sourceName}`, async (onStatus) => {
      try {
        const completed = await runVOSR(input, (message) => { setStatus(message); onStatus(message); });
        setResult(completed); setStatus("VOSR 精修完成，已另存至作品。"); onComplete();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "VOSR 精修失敗。"); setStatus(""); throw caught;
      }
    });
  }
  const src = prepared ? vosrPreview(prepared) : preview || (source && !(source instanceof File) ? outputUrl(source) : "");
  return <section className="composer enhancement-panel" aria-label="VOSR精修設定">
    <div className="enhancement-fields">
      <h2>VOSR 1× 精修</h2>
      <p>改善畫面細節，維持原尺寸、幀率與幀數，保留原音軌並另存新作品。可能改變細小紋理；建議先比較短片效果。</p>
      <label><span>上傳影片（MP4／MOV／WebM，上限 1 GB）</span><input type="file" accept="video/mp4,video/webm,video/quicktime,.mov" disabled={disabled} onChange={(event) => { setSelected(""); choose(event.target.files?.[0] ?? null); }} /></label>
      <label><span>或從 Studio 作品選取</span><select value={selected} disabled={disabled} onChange={(event) => { setSelected(event.target.value); choose(videos.find((v) => `${v.subfolder}/${v.filename}` === event.target.value) ?? null); }}><option value="">選擇影片</option>{videos.map((v) => <option key={`${v.subfolder}/${v.filename}`} value={`${v.subfolder}/${v.filename}`}>{v.filename}</option>)}</select></label>
      {prepared && <p>來源：{prepared.sourceName} · {prepared.width} × {prepared.height} · {prepared.fps.toFixed(2)} fps</p>}
      {src && <video controls preload="metadata" src={src} aria-label="VOSR來源預覽" />}
      <p>固定 1× 精修，每幀沿用相同種子；工作依生成佇列順序執行。</p>
      <button className="generate-button" disabled={!connected || disabled || !prepared} onClick={refine}>加入 VOSR 精修佇列</button>
      <p role="status">{status}</p>
      {error && <p className="error-message" role="alert">{error}</p>}
      {result && <div><h3>VOSR 1× 精修成品</h3><video controls src={outputUrl(result)} aria-label="VOSR精修成品" /><a href={outputUrl(result)} download={result.filename}>下載成品</a></div>}
    </div>
  </section>;
}
