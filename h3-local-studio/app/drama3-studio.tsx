"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { outputUrl } from "@/lib/comfy";
import {
  cancelDrama3, drama3DownloadUrl, drama3Status, Drama3Job, Drama3Line, Drama3Role,
  Drama3Settings, Drama3Status, submitDrama3, uploadDrama3Reference, waitDrama3,
  drama3VoicePreviewUrl, openDrama3VoiceFolder,
} from "@/lib/drama3";
import type { GeneratedAudio } from "@/lib/tts";

export type EnqueueSpeech = (label: string, run: (onStatus: (message: string) => void) => Promise<void>) => number;

type Props = { enqueue: EnqueueSpeech; onGenerated: (audio: GeneratedAudio) => void; initialSettings?: Drama3Settings; disabled?: boolean };
type LineDraft = Drama3Line & { id: string };
const defaults = { temperature: 1, topP: 0.9, topK: 30, maxFrames: 1290 };

export default function Drama3Studio({ enqueue, onGenerated, initialSettings, disabled }: Props) {
  const [roles, setRoles] = useState<Drama3Role[]>(initialSettings?.roles ?? [
    { id: "role-0", name: "角色一", voice: "" }, { id: "role-1", name: "角色二", voice: "" },
  ]);
  const [lines, setLines] = useState<LineDraft[]>((initialSettings?.lines ?? [
    { roleId: "role-0", text: "" }, { roleId: "role-1", text: "" },
  ]).map((line, index) => ({ ...line, id: `line-${index}` })));
  const [settings, setSettings] = useState({ ...defaults, ...initialSettings });
  const [seed, setSeed] = useState(initialSettings?.seed?.toString() ?? "");
  const [status, setStatus] = useState<Drama3Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<Drama3Job | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<GeneratedAudio | null>(null);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [reference, setReference] = useState("");
  const [transcript, setTranscript] = useState("");
  const [language, setLanguage] = useState("Chinese");
  const [voiceName, setVoiceName] = useState("");
  const [assignRole, setAssignRole] = useState(roles[0].id);
  const [voicePreviews, setVoicePreviews] = useState<Record<string, string>>({});
  const [playingRole, setPlayingRole] = useState<string | null>(null);
  const voicePlayers = useRef<Record<string, HTMLAudioElement | null>>({});

  const refreshStatus = useCallback(async () => {
    try { setStatus(await drama3Status()); }
    catch (caught) { setStatus({ ready: false, voices: [], activeJob: null, error: caught instanceof Error ? caught.message : "無法連線到 Drama3。" }); }
  }, []);
  useEffect(() => {
    let active = true;
    void drama3Status().then((value) => { if (active) setStatus(value); }).catch((caught) => {
      if (active) setStatus({ ready: false, voices: [], activeJob: null, error: caught instanceof Error ? caught.message : "無法連線到 Drama3。" });
    });
    return () => { active = false; };
  }, []);

  const locked = busy || Boolean(disabled);
  const remoteJob = job ?? status?.activeJob;

  function updateRole(id: string, field: "name" | "voice", value: string) {
    setRoles((current) => current.map((role) => role.id === id ? { ...role, [field]: value } : role));
  }
  function removeRole(id: string) {
    const remaining = roles.filter((role) => role.id !== id);
    if (!remaining.length) return;
    setRoles(remaining);
    setLines((current) => current.map((line) => line.roleId === id ? { ...line, roleId: remaining[0].id } : line));
    if (assignRole === id) setAssignRole(remaining[0].id);
  }
  function updateLine(id: string, patch: Partial<Drama3Line>) {
    setLines((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line));
  }
  function moveLine(index: number, offset: number) {
    setLines((current) => {
      const next = [...current];
      [next[index], next[index + offset]] = [next[index + offset], next[index]];
      return next;
    });
  }
  async function prepareReference() {
    if (reference) return reference;
    if (!referenceFile) throw new Error("請先選擇參考音訊。");
    const uploaded = await uploadDrama3Reference(referenceFile);
    setReference(uploaded);
    return uploaded;
  }

  async function observe(id: string, onStatus: (message: string) => void) {
    setBusy(true);
    try {
      const completed = await waitDrama3(id, (update) => {
        setJob(update); setMessage(update.message); onStatus(update.message);
      });
      if (completed.operation === "generate" && completed.result && "filename" in completed.result) {
        setResult(completed.result);
        onGenerated(completed.result);
      }
      return completed;
    } finally {
      setBusy(false); setJob(null); void refreshStatus();
    }
  }

  function start(operation: Drama3Job["operation"], label: string, data: () => Promise<object>, onComplete?: (completed: Drama3Job) => void) {
    setError(""); setMessage("已加入生成佇列；開始時會使用加入當下的設定。");
    enqueue(`Drama3 · ${label}`, async (onStatus) => {
      setBusy(true);
      try {
        onStatus("正在準備 Drama3 工作…");
        const submitted = await submitDrama3(operation, await data());
        setJob(submitted);
        const completed = await observe(submitted.id, onStatus);
        onComplete?.(completed);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Drama3 工作失敗。");
        throw caught;
      } finally { setBusy(false); }
    });
  }

  function generate() {
    if (roles.some((role) => !role.name.trim() || !role.voice) || lines.some((line) => !line.text.trim())) {
      setError("請替所有角色命名並選擇聲線，且填寫每段台詞。"); return;
    }
    const parsedSeed = seed.trim() ? Number(seed) : undefined;
    if (parsedSeed !== undefined && (!Number.isSafeInteger(parsedSeed) || parsedSeed < 0)) {
      setError("種子必須是非負的安全整數，或留白隨機。"); return;
    }
    const snapshot: Drama3Settings = {
      roles: roles.map((role) => ({ ...role })), lines: lines.map(({ roleId, text }) => ({ roleId, text })),
      temperature: settings.temperature, topP: settings.topP, topK: settings.topK, maxFrames: settings.maxFrames,
      ...(parsedSeed === undefined ? {} : { seed: parsedSeed }),
    };
    start("generate", `${roles.length} 人對話 · ${lines.length} 段`, async () => snapshot);
  }

  function previewVoice(role: Drama3Role) {
    setPlayingRole(role.id);
    if (voicePreviews[role.voice]) {
      void voicePlayers.current[role.id]?.play().catch((caught) => setError(String(caught)));
      return;
    }
    const voice = role.voice;
    start("previewVoice", `試聽聲線 · ${role.name}`, async () => ({ voice }), (completed) => {
      if (completed.result && "previewKey" in completed.result) {
        const key = completed.result.previewKey;
        setVoicePreviews((current) => ({ ...current, [voice]: key }));
      }
    });
  }

  async function openVoiceFolder(voice: string) {
    setError("");
    try {
      const result = await openDrama3VoiceFolder(voice);
      setMessage(`已開啟聲線所在資料夾：${result.folder}`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "無法開啟聲線資料夾。"); }
  }

  return <div className="tts-page drama3-page">
    <div className="hero"><p className="eyebrow">DRAMA3 · 本機多人配音</p><h1>讓每個角色開口</h1><p>設定角色聲線，逐段編排對話。可在台詞加入 [laughs]、[sighs]、[whispers] 等表演提示。</p></div>
    <section className="tts-key-status" aria-live="polite">
      <div><strong>{status?.ready ? status.standby ? "Drama3 已待命" : "Drama3 已連線" : status ? "Drama3 尚未就緒" : "正在檢查 Drama3…"}</strong><small>{status?.ready ? "使用時自動啟動，工作完成後關閉並釋放記憶體。" : status?.error}</small></div>
      <button type="button" onClick={() => void refreshStatus()}>重新檢查</button>
    </section>
    {status?.activeJob && !busy && <div className="notice warning">偵測到尚未完成的 Drama3 工作。
      <button type="button" onClick={() => enqueue("Drama3 · 追蹤目前工作", async (onStatus) => {
        try { await observe(status.activeJob!.id, onStatus); }
        catch (caught) { setError(caught instanceof Error ? caught.message : "追蹤失敗。"); throw caught; }
      })}>追蹤目前工作</button>
    </div>}

    <section className="tts-composer drama3-section" aria-label="角色聲線">
      <div className="drama3-heading"><h2>角色聲線</h2><button type="button" disabled={locked || roles.length >= 16} onClick={() => setRoles([...roles, { id: crypto.randomUUID(), name: `角色 ${roles.length + 1}`, voice: "" }])}>＋ 新增角色</button></div>
      <p>最多 16 人。同一角色的台詞會使用相同聲線；可選擇已保存聲線，或在下方建立新聲線。</p>
      <fieldset disabled={locked} className="drama3-role-grid">
        {roles.map((role, index) => <div className="drama3-role" key={role.id}>
          <label><span>角色 {index + 1} 名稱</span><input aria-label={`角色 ${index + 1} 名稱`} maxLength={50} value={role.name} onChange={(event) => updateRole(role.id, "name", event.target.value)} /></label>
          <label><span>聲線</span><select aria-label={`角色 ${index + 1} 聲線`} value={role.voice} onChange={(event) => updateRole(role.id, "voice", event.target.value)}>
            <option value="">選擇保存的聲線</option>
            {role.voice && !status?.voices.includes(role.voice) && <option value={role.voice}>{role.voice}（尚未載入）</option>}
            {status?.voices.map((voice) => <option value={voice} key={voice}>{voice.replace(/_\d+_\.safetensors$/, "").replace(/^studio_/, "")}</option>)}
          </select></label>
          <div className="drama3-inline">
            <button type="button" disabled={!role.voice || !status?.ready} onClick={() => previewVoice(role)} aria-label={`試聽${role.name}聲線`}>試聽</button>
            <button type="button" disabled={!role.voice || !status?.ready} onClick={() => void openVoiceFolder(role.voice)} aria-label={`開啟${role.name}聲線所在資料夾`}>開啟所在資料夾</button>
          </div>
          {voicePreviews[role.voice] && <div><small>參考聲音（從保存的聲線還原）</small>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio ref={(element) => { voicePlayers.current[role.id] = element; }} key={voicePreviews[role.voice]} controls autoPlay={playingRole === role.id} preload="metadata"
              src={drama3VoicePreviewUrl(voicePreviews[role.voice])} onPlay={(event) => {
                Object.values(voicePlayers.current).forEach((audio) => { if (audio && audio !== event.currentTarget) audio.pause(); });
              }} />
          </div>}
          <button type="button" disabled={roles.length === 1} onClick={() => removeRole(role.id)}>移除角色</button>
        </div>)}
      </fieldset>
    </section>

    <details className="tts-composer drama3-section">
      <summary>新增聲線 · 上傳參考音訊</summary>
      <fieldset disabled={locked} className="drama3-voice-form">
        <p>使用 1～30 秒、32 MB 內的單人清晰語音。先辨識，再校正逐字稿，最後保存聲線。</p>
        <label><span>參考音訊</span><input type="file" accept=".wav,.mp3,.flac,.m4a,.ogg,.webm" onChange={(event) => { setReferenceFile(event.target.files?.[0] ?? null); setReference(""); setTranscript(""); }} /></label>
        <div className="drama3-inline">
          <label><span>辨識語言</span><select aria-label="辨識語言" value={language} onChange={(event) => setLanguage(event.target.value)}>{[["Chinese", "中文"], ["English", "英文"], ["Japanese", "日文"], ["Cantonese", "粵語"], ["Korean", "韓文"]].map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
          <button type="button" disabled={!status?.ready || !referenceFile} onClick={() => {
            const selectedLanguage = language;
            start("transcribe", "辨識參考音訊", async () => ({ reference: await prepareReference(), language: selectedLanguage }), (completed) => {
              if (completed.result && "transcript" in completed.result) setTranscript(completed.result.transcript);
            });
          }}>辨識逐字稿</button>
        </div>
        <label><span>逐字稿（也可直接手動輸入，內容須與參考音訊完全相符）</span><textarea aria-label="參考逐字稿" value={transcript} maxLength={4000} onChange={(event) => setTranscript(event.target.value)} rows={4} /></label>
        <div className="drama3-inline">
          <label><span>聲線名稱</span><input value={voiceName} maxLength={50} onChange={(event) => setVoiceName(event.target.value)} /></label>
          <label><span>保存後指派給</span><select value={assignRole} onChange={(event) => setAssignRole(event.target.value)}>{roles.map((role) => <option value={role.id} key={role.id}>{role.name}</option>)}</select></label>
          <button type="button" disabled={!status?.ready || !referenceFile || !transcript.trim() || !voiceName.trim()} onClick={() => {
            const selectedRole = assignRole, name = voiceName, text = transcript;
            start("saveVoice", `保存聲線 · ${name}`, async () => ({ reference: await prepareReference(), name, transcript: text }), (completed) => {
              if (completed.result && "voice" in completed.result) {
                updateRole(selectedRole, "voice", completed.result.voice);
                setMessage("聲線已保存並指派給角色。"); void refreshStatus();
              }
            });
          }}>保存聲線並指派</button>
        </div>
      </fieldset>
    </details>

    <section className="tts-composer drama3-section" aria-label="對話劇本">
      <div className="drama3-heading"><h2>對話劇本</h2><button type="button" disabled={locked || lines.length >= 100} onClick={() => setLines([...lines, { id: crypto.randomUUID(), roleId: roles[0].id, text: "" }])}>＋ 新增台詞</button></div>
      <fieldset disabled={locked} className="drama3-lines">
        {lines.map((line, index) => <div className="drama3-line" key={line.id}>
          <button type="button" aria-label={`上移第 ${index + 1} 段`} disabled={index === 0} onClick={() => moveLine(index, -1)}>↑</button>
          <button type="button" aria-label={`下移第 ${index + 1} 段`} disabled={index === lines.length - 1} onClick={() => moveLine(index, 1)}>↓</button>
          <button type="button" aria-label={`移除第 ${index + 1} 段`} disabled={lines.length === 1} onClick={() => setLines(lines.filter((item) => item.id !== line.id))}>移除</button>
          <select aria-label={`第 ${index + 1} 段角色`} value={line.roleId} onChange={(event) => updateLine(line.id, { roleId: event.target.value })}>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select>
          <textarea aria-label={`第 ${index + 1} 段台詞`} rows={1} maxLength={2000} value={line.text} placeholder="輸入台詞，可加入 [sighs] 等表演提示。" onChange={(event) => updateLine(line.id, { text: event.target.value })} />
        </div>)}
      </fieldset>
      <p>{lines.reduce((total, line) => total + line.text.length, 0).toLocaleString()}／12,000 字元 · 最多 100 段</p>
      <details><summary>進階生成設定</summary><fieldset className="drama3-inline" disabled={locked}>
        <label><span>種子（留白隨機）</span><input value={seed} inputMode="numeric" onChange={(event) => setSeed(event.target.value)} /></label>
        <label><span>Temperature</span><input type="number" min="0.1" max="2" step="0.05" value={settings.temperature} onChange={(event) => setSettings({ ...settings, temperature: Number(event.target.value) })} /></label>
        <label><span>Top P</span><input type="number" min="0.05" max="1" step="0.05" value={settings.topP} onChange={(event) => setSettings({ ...settings, topP: Number(event.target.value) })} /></label>
        <label><span>Top K</span><input type="number" min="1" max="4096" value={settings.topK} onChange={(event) => setSettings({ ...settings, topK: Number(event.target.value) })} /></label>
        <label><span>每個文字區塊上限（秒）</span><input type="number" min="1" max="380" value={Math.round(settings.maxFrames / 21.5)} onChange={(event) => setSettings({ ...settings, maxFrames: Math.round(Number(event.target.value) * 21.5) })} /></label>
      </fieldset><p>長文會自動分塊生成；上限套用於每塊文字，並非整份劇本的總時長。</p></details>
      <div className="drama3-actions"><button className="generate-button" type="button" disabled={locked || !status?.ready || Boolean(status?.activeJob)} onClick={generate}>加入佇列 · 生成多人對話</button>
        {remoteJob && ["running", "cancelling"].includes(remoteJob.status) && <button type="button" disabled={remoteJob.status === "cancelling"} onClick={() => void cancelDrama3(remoteJob.id).then((update) => { setJob(update); setMessage(update.message); }).catch((caught) => setError(String(caught)))}>停止目前語音工作</button>}
      </div>
    </section>
    {message && <div className="notice" role="status">{message}</div>}
    {error && <div className="notice warning" role="alert">{error}</div>}
    {result && <section className="tts-composer drama3-section"><h2>對話成品</h2>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio controls preload="metadata" src={outputUrl(result)} />
      <p>種子 {result.seed} · {result.voice}</p><a className="img-action" href={drama3DownloadUrl(result.filename)}>下載 FLAC</a>
    </section>}
  </div>;
}
