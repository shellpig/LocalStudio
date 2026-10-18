import type { GeneratedAudio } from "./tts";

const BASE = "http://127.0.0.1:8188/h3-studio/drama3";

export type Drama3Role = { id: string; name: string; voice: string };
export type Drama3Line = { roleId: string; text: string };
export type Drama3Settings = {
  roles: Drama3Role[];
  lines: Drama3Line[];
  seed?: number;
  temperature: number;
  topP: number;
  topK: number;
  maxFrames: number;
};
export type Drama3Job = {
  id: string;
  operation: "generate" | "transcribe" | "saveVoice" | "previewVoice";
  status: "running" | "cancelling" | "completed" | "cancelled" | "failed";
  message: string;
  result?: GeneratedAudio | { transcript: string } | { voice: string } | { voice: string; previewKey: string };
};
export type Drama3Status = { ready: boolean; standby?: boolean; voices: string[]; error?: string; activeJob: Drama3Job | null };

async function api(path: string, init?: RequestInit) {
  const response = await fetch(BASE + path, { ...init, signal: AbortSignal.timeout(90000) });
  if (!response.ok) {
    let message = `Drama3 請求失敗（HTTP ${response.status}）。`;
    try { message = (await response.json()).error || message; } catch { /* Keep the HTTP error. */ }
    if (response.status === 404) message = "請重新啟動 Studio 的 ComfyUI，載入 Drama3 整合。";
    throw new Error(message);
  }
  return response.json();
}

export async function drama3Status(): Promise<Drama3Status> { return api("/status"); }
export async function cancelDrama3(id: string): Promise<Drama3Job> { return api(`/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" }); }
export async function uploadDrama3Reference(file: File): Promise<string> {
  if (file.size > 32 * 1024 ** 2) throw new Error("參考音訊上限為 32 MB。");
  const form = new FormData();
  form.append("audio", file);
  return (await api("/upload", { method: "POST", body: form })).reference;
}
export async function submitDrama3(operation: Drama3Job["operation"], data: object): Promise<Drama3Job> {
  return api("/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...data, operation }) });
}
export async function waitDrama3(id: string, onStatus: (job: Drama3Job) => void): Promise<Drama3Job> {
  for (;;) {
    const job: Drama3Job = await api(`/jobs/${encodeURIComponent(id)}`);
    onStatus(job);
    if (job.status === "failed" || job.status === "cancelled") throw new Error(job.message);
    if (job.status === "completed") return job;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

export function drama3DownloadUrl(filename: string) {
  return `${BASE}/download?${new URLSearchParams({ filename })}`;
}

export async function openDrama3VoiceFolder(voice: string): Promise<{ folder: string }> {
  return api("/voices/open-folder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ voice }) });
}

export function drama3VoicePreviewUrl(key: string) {
  return `${BASE}/voices/preview/${encodeURIComponent(key)}`;
}
