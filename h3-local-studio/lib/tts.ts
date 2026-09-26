const COMFY_URL = "http://127.0.0.1:8188";

export type GeminiTtsModel = "gemini-3.8-flash-tts" | "gemini-3.8-flash-lite-tts";

export type GeminiVoice = {
  id: string;
  displayName: string;
  description: string;
  gender: string;
  languageCode: string;
  accent: string;
  persona: string;
  pitch: string;
  context: string;
  regionCode: string;
};

export type GeneratedAudio = {
  filename: string;
  subfolder: string;
  type: string;
  kind: "audio";
  model: GeminiTtsModel;
  voice: string;
  modifiedAt: number;
};

export function audioDownloadUrl(filename: string) {
  return `${COMFY_URL}/h3-studio/tts/download?${new URLSearchParams({ filename })}`;
}

export const GEMINI_TTS_VOICES = [
  { id: "Zephyr", style: "明亮" },
  { id: "Puck", style: "活潑" },
  { id: "Charon", style: "資訊感" },
  { id: "Kore", style: "堅定" },
  { id: "Fenrir", style: "熱情" },
  { id: "Leda", style: "年輕" },
  { id: "Orus", style: "堅定" },
  { id: "Aoede", style: "輕快" },
  { id: "Callirrhoe", style: "隨和" },
  { id: "Autonoe", style: "明亮" },
  { id: "Enceladus", style: "氣音" },
  { id: "Iapetus", style: "清晰" },
  { id: "Umbriel", style: "隨和" },
  { id: "Algieba", style: "圓潤" },
  { id: "Despina", style: "圓潤" },
  { id: "Erinome", style: "清晰" },
  { id: "Algenib", style: "沙啞" },
  { id: "Rasalgethi", style: "資訊感" },
  { id: "Laomedeia", style: "活潑" },
  { id: "Achernar", style: "柔和" },
  { id: "Alnilam", style: "堅定" },
  { id: "Schedar", style: "平穩" },
  { id: "Gacrux", style: "成熟" },
  { id: "Pulcherrima", style: "直接" },
  { id: "Achird", style: "友善" },
  { id: "Zubenelgenubi", style: "隨性" },
  { id: "Vindemiatrix", style: "溫柔" },
  { id: "Sadachbia", style: "生動" },
  { id: "Sadaltager", style: "博學" },
  { id: "Sulafat", style: "溫暖" },
] as const;

export async function getGeminiTtsKeyStatus() {
  const response = await fetch(`${COMFY_URL}/h3-studio/tts/status`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("無法確認 Gemini TTS 設定，請確認 ComfyUI 已啟動。 ");
  return await response.json() as { configured: boolean };
}

export async function getGeminiTtsVoices(options: {
  search: string;
  languageCode: string;
  gender: string;
  pageToken?: string | null;
}) {
  const params = new URLSearchParams();
  if (options.search.trim()) params.set("search", options.search.trim());
  if (options.languageCode.trim()) params.set("language_code", options.languageCode.trim());
  if (options.gender) params.set("gender", options.gender);
  if (options.pageToken) params.set("page_token", options.pageToken);
  const response = await fetch(`${COMFY_URL}/h3-studio/tts/voices?${params}`, {
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) {
    let message = `聲線搜尋失敗（HTTP ${response.status}）。`;
    try {
      const body = await response.json() as { error?: string };
      if (typeof body.error === "string") message = body.error;
    } catch {
      // Do not surface an unexpected or untrusted response body.
    }
    throw new Error(message);
  }
  return await response.json() as { voices: GeminiVoice[]; nextPageToken: string };
}

export async function previewGeminiTtsVoice(options: {
  model: GeminiTtsModel;
  voice: string;
  languageCode: string;
}) {
  let response: Response;
  try {
    response = await fetch(`${COMFY_URL}/h3-studio/tts/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
      signal: AbortSignal.timeout(120000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error("聲線試聽逾時，請稍後再試。 ");
    }
    throw new Error("無法連線到本機語音服務，請確認 ComfyUI 已啟動。 ");
  }

  if (!response.ok) {
    let message = `聲線試聽失敗（HTTP ${response.status}）。`;
    try {
      const body = await response.json() as { error?: string };
      if (typeof body.error === "string") message = body.error;
    } catch {
      // Do not surface an unexpected or untrusted response body.
    }
    throw new Error(message);
  }
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("audio/wav")) {
    throw new Error("Gemini 回傳格式不是 WAV 音訊，請稍後再試。 ");
  }
  const audio = await response.blob();
  if (!audio.size) throw new Error("Gemini 回傳的 WAV 音訊是空檔。 ");
  return audio;
}

export async function generateGeminiTts(options: {
  model: GeminiTtsModel;
  voice: string;
  text: string;
  style: string;
}) {
  let response: Response;
  try {
    response = await fetch(`${COMFY_URL}/h3-studio/tts/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
      signal: AbortSignal.timeout(330000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error("語音生成逾時，請稍後再試。 ");
    }
    throw new Error("無法連線到本機語音服務，請確認 ComfyUI 已啟動。 ");
  }

  if (!response.ok) {
    let message = `語音生成失敗（HTTP ${response.status}）。`;
    try {
      const body = await response.json() as { error?: string };
      if (typeof body.error === "string") message = body.error;
    } catch {
      // Do not surface an unexpected or untrusted response body.
    }
    throw new Error(message);
  }

  return await response.json() as GeneratedAudio;
}
