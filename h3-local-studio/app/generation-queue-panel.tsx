"use client";

import { KeyboardEvent, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GenerationJob } from "@/lib/generation-queue";

export default function GenerationQueuePanel({ jobs, elapsed, onRemove }: {
  jobs: GenerationJob[];
  elapsed: number;
  onRemove: (id: number) => void;
}) {
  const [popup, setPopup] = useState<{ id: number; left: number; top: number; maxHeight: number } | null>(null);
  const [open, setOpen] = useState(true);
  const toggle = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    setPopup(null);
    toggle.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape") {
      if (open) close();
      else setPopup(null);
    }
  }

  function show(job: GenerationJob, element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    const width = Math.min(420, window.innerWidth - 24);
    const maxHeight = Math.min(420, window.innerHeight - 112);
    setPopup({
      id: job.id,
      left: rect.left >= width + 24 ? rect.left - width : Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top: Math.max(80, Math.min(rect.top, window.innerHeight - maxHeight - 12)),
      maxHeight,
    });
  }

  return (
    <>
    <button ref={toggle} type="button" className="queue-toggle" aria-expanded={open} aria-controls="generation-queue-panel"
      onKeyDown={onKeyDown} onClick={() => { if (open) close(); else setOpen(true); }}>佇列 · {jobs.length}</button>
    <section id="generation-queue-panel" className={`generation-queue${open ? " is-open" : ""}`} aria-label="生成佇列">
      <div className="queue-heading"><h2>生成佇列</h2><span>等待 {jobs.filter((job) => job.status === "waiting").length} 筆</span>
        <button type="button" className="queue-collapse" onClick={close} onKeyDown={onKeyDown}>收合</button>
      </div>
      <p className="queue-note">重新整理或關閉網頁會清除等待任務。</p>
      <ol onScroll={() => setPopup(null)}>
        {jobs.map((job) => {
          const qwen = job.label.startsWith("Qwen 圖片 · ");
          const drama3 = job.label.startsWith("Drama3 · ");
          const type = drama3 ? "Drama3 語音" : job.label.startsWith("人臉精修 · ") ? "人臉精修" : job.label.startsWith("RTX · ") ? "RTX 提升" : qwen ? "Qwen 圖片" : "H3 影片";
          const text = job.label.startsWith("延伸影片 · ")
            ? job.label.replace("延伸影片 · ", "延伸：")
            : job.label.slice(job.label.indexOf(" · ") + 3);
          const characters = Array.from(text);
          const summary = characters.slice(0, 10).join("") + (characters.length > 10 ? "…" : "");
          const status = job.status === "running" ? `執行中 · ${elapsed} 秒` : job.status === "failed" ? "失敗" : "等待中";
          return (
            <li key={job.id} onMouseEnter={(event) => show(job, event.currentTarget)} onMouseLeave={() => setPopup(null)}
              onFocus={(event) => show(job, event.currentTarget)}
              onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPopup(null); }}>
              <div className="queue-job-heading">
                <span className={`queue-type ${qwen ? "qwen" : drama3 ? "drama3" : "h3"}`}>{type}</span>
                <span className={`queue-state ${job.status}`}>{status}</span>
              </div>
              <div className="queue-job-actions">
                <button type="button" className="queue-summary" aria-label={`${type}：${text}`}
                  aria-describedby={popup?.id === job.id ? `queue-tooltip-${job.id}` : undefined}
                  onKeyDown={onKeyDown}
                  onClick={(event) => show(job, event.currentTarget)}>{summary}</button>
                {job.status !== "running" && <button className="queue-remove" type="button" onKeyDown={onKeyDown} onClick={() => onRemove(job.id)}>{job.status === "failed" ? "清除" : "移除"}</button>}
              </div>
              {job.status === "running" && job.message.startsWith("人臉精修") && <p className="queue-stage" role="status">{job.message}</p>}
              {popup?.id === job.id && createPortal(
                <div className={`queue-tooltip${open ? " queue-tooltip-open" : ""}`} role="tooltip" id={`queue-tooltip-${job.id}`}
                  style={{ left: popup.left, top: popup.top, maxHeight: popup.maxHeight }}>
                  <strong>{type} · {status}</strong>
                  <p className="queue-full-prompt">{text}</p>
                  <p className="queue-message" role={job.status === "failed" ? "alert" : "status"}>{job.message}</p>
                </div>, document.body,
              )}
              {job.status === "failed" && <span className="queue-failure" role="alert">生成失敗，移上查看原因。</span>}
            </li>
          );
        })}
      </ol>
    </section>
    </>
  );
}
