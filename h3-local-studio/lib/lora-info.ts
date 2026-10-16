export type LoraInfo = {
  description: string;
  weight: string;
  trigger?: string;
  note?: string;
};

const realism: LoraInfo = {
  description: "加強人物皮膚細節、自然表情、動作與寫實光影。",
  weight: "0.6–0.8：較輕的效果；1.0：作者原定強度。",
  trigger: "r34l1sm",
};
const bounce: LoraInfo = {
  description: "加強走路、舞蹈或彎腰時的胸部彈動與晃動。",
  weight: "作者未提供固定建議值，需依成片調整。",
  trigger: "her breast is bouncing up and down",
};
const compatibleNote = "Studio 已支援此權重命名；實際效果仍需成片驗證。";

const catalog: Record<string, LoraInfo> = {
  "minimax_h3_turbo_v4_step600_ema.safetensors": {
    description: "讓 H3 用 4–8 步生成影片與同步聲音；影片模式會自動套用。",
    weight: "1.0。",
    note: "無需重複加入額外 LoRA。",
  },
  "h3-realism-people-t2v-i2v-r2v.safetensors": { ...realism, note: "原檔與 _H3Studio 版本皆支援；實際效果仍需成片驗證。" },
  "h3-realism-people-t2v-i2v-r2v_H3Studio.safetensors": { ...realism, note: "已調整為本機 H3 Studio 的載入格式。" },
  "minimax_h3_orb360_step1500.safetensors": {
    description: "讓攝影機繞靜止人物或物件順時針一圈，主要用於參考生影片。",
    weight: "Studio 設定 0.8；作者示例使用 1.0。",
    trigger: "ORB360_CW",
    note: compatibleNote,
  },
  "qwen_image_2.1_multiple_angles_v2_step1500.safetensors": {
    description: "從參考圖片產生正面、側面、背面、俯視或特寫等新視角。",
    weight: "0.8–1.0。",
    trigger: "<mva>",
    note: "用於 Qwen 圖片的攝影機視角功能，不適用 H3 影片。",
  },
  "MysticXXX_MMH3-V1.safetensors": {
    description: "改善成人題材的人體與解剖外觀；V1 主要著重身體結構。",
    weight: "0.75–0.8：V1 作者建議。",
    note: compatibleNote,
  },
  "bounceV03-000084.safetensors": { ...bounce, note: `較早的 H3 Ref2VA 版本。${compatibleNote}` },
  "bounceV07-000230_Intense.safetensors": { ...bounce, note: `V0.7 改善柔軟感與左右晃動；原檔與 _FIXED 版本皆支援。${compatibleNote}` },
  "bounceV07-000230_Intense_FIXED.safetensors": { ...bounce, note: "V0.7 改善柔軟感與左右晃動，已轉換權重命名；效果仍需成片驗證。" },
  "HMNSFW_AIO_V2.safetensors": {
    description: "成人互動與性行為動作的綜合 LoRA，主要加強動作表現。",
    weight: "0.5 以下：V2 建議；不是 V2.5 的設定。",
    trigger: "hmmotion",
    note: compatibleNote,
  },
  "moawxx_000002000.safetensors": {
    description: "成人題材的女性呻吟聲與相應身體動作，同時影響聲音與動作。",
    weight: "0.6–0.85。",
    trigger: "moawxx",
    note: compatibleNote,
  },
  "vagassist_e40.safetensors": {
    description: "女性外陰與肛門解剖結構輔助，偏重靜態外觀。",
    weight: "1.0：靜態權重建議。",
    trigger: "Vagina",
    note: `HMPussy v0.5 的靜態權重；動態搭配檔未安裝。${compatibleNote}`,
  },
  "HMInnie_v1_e50.safetensors": {
    description: "女性外陰 innie 外觀的解剖輔助，偏重靜態結構。",
    weight: "作者未提供固定建議值，需依成片調整。",
    trigger: "inniepussy",
    note: compatibleNote,
  },
};

export function getLoraInfo(name: string): LoraInfo {
  return catalog[name.split(/[\\/]/).pop() ?? name] ?? {
    description: "尚未核對此 LoRA 的功能說明。",
    weight: "未確認，請依作者的版本說明設定。",
  };
}
