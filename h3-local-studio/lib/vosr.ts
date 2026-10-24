import { GeneratedVideo, request } from "./comfy";
import { prepareRTX, RTXInput } from "./rtx";

export type VOSRInput = RTXInput & { sourceName: string; sourceFile: string };

export async function prepareVOSR(source: File | GeneratedVideo, restoreOriginal = false): Promise<VOSRInput> {
  const ready = await (await request("/h3-studio/vosr/status")).json();
  if (!ready.ready) throw new Error(`VOSR 尚未就緒，請確認節點、模型及 ComfyUI 已重新啟動。${ready.missing?.join("、") ?? ""}`);
  if (restoreOriginal && !(source instanceof File) && source.vosrRefined && source.vosrSourceId) {
    return await (await request("/h3-studio/vosr/restore", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId: source.vosrSourceId }),
    })).json() as VOSRInput;
  }
  // Reuse the existing bounded video upload/copy and source manifest.
  return await prepareRTX(source) as VOSRInput;
}

export function vosrPreview(input: VOSRInput) {
  return `http://127.0.0.1:8188/view?${new URLSearchParams({ filename: input.sourceFile, subfolder: `h3_rtx/${input.sourceId}`, type: "input" })}`;
}

export async function runVOSR(input: VOSRInput, onStatus: (message: string) => void): Promise<GeneratedVideo> {
  const jobId = crypto.randomUUID().replaceAll("-", "");
  const submitted = await (await request("/prompt", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: { "1": { class_type: "H3StudioVOSR", inputs: { source_id: input.sourceId, job_id: jobId } } } }),
  })).json();
  if (!submitted.prompt_id) throw new Error(`無法開始 VOSR 精修：${submitted.error?.message ?? JSON.stringify(submitted.node_errors)}`);
  let lastStatus = "";
  for (;;) {
    const history = await (await request(`/history/${encodeURIComponent(submitted.prompt_id)}`)).json();
    const entry = history[submitted.prompt_id];
    const failure = entry?.status?.messages?.find(([event]: [string, unknown]) => event === "execution_error" || event === "execution_interrupted");
    if (failure || entry?.status?.status_str === "error") throw new Error(failure?.[1]?.exception_message ?? "VOSR 工作已停止或失敗，原片保留。");
    const video = entry?.outputs?.["1"]?.images?.[0] as GeneratedVideo | undefined;
    if (video) return { ...video, promptId: submitted.prompt_id };
    if (entry?.status?.completed) throw new Error("VOSR 工作已結束，但找不到成品。");
    const progress = await (await request(`/h3-studio/vosr/progress/${jobId}`)).json();
    const message = progress.phase === "processing" ? `VOSR 精修：${progress.done}／${progress.total} 幀` : progress.phase === "verifying" || progress.phase === "complete" ? "正在驗證幀數、尺寸與原音軌…" : progress.phase === "loading" ? "正在釋放前一筆模型並載入 VOSR…" : lastStatus || "VOSR 已排入 ComfyUI 佇列…";
    if (message !== lastStatus) onStatus(message);
    lastStatus = message;
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
}
