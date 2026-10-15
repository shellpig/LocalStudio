import { GeneratedVideo, request } from "./comfy";

export type RTXOperation = "fps" | "upscale";
export type RTXInput = { sourceId: string; width: number; height: number; fps: number; duration: number };
export const RTX_MULTIPLIERS = {
  fps: Array.from({ length: 15 }, (_, index) => index + 2),
  upscale: [2, 3, 4],
};

export async function prepareRTX(source: File | GeneratedVideo): Promise<RTXInput> {
  let init: RequestInit;
  if (source instanceof File) {
    if (source.size > 1024 ** 3) throw new Error("影片檔案上限為 1 GB。");
    const body = new FormData();
    body.append("video", source);
    init = { method: "POST", body };
  } else {
    init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source }) };
  }
  return await (await request("/h3-studio/rtx/prepare", init)).json() as RTXInput;
}

export async function runRTX(source: File | GeneratedVideo, operation: RTXOperation, multiplier: number, onStatus: (status: string) => void, prepared?: RTXInput) {
  if (!RTX_MULTIPLIERS[operation]?.includes(multiplier)) throw new Error("無效的 RTX 功能或倍數。");
  const info = await (await request("/object_info/H3StudioRTX")).json();
  if (!info.H3StudioRTX) throw new Error("RTX 功能尚未載入，請重新啟動 ComfyUI。");
  onStatus("正在準備來源影片…");
  const input = prepared ?? await prepareRTX(source);
  const result = await (await request("/prompt", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: { "1": { class_type: "H3StudioRTX", inputs: { source_id: input.sourceId, operation, multiplier } } } }),
  })).json() as { prompt_id?: string; error?: { message?: string }; node_errors?: unknown };
  if (!result.prompt_id) throw new Error(`無法開始 RTX 提升：${result.error?.message ?? JSON.stringify(result.node_errors)}`);
  onStatus(`RTX ${operation === "fps" ? "補幀" : "超解析"} ${multiplier} 倍處理中，包含解碼、AI 運算與編碼…`);
  for (;;) {
    const history = await (await request(`/history/${encodeURIComponent(result.prompt_id)}`)).json();
    const entry = history[result.prompt_id];
    if (entry?.status?.status_str === "error") {
      const failure = entry.status.messages?.find((message: [string, { exception_message?: string }]) => message[0] === "execution_error");
      throw new Error(failure?.[1]?.exception_message ?? "RTX 處理失敗，請查看 ComfyUI。");
    }
    const video = entry?.outputs?.["1"]?.images?.[0] as GeneratedVideo | undefined;
    if (video) return { ...video, promptId: result.prompt_id };
    if (entry?.status?.completed) throw new Error("RTX 工作已結束，但找不到成品。");
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
  }
}
