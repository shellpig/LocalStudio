# MiniMax H3 / ComfyUI 安裝結果

完成日期：2026-08-11（Asia/Taipei）

狀態：安裝完成；Native、Sage、Turbo 6 steps、Turbo 8 steps、INT8 VAE 均已完成實際影片 smoke test。

## 安裝位置

- 專案：`E:\AI_Work\projects\MinimaxH3`
- ComfyUI：`E:\AI_Work\projects\MinimaxH3\ComfyUI`
- Python venv：`E:\AI_Work\projects\MinimaxH3\.venv`
- E 槽為 SanDisk Extreme USB SSD。可以正常使用，但安裝套件與大量小檔案操作會比內接 NVMe 慢。

## Environment

| Component | Installed |
|---|---|
| GPU | NVIDIA GeForce RTX 4080 Laptop GPU，12282MiB |
| NVIDIA Driver | 591.86 |
| Python | 3.11.15 |
| ComfyUI | 0.31.0，commit `62b3c94bd451` |
| PyTorch | 2.10.0+cu130 |
| Torch CUDA | 13.0 |
| Triton | `triton-windows` 3.6.0.post26 |
| SageAttention | 2.2.0+cu130torch2.10.0andhigher.post6 |
| KJNodes | commit `073efb07419f` |
| MiniMax-H3 Turbo nodes | 1.2.3，commit `55fee864dd7b` |
| ffmpeg / ffprobe | 8.1 |

`pip check` 無相依套件衝突；SageAttention CUDA kernel 已用 RTX 4080 Laptop 實際執行通過。

## VRAM / RAM

- ComfyUI 關閉後 idle VRAM：895MiB used／11101MiB free。
- 測試中最高觀察 VRAM：約 11589MiB；沒有 CUDA OOM。
- 系統 RAM 最高觀察：約 29.83GiB／31.63GiB。
- ComfyUI 的 `/free` 不一定立即把 Windows WDDM／cudaMallocAsync 保留池還給系統；要完整釋放顯存，正常關閉 ComfyUI 視窗即可。

## Models

### 官方穩定基線

- Diffusion：`minimax_h3_fl2va_pruned_int8_convrot.safetensors`（19.530GiB）
- Text encoder：`qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors`（14.610GiB）
- Video VAE：`minimax_h3_video_vae_fp16.safetensors`（4.850GiB）
- Audio VAE：`minimax_h3_audio_vae_fp32.safetensors`（0.564GiB）

### 加速元件

- Larryvrh Turbo LoRA：`minimax_h3_turbo_v4_step600_ema.safetensors`
  - SHA-256：`5f3a626cd72c93a8b9318d6760c510bc5092d2ab13aaba1f932c5bab07a416d3`
- Kijai INT8 Video VAE：`minimax_h3_video_vae_int8_convrot.safetensors`
  - SHA-256：`9bb2d96f218c76babd85e0611b85ca8fb330a90546c01a0005e8a58a59593410`

所有模型均通過 Safetensors 結構讀取；原 FP16 VAE 保留，未被 INT8 版本覆蓋。

## 正式 Workflows

### FAST

檔案：`H3_4080Laptop_12GB_FAST.json`

- H3 pruned INT8 ConvRot
- NVFP4 AWQ text encoder
- Larryvrh Turbo v4-600 EMA，strength 1.0
- Turbo 專用 sampler（新版 ComfyUI 上為 Euler single schedule）
- BasicScheduler `simple`
- 6 steps
- KJNodes H3 Memory Efficient Sage Attention
- INT8 ConvRot Video VAE
- 608×352、24fps、5.167 秒／124 frames
- `low_vram = OFF`（本機實測成功且畫質較佳）

### QUALITY

檔案：`H3_4080Laptop_12GB_QUALITY.json`

- 不使用 Turbo LoRA
- 官方 `res_multistep` sampler + `simple` scheduler
- 20 steps
- KJNodes H3 Memory Efficient Sage Attention
- 官方 FP16 Video VAE（優先穩定與畫質）
- 608×352、24fps、5.167 秒／124 frames

### 可選 8-step Turbo

檔案：`H3_4080Laptop_12GB_TURBO_8STEP.json`

與 FAST 相同，但改為 8 steps；已完整生成成功。

## 與舊任務書不同之處

- Larryvrh 最新 README 推薦 v4-600 EMA，6–8 steps、strength 1.0、`simple` scheduler；不再採用舊文章中的 beta scheduler 或一般 LoRA Loader。
- `low_vram` 最新定義為 ON=merge（較省 VRAM但在量化 base 上較柔），OFF=bypass（畫質較銳利）。12GB 實測未 OOM，因此正式 FAST 保持 OFF；OOM 時才切 ON。
- 未啟用額外 cache、skip-step、Low-VRAM attention slicing 或 FFN slicing。現有 H3 專用 Sage patch 已穩定落在 12GB 內，再疊功能會增加排錯變因。

## 啟動與使用

1. 雙擊 `start_comfyui_h3.bat`。
2. 開啟 `http://127.0.0.1:8188`。
3. 用 ComfyUI 的 `Ctrl+O` 載入 FAST 或 QUALITY JSON。
4. 初次啟動後若自訂節點被前端標示為缺少，按 `R` 重新整理節點定義，再重新載入 JSON。
5. 第一次生成較慢；後續相同模型的工作流會利用已載入模型與 conditioning cache。

詳細時間與輸出規格見 `H3_BENCHMARK.md`。

## 來源

- ComfyUI H3 官方教學：<https://docs.comfy.org/tutorials/video/minimax/minimax-h3>
- KJNodes：<https://github.com/kijai/ComfyUI-KJNodes>
- Kijai H3 experimental：<https://huggingface.co/Kijai/MiniMax-H3-experimental>
- Larryvrh Turbo nodes：<https://github.com/Larryvrh/ComfyUI-MiniMax-H3-Turbo>
- Larryvrh Turbo LoRA：<https://huggingface.co/larryvrh/MiniMax-H3-Turbo-Lora>
