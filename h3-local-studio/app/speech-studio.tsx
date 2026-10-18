"use client";

import { useState } from "react";
import type { GeneratedAudio } from "@/lib/tts";
import type { Drama3Settings } from "@/lib/drama3";
import Drama3Studio, { EnqueueSpeech } from "./drama3-studio";
import TtsStudio from "./tts-studio";

export default function SpeechStudio({ enqueue, onGenerated, initialSettings, disabled }: {
  enqueue: EnqueueSpeech;
  onGenerated: (audio: GeneratedAudio) => void;
  initialSettings?: Drama3Settings;
  disabled?: boolean;
}) {
  const [engine, setEngine] = useState<"drama3" | "gemini">("drama3");
  return <>
    <div className="mode-tabs speech-engine-tabs" role="group" aria-label="語音引擎">
      <button type="button" aria-pressed={engine === "drama3"} className={engine === "drama3" ? "active" : ""} onClick={() => setEngine("drama3")}>Drama3 · 本機多人配音</button>
      <button type="button" aria-pressed={engine === "gemini"} className={engine === "gemini" ? "active" : ""} onClick={() => setEngine("gemini")}>Gemini · 雲端語音</button>
    </div>
    <div hidden={engine !== "drama3"}><Drama3Studio enqueue={enqueue} onGenerated={onGenerated} initialSettings={initialSettings} disabled={disabled} /></div>
    <div hidden={engine !== "gemini"}><TtsStudio onGenerated={onGenerated} /></div>
  </>;
}
