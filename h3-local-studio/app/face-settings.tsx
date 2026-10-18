"use client";

import { FaceRefineOptions } from "@/lib/face-refine";

export default function FaceSettings({ value, onChange, references, disabled = false }: {
  value: FaceRefineOptions; onChange: (value: FaceRefineOptions) => void; references: string[]; disabled?: boolean;
}) {
  return <div className="settings-grid face-settings">
    <label><span>精修模式</span><select aria-label="人臉精修模式" value={value.mode ?? "native-20"} disabled={disabled} onChange={(event) => onChange({ ...value, mode: event.target.value as FaceRefineOptions["mode"] })}>
      <option value="native-20">原生 20 步 · 保留音訊約束</option>
      <option value="turbo-8">快速 8 步 · 不做音訊約束</option>
    </select></label>
    <label><span>修復人物</span><select aria-label="修臉人物" value={value.select} disabled={disabled} onChange={(event) => onChange({ ...value, select: event.target.value as FaceRefineOptions["select"] })}>
      <option value="largest_face">臉最大的人物</option><option value="left_most">最左側人物</option><option value="right_most">最右側人物</option><option value="centre_most">最靠近中央的人物</option>
      <option value="all_faces">不只一名人物，逐人修復</option>
    </select></label>
    <label><span>身份參考圖</span><select aria-label="修臉身份參考圖" value={value.select === "all_faces" ? "auto" : value.referenceIndex} disabled={disabled || value.select === "all_faces"} onChange={(event) => onChange({ ...value, referenceIndex: Number(event.target.value) })}>
      {value.select === "all_faces" ? <option value="auto">自動擷取各人物清晰人臉</option> : references.length ? references.map((name, index) => <option key={index} value={index}>{name}</option>) : <option value={0}>請先加入人物圖片</option>}
    </select></label>
    <label><span>修復強度</span><select aria-label="修臉強度" value={value.strength} disabled={disabled} onChange={(event) => onChange({ ...value, strength: Number(event.target.value) })}>
      <option value={0.2}>輕度 · 0.2</option><option value={0.3}>適中 · 0.3</option><option value={0.4}>較強 · 0.4</option>
    </select></label>
    {value.mode === "turbo-8" && <p className="face-help face-mode-note">快速精修保留原音軌，但不以原音訊約束嘴型；說話鏡頭可能對不上聲音。</p>}
    {value.select === "all_faces" && <p className="face-help face-mode-note">自動偵測可追蹤的人臉，使用各自的原片人臉逐組修復；不同鏡頭分開計算，可能包含同一人物。耗時隨人物組數增加，交錯與遮擋仍可能追錯。</p>}
  </div>;
}
