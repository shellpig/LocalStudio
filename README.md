# H3 Local Studio

Windows 本機版 MiniMax H3 影片製作介面，透過 ComfyUI 執行生成流程。

目前包含：

- 首尾圖生影片（FL2VA）
- 參考圖生影片（Ref2VA），最多 9 個參考項目
- 每個參考項目支援圖片、`@標籤` 與可選填的參考說明
- Ref2VA 延伸影片：沿用原參考人物／場景，以完成影片最後畫面銜接下一段，裁除重疊幀後合併
- 1344×768、Turbo 8 步，以及每一步完成後休息 12 秒
- 作品列表、刪除、下載與生成設定 metadata

## 目錄配置

此倉庫預期使用以下配置：

```text
LocalStudio/
├─ .venv/
├─ ComfyUI/
│  └─ custom_nodes/
├─ h3-local-studio/
├─ workflows/
├─ start_h3_studio.bat
├─ start_comfyui_h3.bat
└─ stop_h3_studio.bat
```

模型、Python 虛擬環境、`node_modules`、輸入素材與生成作品都不包含在 Git 倉庫內。

## 必要環境

- Windows 10/11
- NVIDIA GPU 與可用的 CUDA／PyTorch 環境
- Python 虛擬環境位於根目錄 `.venv`
- Node.js 22.13.0 以上
- ComfyUI 位於根目錄 `ComfyUI`
- FFmpeg 可由系統 PATH 呼叫

## ComfyUI 自訂節點

先安裝下列依賴：

- [ComfyUI-MiniMax-H3-Turbo](https://github.com/Larryvrh/ComfyUI-MiniMax-H3-Turbo)
- [ComfyUI-H3-Motion-Context](https://github.com/NikoDemon80/ComfyUI-H3-Motion-Context) `v0.2.0`
- [ComfyUI-MiniMax-H3-LongMedia](https://github.com/vizart-vj/ComfyUI-MiniMax-H3-LongMedia) `v0.3.11`
- [ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes)

倉庫內的下列檔案是 Studio 自有整合，應保留在 `ComfyUI/custom_nodes/`：

- `h3_studio_api.py`
- `h3_prompt_output_schema.json`
- `h3_cooled_turbo_sampler.py`

安裝或更新節點後重新啟動 ComfyUI。

## 模型

Studio 會使用下列模型檔名；請依各自節點文件下載到 ComfyUI 對應的模型目錄：

- `minimax_h3_fl2va_pruned_int8_convrot.safetensors`
- `minimax_h3_ref2va_pruned_w4a8_mixed.safetensors`（約 11 GB）
- `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors`
- `minimax_h3_video_vae_int8_convrot.safetensors`
- `minimax_h3_video_vae_fp16.safetensors`
- `minimax_h3_audio_vae_fp32.safetensors`
- `minimax_h3_turbo_v4_step600_ema.safetensors`

## 安裝 Studio 介面

```powershell
cd .\h3-local-studio
npm install
```

完成 ComfyUI、節點與模型安裝後，回到倉庫根目錄執行：

```powershell
.\start_h3_studio.bat
```

介面會開在 `http://localhost:3000`，ComfyUI API 使用 `http://127.0.0.1:8188`。

停止服務：

```powershell
.\stop_h3_studio.bat
```

## 工作流程

`workflows/` 保留原有的 12 GB 顯存流程，包括 Quality、Fast、Sage 與 Turbo 6/8 步版本。Studio 會由程式動態建立首尾圖、Ref2VA 與影片延伸流程。
