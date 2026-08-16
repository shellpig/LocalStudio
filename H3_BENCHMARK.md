# MiniMax H3 實測紀錄

測試日期：2026-08-11（Asia/Taipei）

硬體：RTX 4080 Laptop 12GB、系統 RAM 31.63GiB。所有測試皆為 batch 1、608×352、24fps、5.167 秒、124 frames，使用相同 prompt 與 seed `556589502035082`。

| Workflow | Steps | Sampler / Scheduler | Video VAE | Peak VRAM（觀察值） | Time | Result |
|---|---:|---|---|---:|---:|---|
| Native baseline | 20 | `res_multistep` / `simple` | FP16 | 約 11486MiB | 283.05s | 成功，H.264 + AAC stereo |
| QUALITY（Sage） | 20 | `res_multistep` / `simple` | FP16 | 約 11458MiB | 186.76s | 成功，較 Native 快約 34% |
| Turbo 6，冷啟動 | 6 | Larry Turbo（Euler）/ `simple` | FP16 | 約 11524MiB | 115.53s | 成功，較 Native 快約 59% |
| Turbo 8，暖機 | 8 | Larry Turbo（Euler）/ `simple` | INT8 ConvRot | 約 10855MiB（採樣觀察值） | 103.20s | 成功，INT8 VAE 無黑畫面 |
| FAST 6，暖機 | 6 | Larry Turbo（Euler）/ `simple` | INT8 ConvRot | 約 11589MiB | 57.74s | 成功，正式 FAST 檔驗證 |

## 記憶體與條件

- Native 測試期間系統 RAM 最高觀察約 29.83GiB／31.63GiB；後續測試未分離出可靠的逐次 RAM peak，但均完整執行且未 OOM。
- 全部測試完成並關閉 ComfyUI 後，idle VRAM 為 895MiB used／11101MiB free。
- FP16 Video VAE staged memory：4965MB。
- INT8 ConvRot Video VAE staged memory：2677MB，約少 46%。
- `DynamicVRAM`、RAM offload、async weight offload（2 streams）均由 ComfyUI 自動啟用。
- FAST 的 `low_vram` 保持 OFF。作者最新 README 指出 OFF 的 bypass 模式畫質較銳利；本機未 OOM，因此不採用較柔化的 merge 模式。
- Turbo 8 與 FAST 6 是模型已載入後的暖機結果；不能直接當作首次開機所需時間。首次執行還要載入 text encoder、diffusion model 與 LoRA。

## 輸出驗證

| 檔案 | 規格 |
|---|---|
| `ComfyUI/output/video/MiniMax_H3_00001_.mp4` | Native；608×352、24fps、5.167s、AAC 32kHz stereo |
| `ComfyUI/output/video/MiniMax_H3_00002_.mp4` | Sage；608×352、24fps、5.167s、AAC 32kHz stereo |
| `ComfyUI/output/video/MiniMax_H3_00003_.mp4` | Turbo 6 FP16 VAE；608×352、24fps、5.167s、AAC 32kHz stereo |
| `ComfyUI/output/video/MiniMax_H3_TURBO8_00001_.mp4` | Turbo 8 INT8 VAE；608×352、24fps、5.167s、AAC 32kHz stereo |
| `ComfyUI/output/video/MiniMax_H3_FAST_00001_.mp4` | 正式 FAST 6 INT8 VAE；608×352、24fps、5.167s、AAC 32kHz stereo |

抽取五支影片的 2.5 秒中間畫面比對，皆有正常影像；INT8 VAE 輸出沒有黑畫面。音訊串流存在，但本次只做技術驗證，未做主觀音質評分。

## 建議升級順序

目前正式工作流先維持 0.2MP（608×352）。若要提高解析度，一次只改一項：先測 0.3MP（736×416），成功後再測 0.4MP（864×480）。若 OOM，先把 Turbo LoRA 的 `low_vram` 改為 ON，再考慮 H3 Low VRAM Attention／FFN slicing。
