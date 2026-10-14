"use client";

import { useId, useRef, useState } from "react";
import { getLoraInfo } from "@/lib/lora-info";

export default function LoraPicker({ value, names, usedNames, onChange }: {
  value: string;
  names: string[];
  usedNames: string[];
  onChange: (name: string) => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const info = preview ? getLoraInfo(preview) : null;

  function openList() {
    setOpen(true);
    requestAnimationFrame(() => (list.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]') ?? list.current?.querySelector('button'))?.focus());
  }

  function close() {
    setOpen(false);
    trigger.current?.focus();
    setPreview(null);
  }

  return (
    <div className="lora-picker" onMouseLeave={() => setPreview(null)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setPreview(null); } }}>
      <button ref={trigger} className="lora-picker-trigger" type="button" aria-label={`選擇 LoRA：${value}`}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined}
        aria-describedby={info ? `${id}-help` : undefined}
        onMouseEnter={() => { if (!open) setPreview(value); }} onFocus={() => { if (!open) setPreview(value); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); close(); }
          else if (event.key === "ArrowDown") { event.preventDefault(); openList(); }
        }}
        onClick={() => { if (open) { setOpen(false); setPreview(value); } else openList(); }}>
        <span>{value.replace(/\.safetensors$/, "")}</span><span aria-hidden="true">▾</span>
      </button>
      {(open || info) && <div className={`lora-picker-panel${open ? " is-open" : ""}`}>
        {open && <div ref={list} id={`${id}-list`} role="listbox" tabIndex={-1} aria-label="可選 LoRA" className="lora-picker-list"
          onMouseLeave={() => setPreview(null)}
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); close(); return; }
            const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'));
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            let next = index;
            if (event.key === "ArrowDown") next = (index + 1) % buttons.length;
            else if (event.key === "ArrowUp") next = (index - 1 + buttons.length) % buttons.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = buttons.length - 1;
            else return;
            event.preventDefault(); buttons[next]?.focus();
          }}>
          {names.map((name) => {
            const used = name !== value && usedNames.includes(name);
            return <button key={name} type="button" role="option" tabIndex={name === value ? 0 : -1} aria-selected={name === value} aria-disabled={used}
              aria-describedby={preview === name ? `${id}-help` : undefined}
              onMouseEnter={() => setPreview(name)} onFocus={() => setPreview(name)}
              onClick={() => { if (!used) { onChange(name); setOpen(false); trigger.current?.focus(); setPreview(name); } }}>
              {name.replace(/\.safetensors$/, "")}{used && <small>已加入</small>}
            </button>;
          })}
        </div>}
        <div className="lora-help-slot">
          {info && <div id={`${id}-help`} role="tooltip" className="lora-help">
            <strong>{preview?.replace(/\.safetensors$/, "")}</strong>
            <p>{info.description}</p>
            <p><b>建議權重：</b>{info.weight}</p>
            {info.trigger && <p><b>觸發詞：</b><code>{info.trigger}</code></p>}
            {info.note && <p className="lora-help-note">{info.note}</p>}
          </div>}
        </div>
      </div>}
    </div>
  );
}
