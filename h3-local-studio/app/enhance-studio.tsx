"use client";

/* eslint-disable jsx-a11y/media-has-caption -- Generated videos have no separate caption track. */

import { useEffect, useState } from "react";
import { GeneratedVideo, outputUrl } from "@/lib/comfy";
import { blendEnhancement, EnhancementInput, prepareEnhancement, runEnhancement } from "@/lib/enhance";

export default function EnhanceStudio({ videos, connected, disabled, executionDisabled, onBusyChange, onComplete }: {
  videos: GeneratedVideo[];
  connected: boolean;
  disabled: boolean;
  executionDisabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onComplete: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [selected, setSelected] = useState("");
  const [preview, setPreview] = useState("");
  const [strength, setStrength] = useState(50);
  const [segment, setSegment] = useState(true);
  const [start, setStart] = useState(0);
  const [duration, setDuration] = useState(3);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [cache, setCache] = useState<{ input: EnhancementInput; raw: GeneratedVideo | null } | null>(null);
  const [result, setResult] = useState<GeneratedVideo | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const source = file ?? videos.find((video) => `${video.subfolder}/${video.filename}` === selected);

  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview); };
  }, [preview]);
  useEffect(() => {
    if (!busy) return;
    const began = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - began) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  function reset() { setCache(null); setResult(null); setError(""); setStatus(""); }

  async function enhance() {
    if (!source) return;
    const chosenStrength = strength;
    setBusy(true); onBusyChange(true); setError(""); setElapsed(0);
    try {
      let current = cache;
      if (!current) {
        setStatus("正在準備影片片段…");
        current = { input: await prepareEnhancement(source, segment ? start : 0, segment ? duration : 0), raw: null };
        setCache(current);
      }
      if (chosenStrength > 0 && !current.raw) {
        current = { ...current, raw: await runEnhancement(current.input, setStatus) };
        setCache(current);
      }
      setStatus("正在混合原片並另存成品…");
      const completed = await blendEnhancement(current.input, current.raw, chosenStrength);
      setResult(completed); onComplete();
      setStatus(`已完成 ${completed.width} × ${completed.height} · ${chosenStrength}% 強度`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "影片畫質提升失敗。");
      setStatus("");
    } finally { setBusy(false); onBusyChange(false); }
  }

  const locked = busy || disabled;
  return <section className="composer enhancement-panel" aria-label="影片畫質提升設定">
    <div className="enhancement-fields">
      <h2>影片畫質提升</h2>
      <p>升至 720p，保留原比例、幀率與聲音，另存新作品。每次最多 15 秒；建議先測試 3 秒。</p>
      <label><span>上傳影片（MP4／MOV／WebM，上限 1 GB）</span><input type="file" accept="video/mp4,video/webm,video/quicktime,.mov" disabled={locked} onChange={(event) => { reset(); setSelected(""); const chosen = event.target.files?.[0] ?? null; setFile(chosen); setPreview(chosen ? URL.createObjectURL(chosen) : ""); }} /></label>
      <label><span>或從 Studio 作品選取</span><select value={selected} disabled={locked} onChange={(event) => { reset(); setFile(null); setPreview(""); setSelected(event.target.value); }}><option value="">選擇影片</option>{videos.map((video) => <option key={`${video.subfolder}/${video.filename}`} value={`${video.subfolder}/${video.filename}`}>{video.filename}</option>)}</select></label>
      {source && <video controls preload="metadata" src={file ? preview : outputUrl(source as GeneratedVideo)} aria-label="來源影片預覽" />}
      <label className="enhancement-strength"><span>畫質提升強度：{strength}%</span><input type="range" min="0" max="100" step="5" value={strength} disabled={locked} onChange={(event) => setStrength(Number(event.target.value))} /><small>0% 使用原片普通放大；50% 各一半；100% 使用 LAB 校色後的 AI 成品。越高越可能改變細節。</small></label>
      <label className="enhancement-check"><input type="checkbox" checked={segment} disabled={locked} onChange={(event) => { reset(); setSegment(event.target.checked); }} />先處理指定片段</label>
      {segment && <div className="enhancement-times"><label><span>開始時間（秒）</span><input type="number" min="0" step="0.1" value={start} disabled={locked} onChange={(event) => { reset(); setStart(Number(event.target.value)); }} /></label><label><span>片段長度（秒）</span><input type="number" min="0.1" max="15" step="0.1" value={duration} disabled={locked} onChange={(event) => { reset(); setDuration(Number(event.target.value)); }} /></label></div>}
      {cache?.raw && <p>AI 成品已保留，調整強度後只需重新混合。</p>}
      {executionDisabled && <p>可先設定，等待生成佇列完成後即可開始提升畫質。</p>}
      <button className="generate-button" disabled={!connected || locked || executionDisabled || !source || (segment && (!Number.isFinite(start) || start < 0 || !Number.isFinite(duration) || duration <= 0 || duration > 15))} onClick={() => void enhance()}>{busy ? `正在處理 · ${elapsed} 秒` : cache?.raw ? "套用強度並另存" : "開始提升畫質"}</button>
      <p role="status">{status}</p>
      {error && <p className="error-message" role="alert">{error}</p>}
      {result && <div><h3>畫質提升 · 720p · {result.enhancementStrength}%</h3><video controls src={outputUrl(result)} aria-label="畫質提升成品" /><a href={outputUrl(result)} download={result.filename}>下載成品</a></div>}
    </div>
  </section>;
}
