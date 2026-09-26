"use client";

import { SyntheticEvent, useEffect, useRef, useState } from "react";
import { outputUrl } from "@/lib/comfy";
import {
  audioDownloadUrl,
  generateGeminiTts,
  GEMINI_TTS_VOICES,
  GeminiTtsModel,
  GeminiVoice,
  GeneratedAudio,
  getGeminiTtsKeyStatus,
  getGeminiTtsVoices,
  previewGeminiTtsVoice,
} from "@/lib/tts";

type KeyStatus = "checking" | "configured" | "missing" | "offline";
const MAX_TEXT_CHARS = 6000;

export default function TtsStudio({ onGenerated }: { onGenerated: (audio: GeneratedAudio) => void }) {
  const [keyStatus, setKeyStatus] = useState<KeyStatus>("checking");
  const [model, setModel] = useState<GeminiTtsModel>("gemini-3.8-flash-tts");
  const [voice, setVoice] = useState<string>("kore");
  const [extendedVoice, setExtendedVoice] = useState<GeminiVoice | null>(null);
  const [text, setText] = useState("");
  const [style, setStyle] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<GeneratedAudio | null>(null);
  const [voiceLibraryOpen, setVoiceLibraryOpen] = useState(false);
  const [voiceFilters, setVoiceFilters] = useState({ search: "", languageCode: "", gender: "" });
  const [voicePageTokens, setVoicePageTokens] = useState<(string | null)[]>([null]);
  const [voices, setVoices] = useState<GeminiVoice[]>([]);
  const [nextVoicePageToken, setNextVoicePageToken] = useState("");
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [voiceLibraryError, setVoiceLibraryError] = useState("");
  const [previewingVoiceId, setPreviewingVoiceId] = useState("");
  const [previewAudio, setPreviewAudio] = useState<{ url: string; voice: GeminiVoice } | null>(null);
  const [isPreviewingSelectedVoice, setIsPreviewingSelectedVoice] = useState(false);
  const [selectedVoicePreview, setSelectedVoicePreview] = useState<{ url: string; model: GeminiTtsModel; voice: string } | null>(null);
  const selectedVoicePreviewUrlRef = useRef<string | null>(null);
  const previewAudioUrlRef = useRef<string | null>(null);
  const previewRequestIdRef = useRef(0);
  const voiceListRequestIdRef = useRef(0);
  const voicePageNavigationLockRef = useRef(false);
  const currentVoicePageToken = voicePageTokens[voicePageTokens.length - 1] ?? null;

  useEffect(() => {
    let active = true;
    void getGeminiTtsKeyStatus()
      .then(({ configured }) => {
        if (active) setKeyStatus(configured ? "configured" : "missing");
      })
      .catch(() => {
        if (active) setKeyStatus("offline");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!voiceLibraryOpen || keyStatus !== "configured") return;
    let active = true;
    const requestId = ++voiceListRequestIdRef.current;
    const timer = window.setTimeout(() => {
      setIsLoadingVoices(true);
      setVoiceLibraryError("");
      void getGeminiTtsVoices({ ...voiceFilters, pageToken: currentVoicePageToken })
        .then((response) => {
          if (!active || requestId !== voiceListRequestIdRef.current) return;
          setVoices(response.voices);
          setNextVoicePageToken(response.nextPageToken);
        })
        .catch((caught) => {
          if (active && requestId === voiceListRequestIdRef.current) {
            setVoiceLibraryError(caught instanceof Error ? caught.message : "無法載入聲線清單。 ");
          }
        })
        .finally(() => {
          if (active && requestId === voiceListRequestIdRef.current) {
            voicePageNavigationLockRef.current = false;
            setIsLoadingVoices(false);
          }
        });
    }, 300);
    return () => {
      active = false;
      if (requestId === voiceListRequestIdRef.current) voiceListRequestIdRef.current += 1;
      window.clearTimeout(timer);
    };
  }, [currentVoicePageToken, keyStatus, voiceFilters, voiceLibraryOpen]);

  useEffect(() => () => {
    previewRequestIdRef.current += 1;
    if (previewAudioUrlRef.current) URL.revokeObjectURL(previewAudioUrlRef.current);
    if (selectedVoicePreviewUrlRef.current) URL.revokeObjectURL(selectedVoicePreviewUrlRef.current);
  }, []);

  async function refreshKeyStatus() {
    setKeyStatus("checking");
    try {
      const { configured } = await getGeminiTtsKeyStatus();
      setKeyStatus(configured ? "configured" : "missing");
    } catch {
      setKeyStatus("offline");
    }
  }

  async function generate() {
    setError("");
    setIsGenerating(true);
    try {
      const audio = await generateGeminiTts({ model, voice, text, style });
      setResult(audio);
      onGenerated(audio);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "語音生成失敗，請稍後再試。 ");
    } finally {
      setIsGenerating(false);
    }
  }

  async function previewSelectedVoice() {
    const previewModel = model;
    const previewVoice = voice;
    setError("");
    setIsPreviewingSelectedVoice(true);
    try {
      // Preset voices are listed as en-US in the voice library, so both previews share one cache entry.
      const audio = await previewGeminiTtsVoice({ model: previewModel, voice: previewVoice, languageCode: extendedVoice?.languageCode ?? "en-US" });
      const url = URL.createObjectURL(audio);
      if (selectedVoicePreviewUrlRef.current) URL.revokeObjectURL(selectedVoicePreviewUrlRef.current);
      selectedVoicePreviewUrlRef.current = url;
      setSelectedVoicePreview({ url, model: previewModel, voice: previewVoice });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "聲線試聽失敗，請稍後再試。 ");
    } finally {
      setIsPreviewingSelectedVoice(false);
    }
  }

  function updateVoiceFilter(field: keyof typeof voiceFilters, value: string) {
    voiceListRequestIdRef.current += 1;
    voicePageNavigationLockRef.current = false;
    setIsLoadingVoices(false);
    setVoiceFilters((current) => ({ ...current, [field]: value }));
    setVoicePageTokens([null]);
    setVoices([]);
    setNextVoicePageToken("");
  }

  function navigateVoicePage(tokens: (string | null)[]) {
    if (voicePageNavigationLockRef.current || isLoadingVoices) return;
    voiceListRequestIdRef.current += 1;
    voicePageNavigationLockRef.current = true;
    setIsLoadingVoices(true);
    setVoices([]);
    setNextVoicePageToken("");
    setVoicePageTokens(tokens);
  }

  function goToPreviousVoicePage() {
    if (voicePageTokens.length <= 1) return;
    navigateVoicePage(voicePageTokens.slice(0, -1));
  }

  function goToNextVoicePage() {
    if (!nextVoicePageToken) return;
    navigateVoicePage([...voicePageTokens, nextVoicePageToken]);
  }

  function closeVoiceLibrary() {
    setVoiceLibraryOpen(false);
    voiceListRequestIdRef.current += 1;
    voicePageNavigationLockRef.current = false;
    setIsLoadingVoices(false);
    previewRequestIdRef.current += 1;
    if (previewAudioUrlRef.current) URL.revokeObjectURL(previewAudioUrlRef.current);
    previewAudioUrlRef.current = null;
    setPreviewAudio(null);
    setPreviewingVoiceId("");
  }

  async function previewVoice(item: GeminiVoice) {
    const requestId = ++previewRequestIdRef.current;
    setPreviewingVoiceId(item.id);
    setVoiceLibraryError("");
    try {
      const audio = await previewGeminiTtsVoice({ model, voice: item.id, languageCode: item.languageCode });
      const url = URL.createObjectURL(audio);
      if (requestId !== previewRequestIdRef.current) {
        URL.revokeObjectURL(url);
        return;
      }
      if (previewAudioUrlRef.current) URL.revokeObjectURL(previewAudioUrlRef.current);
      previewAudioUrlRef.current = url;
      setPreviewAudio({ url, voice: item });
    } catch (caught) {
      if (requestId === previewRequestIdRef.current) {
        setVoiceLibraryError(caught instanceof Error ? caught.message : "聲線試聽失敗，請稍後再試。 ");
      }
    } finally {
      if (requestId === previewRequestIdRef.current) setPreviewingVoiceId("");
    }
  }

  function pauseOtherPreviewAudio(event: SyntheticEvent<HTMLAudioElement>) {
    const current = event.currentTarget;
    current.closest(".tts-voice-dialog")?.querySelectorAll("audio").forEach((audio) => {
      if (audio !== current) audio.pause();
    });
  }

  function selectExtendedVoice(item: GeminiVoice) {
    setVoice(item.id);
    setExtendedVoice(item);
    closeVoiceLibrary();
  }

  const canGenerate = keyStatus === "configured" && text.trim().length > 0 && !isGenerating;
  const keyStatusLabel = {
    checking: "正在確認 API 金鑰…",
    configured: "API 金鑰已設定",
    missing: "尚未設定 API 金鑰",
    offline: "無法連線到本機服務",
  }[keyStatus];

  return (
    <div className="tts-page">
      <div className="hero">
        <p className="eyebrow">GEMINI 3.8 · TEXT TO SPEECH</p>
        <h1>語音生成</h1>
        <p>選擇模型與聲線，將文字生成為可試聽、下載的 WAV 音訊。</p>
      </div>

      <section className="tts-key-status" aria-live="polite">
        <div>
          <span className={`status-dot ${keyStatus === "configured" ? "tts-key-ready" : ""}`} />
          <strong>{keyStatusLabel}</strong>
          <small>GEMINI_TTS_API_KEY</small>
        </div>
        <button type="button" onClick={() => void refreshKeyStatus()} disabled={keyStatus === "checking"}>
          {keyStatus === "checking" ? "確認中…" : "重新檢查"}
        </button>
      </section>

      {keyStatus === "missing" && (
        <div className="notice warning">
          請先將 <code>GEMINI_TTS_API_KEY</code> 設定為 Windows 使用者環境變數，再重新啟動 ComfyUI。
        </div>
      )}
      {keyStatus === "offline" && (
        <div className="notice warning">無法連線到 ComfyUI。請先執行 <code>start_h3_studio.bat</code>。</div>
      )}

      <section className="tts-composer" aria-label="語音生成設定">
        <div className="tts-fields">
          <label>
            <span>模型</span>
            <select value={model} onChange={(event) => setModel(event.target.value as GeminiTtsModel)}>
              <option value="gemini-3.8-flash-tts">Gemini 3.8 Flash TTS · 細膩表演</option>
              <option value="gemini-3.8-flash-lite-tts">Gemini 3.8 Flash-Lite TTS · 快速生成</option>
            </select>
          </label>
          <label>
            <span>預設聲線</span>
            <div className="tts-voice-picker">
              <select value={voice} onChange={(event) => {
                setVoice(event.target.value);
                setExtendedVoice(null);
              }}>
                {extendedVoice && !GEMINI_TTS_VOICES.some((item) => item.id === extendedVoice.id) && (
                  <option value={extendedVoice.id}>{extendedVoice.displayName} · {extendedVoice.id}</option>
                )}
                {GEMINI_TTS_VOICES.map((item) => (
                  <option value={item.id} key={item.id}>{item.id.charAt(0).toUpperCase() + item.id.slice(1)} · {item.style}</option>
                ))}
              </select>
              <button
                type="button"
                className="tts-voice-library-button"
                onClick={() => void previewSelectedVoice()}
                disabled={keyStatus !== "configured" || isPreviewingSelectedVoice}
                title={keyStatus === "configured" ? "用目前的模型試聽這個聲線" : "請先設定 Gemini API key"}
              >
                {isPreviewingSelectedVoice ? "生成中…" : "試聽"}
              </button>
              <button
                type="button"
                className="tts-voice-library-button"
                onClick={() => setVoiceLibraryOpen(true)}
                disabled={keyStatus !== "configured"}
                title={keyStatus === "configured" ? "搜尋及試聽 Google 聲線庫" : "請先設定 Gemini API key"}
              >
                聲線庫
              </button>
            </div>
            {extendedVoice && <small className="tts-selected-voice-meta">{extendedVoice.languageCode || "語言未標示"} · {extendedVoice.gender || "性別未標示"}</small>}
            {selectedVoicePreview?.voice === voice && selectedVoicePreview.model === model && (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <audio className="tts-selected-voice-preview" controls autoPlay preload="metadata" src={selectedVoicePreview.url} />
            )}
          </label>
        </div>

        <label className="tts-text-field">
          <span>朗讀文字</span>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={MAX_TEXT_CHARS}
            placeholder="輸入要轉成語音的文字…"
            rows={9}
          />
          <small>{text.length.toLocaleString()} / {MAX_TEXT_CHARS.toLocaleString()} 字元</small>
        </label>

        <label className="tts-style-field">
          <span>語氣與表達方式（選填）</span>
          <input
            value={style}
            onChange={(event) => setStyle(event.target.value)}
            maxLength={500}
            placeholder="例如：自然親切，語速稍慢"
          />
        </label>

        <div className="tts-footer">
          <p>每次最多 {MAX_TEXT_CHARS.toLocaleString("en-US")} 字元；模型單次輸入上限為 8,192 tokens，較長內容請自行分段。生成後會儲存在作品的「聲音」分類。</p>
          <button type="button" className="generate-button tts-generate-button" onClick={() => void generate()} disabled={!canGenerate}>
            <span>◖</span>{isGenerating ? "正在生成語音…" : "生成語音"}
          </button>
        </div>
      </section>

      {error && <div className="notice error" role="alert">{error}</div>}
      {isGenerating && (
        <div className="generation-status" aria-live="polite">
          <div className="status-copy"><strong>Gemini 正在生成語音</strong><span>文字較長時需要多等一會兒。</span></div>
          <div className="progress-track"><span /></div>
        </div>
      )}
      {result && (
        <section className="tts-result" aria-label="生成的語音">
          <div className="tts-result-heading">
            <div><p className="eyebrow">GENERATED AUDIO</p><h2>語音已生成</h2></div>
            <a href={audioDownloadUrl(result.filename)}>下載 WAV ↓</a>
          </div>
          <p>{result.voice} · {result.model === "gemini-3.8-flash-tts" ? "Gemini 3.8 Flash TTS" : "Gemini 3.8 Flash-Lite TTS"}</p>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls preload="metadata" src={outputUrl(result)} />
        </section>
      )}

      {voiceLibraryOpen && (
        <div className="tts-voice-modal">
          <section className="tts-voice-dialog" role="dialog" aria-modal="true" aria-labelledby="tts-voice-library-title">
            <header>
              <div>
                <p className="eyebrow">GEMINI VOICE LIBRARY</p>
                <h2 id="tts-voice-library-title">搜尋更多聲線</h2>
              </div>
              <button type="button" onClick={closeVoiceLibrary} aria-label="關閉聲線庫">×</button>
            </header>

            <div className="tts-voice-filters">
              <label className="tts-voice-search">
                <span>關鍵字</span>
                <input
                  value={voiceFilters.search}
                  onChange={(event) => updateVoiceFilter("search", event.target.value)}
                  placeholder="搜尋名稱或聲線描述"
                  maxLength={200}
                />
              </label>
              <label>
                <span>語言代碼</span>
                <input
                  value={voiceFilters.languageCode}
                  onChange={(event) => updateVoiceFilter("languageCode", event.target.value)}
                  placeholder="例如 en-US、zh-TW"
                  maxLength={40}
                />
              </label>
              <label>
                <span>性別</span>
                <select value={voiceFilters.gender} onChange={(event) => updateVoiceFilter("gender", event.target.value)}>
                  <option value="">全部</option>
                  <option value="female">女性</option>
                  <option value="male">男性</option>
                  <option value="neutral">中性</option>
                </select>
              </label>
            </div>

            <p className="tts-voice-cache-note">點「試聽」才會生成短句預覽。相同模型、聲線與語言會使用本機快取，預覽不會加入作品。</p>

            {voiceLibraryError && <div className="notice error" role="alert">{voiceLibraryError}</div>}
            {previewAudio && (
              <div className="tts-voice-preview">
                <div><strong>試聽：{previewAudio.voice.displayName}</strong><span>{previewAudio.voice.languageCode || "英文固定短句"}</span></div>
                <div className="tts-voice-preview-player">
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <audio controls preload="metadata" src={previewAudio.url} onPlay={pauseOtherPreviewAudio} />
                  <button type="button" className="select-voice" onClick={() => selectExtendedVoice(previewAudio.voice)}>選用</button>
                </div>
              </div>
            )}

            {isLoadingVoices ? (
              <div className="tts-voice-loading" aria-live="polite">正在搜尋聲線…</div>
            ) : voices.length === 0 ? (
              <div className="tts-voice-loading">沒有符合條件的聲線。</div>
            ) : (
              <div className="tts-voice-list" aria-live="polite">
                {voices.map((item) => {
                  const isGeneratingPreview = previewingVoiceId === item.id;
                  const cardPreviewUrl = !isGeneratingPreview && previewAudio?.voice.id === item.id ? previewAudio.url : "";
                  return (
                    <article className="tts-voice-card" key={item.id}>
                      <div className="tts-voice-card-copy">
                        <div className="tts-voice-name"><strong>{item.displayName}</strong><code>{item.id}</code></div>
                        <small>{[item.languageCode, item.gender, item.accent].filter(Boolean).join(" · ") || "未提供語音資訊"}</small>
                        {isGeneratingPreview ? (
                          <p className="tts-voice-card-status" aria-live="polite">正在生成試聽…</p>
                        ) : cardPreviewUrl ? (
                          // eslint-disable-next-line jsx-a11y/media-has-caption
                          <audio controls autoPlay preload="metadata" src={cardPreviewUrl} onPlay={pauseOtherPreviewAudio} />
                        ) : (
                          item.description && <p>{item.description}</p>
                        )}
                      </div>
                      <div className="tts-voice-card-actions">
                        {!isGeneratingPreview && !cardPreviewUrl && (
                          <button type="button" onClick={() => void previewVoice(item)} disabled={Boolean(previewingVoiceId)}>試聽</button>
                        )}
                        <button type="button" className="select-voice" onClick={() => selectExtendedVoice(item)}>選用</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            <footer className="tts-voice-pagination">
              <span>第 {voicePageTokens.length} 頁 · {voices.length} 個聲線</span>
              <div>
                <button type="button" onClick={goToPreviousVoicePage} disabled={voicePageTokens.length <= 1 || isLoadingVoices}>
                  上一頁
                </button>
                <button type="button" onClick={goToNextVoicePage} disabled={!nextVoicePageToken || isLoadingVoices}>
                  下一頁
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
