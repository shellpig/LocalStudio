"use client";

/* eslint-disable @next/next/no-img-element -- Local ComfyUI images and in-memory face previews. */

import { useEffect, useRef, useState } from "react";
import { GeneratedVideo, inputImageUrl, outputUrl, uploadImage } from "@/lib/comfy";
import { cancelFace, DEFAULT_FACE_REFINE, FaceControl, FacePrepared, faceReferences, prepareFace, runFace } from "@/lib/face-refine";
import FaceSettings from "./face-settings";

export default function FaceRefineStudio({ source, queueBusy, disabled, enqueue, removeJob, onBusyChange, onComplete, onClose }: {
  source: GeneratedVideo; queueBusy: boolean; disabled: boolean;
  enqueue: (label: string, run: (onStatus: (status: string) => void) => Promise<void>, onDiscard?: () => void) => number;
  removeJob: (id: number) => void;
  onBusyChange: (busy: boolean) => void; onComplete: (video: GeneratedVideo) => void; onClose: () => void;
}) {
  const paths = faceReferences(source);
  const [settings, setSettings] = useState(() => ({ ...(source.faceRefine ?? DEFAULT_FACE_REFINE), referenceIndex: source.faceRefineReference ? paths.indexOf(source.faceRefineReference) : source.faceRefine?.referenceIndex ?? 0 }));
  const [reference, setReference] = useState<File | null>(null);
  const [prepared, setPrepared] = useState<FacePrepared | null>(null);
  const [picks, setPicks] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<GeneratedVideo | null>(null);
  const control = useRef<FaceControl>({ stop: false });
  const jobId = useRef<number | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  const selectedPath = prepared?.referenceFile ?? paths[settings.referenceIndex];
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => previous?.focus();
  }, []);

  async function scan() {
    setScanning(true); onBusyChange(true); setError(""); setStatus("正在逐鏡頭偵測人臉…");
    setPrepared(null); setResult(null);
    try {
      const referenceFile = settings.select === "all_faces" ? undefined : reference ? await uploadImage(reference) : paths[settings.referenceIndex] ?? source.faceRefineReference;
      const input = await prepareFace(source, settings, referenceFile, true);
      setPrepared(input);
      setPicks(input.preview!.shots.map((shot) => shot.faces === 1 ? 0 : -1));
      setStatus(input.targets ? `已偵測 ${input.targets.length} 個人物組，將依序修復。` : "請選擇每個鏡頭要修的人臉；沒有目標人物的鏡頭選略過。");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "偵測失敗。"); }
    finally { setScanning(false); onBusyChange(false); }
  }

  function refine() {
    if (!prepared) return;
    const input = structuredClone(prepared), choices = [...picks], options = { ...settings };
    const work: FaceControl = { stop: false }; control.current = work;
    setBusy(true); setError(""); setStatus("已加入人臉精修佇列。");
    jobId.current = enqueue(`人臉精修 · ${source.filename}`, async (onStatus) => {
      try {
        const video = await runFace(source, options, work, (text) => { setStatus(text); onStatus(text); }, input, options.select === "all_faces" ? undefined : choices);
        setResult(video); onComplete(video); setStatus("人臉精修完成，原片與新成品都已保留。");
      } catch (caught) { setError(caught instanceof Error ? caught.message : "人臉精修失敗。"); throw caught; }
      finally { setBusy(false); }
    }, () => { work.stop = true; setBusy(false); setStatus("已從佇列移除人臉精修。"); });
  }

  return <div className="crop-modal">
    {/* This dialog handles Escape and traps keyboard focus within its controls. */}
    {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
    <section className="crop-modal-panel face-panel" role="dialog" aria-modal="true" aria-labelledby="face-title" onKeyDown={(event) => {
      if (event.key === "Escape" && !busy && !scanning) onClose();
      if (event.key === "Tab") {
        const targets = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), video[controls]'));
        const first = targets[0], last = targets[targets.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <header><h3 id="face-title">人臉精修 · {source.filename}</h3><p>先選人物，再依精修模式局部重繪，沿用每步降溫。兩種模式都保留原片尺寸、24fps 與原音軌；原片另行保留。</p></header>
      <div className="face-panel-body">
        {/* Generated clips have no caption track. */}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video controls preload="metadata" src={outputUrl(source)} aria-label="修臉來源影片" />
        <FaceSettings value={settings} references={paths.map((_, index) => `原始圖片 ${index + 1}`)} disabled={busy || scanning} onChange={(value) => { setSettings(value); setPrepared(null); }} />
        {settings.select !== "all_faces" && <label>補充清晰人物參考圖（可選）<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || scanning} onChange={(event) => { setReference(event.target.files?.[0] ?? null); setPrepared(null); }} /></label>}
        {settings.select !== "all_faces" && selectedPath && !reference && <img className="face-reference" src={inputImageUrl(selectedPath)} alt="修臉身份參考" />}
        <button className="face-scan-button" type="button" aria-busy={scanning} disabled={disabled || queueBusy || busy || scanning} onClick={() => void scan()}>{scanning ? "正在偵測…" : "偵測人臉並預覽"}</button>
        {prepared?.targets?.map((target) => <div className="face-person" key={target.index}><img className="face-reference" src={inputImageUrl(target.referenceFile)} alt={`${target.label} 的原片人臉`} /><span>{target.label}</span></div>)}
        {!prepared?.targets && prepared?.preview?.shots.map((shot, index) => <div className="face-shot" key={index}>
          <p>鏡頭 {index + 1} · {(shot.segment[0] / 24).toFixed(2)}～{(shot.segment[1] / 24).toFixed(2)} 秒</p>
          {shot.jpg && <img src={`data:image/jpeg;base64,${shot.jpg}`} alt={`鏡頭 ${index + 1} 的人臉編號預覽`} />}
          <label>修復人物<select aria-label={`鏡頭 ${index + 1} 修復人物`} value={picks[index]} disabled={busy} onChange={(event) => setPicks((current) => current.map((p, i) => i === index ? Number(event.target.value) : p))}>
            <option value={-1}>略過此鏡頭</option>{Array.from({ length: shot.faces }, (_, face) => <option key={face} value={face}>人臉 {face}</option>)}
          </select></label>
        </div>)}
        <p role="status">{status}</p>{error && <p className="error-message" role="alert">{error}</p>}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        {result && <video controls src={outputUrl(result)} aria-label="人臉精修成品" />}
      </div>
      <div className="crop-modal-actions">
        <button ref={close} type="button" disabled={busy || scanning} onClick={onClose}>關閉</button>
        {busy && <button type="button" onClick={() => {
          if (jobId.current !== null) removeJob(jobId.current);
          void cancelFace(control.current).catch((caught) => setError(String(caught)));
        }}>停止精修</button>}
        <button type="button" className="primary" disabled={!prepared || !(prepared.targets?.length || picks.some((p) => p >= 0)) || busy || scanning || disabled} onClick={refine}>加入精修佇列</button>
      </div>
    </section>
  </div>;
}
