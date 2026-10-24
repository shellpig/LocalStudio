# H3 Local Studio

Windows 本機版 MiniMax H3 影片製作介面。影片、Qwen 圖像、SeedVR2 與 RTX 畫質提升在本機執行；語音可選 Drama3 本機多人配音，或使用 Google Gemini API。可選的 Prompt 優化會透過 Codex／Grok CLI 使用外部服務，並提供提示詞及所選圖片。

## 功能

- H3 主模型可選原版或 Singularity V2 pruned INT8；切換時自動配對加速 LoRA 與採樣器，保存至作品設定
- 文字轉影片（T2VA）
- 首尾圖轉影片（I2VA / FL2VA / L2VA）
- H3 影片注意力可選 SageAttention（預設）或 sol-attn＋Comfy Kitchen；參考生影片暫維持 SageAttention
- 參考圖轉影片（Ref2VA），最多 9 個參考項目，每項可設圖片、`@標籤` 與說明
- 影片延伸：沿用原本的人物與場景，接續前一段的最後畫面，裁掉重疊幀後合併
- 官方 H3 Prompt 優化：把一句白話描述改寫成 MiniMax 官方格式，可選 Codex 或 Grok 執行
- 圖像編輯（Qwen-Image 2.1）：原版、Noct Q V4、REDQW21 UNLOCKED V2 三種主模型可切換；文字生圖或上傳最多 4 張圖編輯，支援 7 種比例與 2K。編輯預設依第一張圖比例，指定比例時先裁切第一張圖
- 語音生成（Gemini 3.8 TTS，雲端，可選）：文字轉 WAV，30 個預設聲線加上可搜尋、試聽的 Google 聲線庫
- 語音生成（Drama3，本機，可選）：最多 16 個角色、逐段台詞與表演提示，支援參考音訊辨識、保存聲線、試聽、FLAC 下載與再做一次；使用時啟動獨立服務，工作結束後關閉程序釋放記憶體
- 攝影機視角：Qwen 圖像搭配 Multiple-Angles LoRA v2，支援方位、角度、景別與強度
- 影片換角：BFS 換頭（臉部＋髮型）或整個角色替換（4／6／8／20 步），另可選 Akatz V1.5 整個角色替換（20 步）；支援 480P／540P／原生 H3，沿用來源影片比例並合回原音軌
- 人臉精修：作品可逐鏡頭預覽選臉，首尾圖／參考生影片可勾選生成後自動精修；支援原生 20 步、快速 8 步及多人逐組修復，保留原片並另存成品
- 影片畫質提升：SeedVR2 3B INT8，另存 720p 作品，保留原比例、幀率與聲音
- VOSR 1× 精修：從畫質提升頁或作品選單執行，維持原尺寸、幀率與幀數，另存成品並複製原片第一條音軌；逐幀進度、原始來源還原及獨立工作程序釋放
- RTX 提升：NVIDIA VFX SDK 補幀 2～16 倍，或超解析 2／3／4 倍，另存新影片，保留時長與聲音
- H3 影片、Qwen 圖片、RTX 提升、VOSR 精修與 Drama3 工作共用生成佇列，按下生成時保存設定，依序執行
- 額外 H3 LoRA：選單顯示用途、強度與觸發詞，支援社群常見權重命名及載入檢查
- 作品列表、刪除、下載，並保存生成設定 metadata

---

# 這個倉庫不包含什麼

**這一節最重要。** 倉庫提供原始碼，不包含 ComfyUI、執行環境及模型。完整 H3 七個模型約 **54.2 GiB**；加上 Qwen、攝影機 LoRA 與 SeedVR2，模型合計約 **74.3 GiB**（約 80 GB），還需另外預留環境、下載快取、暫存影片與作品空間。

上述大小使用 Qwen 原版；另加 Noct Q V4 與 REDQW21 V2 兩個可選主模型需約 **13.5 GiB**，三款都保留時模型合計約 **87.8 GiB**。

基本模型合計亦不含 Singularity V2 與 VOSR：Singularity V2 主模型與專用加速 LoRA 另約 **21.35 GiB**；VOSR 完整可用 bundle 另約 **6.49 GiB**，DINOv2 的原始 `.pth` 下載／轉換另需約 **1.13 GiB** 暫存空間。

以上合計**不含**可選的 BFS／ORB360／其他社群 LoRA、RTX 套件與 Drama3 獨立環境。Drama3 的 W4A8 主模型、codec 與 0.6B ASR 三項合計約 **25.8 GiB（27.7 GB）**，還需另留 Python 套件、快取與成品空間；RTX 不另下載上述 safetensors 模型，使用 NVIDIA 提供的套件。

| 缺少的東西 | 大小 | 為什麼不在倉庫裡 |
|---|---:|---|
| ComfyUI 本體 | 約 1 GB | 上游專案，另行 clone |
| 四個第三方 ComfyUI 節點 | 約 50 MB | 各自有 repo 與授權 |
| Python 虛擬環境 `.venv` | 約 8 GB | 含 PyTorch 與 CUDA 套件 |
| 模型檔 | H3 約 54.2 GiB；H3＋原版 Qwen＋SeedVR2 等約 74.3 GiB；Drama3 另加約 25.8 GiB | 體積過大，見步驟 7 |
| Drama3 獨立 ComfyUI 與 venv | 模型外另需環境空間 | 位於 `services/Drama3/`，不納入 Git，見步驟 12 |
| NVIDIA VFX SDK Python 套件 | 依平台 wheel 而異 | RTX 提升的可選依賴，見步驟 13 |
| `h3-local-studio/node_modules` | 約 300 MB | 由 `npm install` 產生 |
| FFmpeg | 約 150 MB | 系統層工具 |
| Codex 或 Grok CLI | 小 | 需個人帳號登入 |
| Gemini API 金鑰 | — | 個人憑證，只放在環境變數（見步驟 11） |
| `h3-prompt-writing` skill | 小 | 本倉庫未附，取得與重建方式見步驟 10 |

倉庫本身只有：Studio 前端原始碼、ComfyUI 整合節點、五個 workflow JSON、啟動腳本與文件。

---

# 安裝

以下指令使用 **Windows PowerShell**，以專案根目錄為起點。先完成共同環境，再依功能下載模型；不要下載整個 Hugging Face 模型倉庫。

| 想使用的功能 | 步驟 7 需要下載的模型 | 另外需要 |
|---|---|---|
| Singularity V2 影片（可選） | H3 共用三項、Singularity V2 pruned INT8、LightX2V Ref2VA 4-step ComfyUI LoRA；QUALITY 另需 FP16 影片 VAE | 沿用既有 H3 節點，見下方 Singularity V2 說明 |
| VOSR 1× 精修（可選） | VOSR2 DiT、配套 Qwen 2D VAE、DINOv2-L；不是 H3／Qwen 圖像頁既有 VAE | 步驟 15 的 VOSR 節點、FFmpeg；使用主專案 venv |
| H3 文字／首尾圖影片（4步／6步／8步） | H3 共用三項、首尾圖模型、Turbo LoRA | 步驟 5 的 H3 節點 |
| H3 QUALITY、一般影片動態延伸 | 上述模型，另加 FP16 影片 VAE | Motion Context 節點 |
| H3 參考生影片（4步／6步／8步） | H3 共用三項、Ref2VA W4A8 模型、Turbo LoRA | LongMedia 節點；最多 9 張參考圖 |
| 影片換角（BFS／Akatz V1.5） | H3 共用三項、Ref2VA W4A8 模型、所選換角 LoRA；BFS 4／6／8 步另需 Turbo LoRA，Akatz V1.5 使用 20 步 | 既有 H3／KJNodes 節點與 FFmpeg；BFS 另使用 H3 原生 Add Guide |
| 人臉精修（手動／生成後自動／多人） | H3 共用文字編碼器、聲音 VAE、Ref2VA W4A8 模型、FP16 影片 VAE；快速 8 步另需 Turbo LoRA | 步驟 14 的 FaceRefine、NativeAudioLock 節點與人臉偵測器；FFmpeg |
| Qwen 文字生圖／圖像編輯 | Qwen 三項 | 使用 ComfyUI v0.37.0 |
| Qwen 攝影機視角 | Qwen 三項、攝影機 LoRA | 只上傳一張原圖 |
| 影片畫質提升（AI 強度大於 0%） | SeedVR2 兩項 | ComfyUI v0.37.0 的內建 SeedVR2 節點、FFmpeg |
| H3 Prompt 優化 | 不需要額外生成模型 | Codex 或 Grok 登入，加上外部 Prompt skill |
| Qwen 提示詞優化 | 不需要額外生成模型 | 固定使用 Codex CLI，不使用 H3 Prompt skill |
| Gemini 語音生成 | 不需要本機生成模型 | 步驟 11 的 API 金鑰 |
| Drama3 本機多人配音 | Drama3 W4A8、codec；辨識逐字稿另需 0.6B ASR | 步驟 12 的獨立 ComfyUI v0.40.0 與 venv，不使用 Gemini 金鑰 |
| RTX 補幀／超解析 | 不需要額外的 safetensors 模型 | 步驟 13 的 `nvidia-vfx`、FFmpeg；補幀需 RTX 40 系列或更新 |

目前指南固定主要套件與節點到本機使用的版本；第三方 requirements 中的其他相依套件仍由 pip 解析。本指南已核對原始碼、版本與下載來源，尚未在另一台乾淨電腦完成全流程重裝。

## 步驟 0：硬體與系統需求

| 項目 | 需求 | 開發機實測值 |
|---|---|---|
| 作業系統 | Windows 10 / 11 | Windows 11 |
| GPU | NVIDIA，**VRAM 12 GB 以上** | RTX 4080 Laptop 12 GB |
| 系統 RAM | **32 GB 以上** | 32 GB |
| 硬碟空閒空間 | H3 建議至少 80 GB；H3＋原版 Qwen＋SeedVR2 建議至少 110 GB；其他模型、Drama3 環境、作品與快取另計 | — |
| NVIDIA 驅動 | 支援 CUDA 13.0 | 591.86 |

先安裝 Git、Python **3.11（64-bit）** 與 Node.js **24.15.0 或相容的 24.x LTS**。來源：[Git for Windows](https://git-scm.com/downloads/win)、[Python Windows 下載](https://www.python.org/downloads/windows/)、[Node.js 下載](https://nodejs.org/en/download)。Python 需包含 `py` launcher，Git 與 Node.js 需加入 PATH。若使用官方 Python install manager，先執行 `py install 3.11` 安裝 3.11 runtime；使用傳統 installer 時，選 64-bit Python 3.11 並安裝 launcher。

在新開的 PowerShell 確認工具可用，再進行 clone：

```powershell
git --version
py -3.11 --version
node --version
npm --version
```

**RAM 提醒：** H3 單次生成可能需要讀取約 40 GB 的模型權重，超過 32 GB 實體記憶體。系統會把記憶體對映的權重換出，取樣時再從硬碟讀回。**強烈建議把整個專案放在內接 NVMe，不要放在 USB 外接硬碟。** 放外接碟時實測讀取延遲會達到 300 毫秒，GPU 使用率掉到 20% 以下，生成時間會從 1 分鐘變成 10 分鐘以上。

**Drama3 另有記憶體需求：** 目前採 W4A8、experts 放系統 RAM，主模型檔約 24.6 GB；即使只有一句話，也需準備整套模型。上游列 W4A8 約需 32 GB RAM，這不代表 32 GB 機器同時開其他軟體仍能順暢執行。本機 32 GB 曾在生成時只剩約 200 MB 可用 RAM 並大量讀入磁碟頁面，數秒音訊可耗時數分鐘。工作完成後退出 Drama3 服務只解決閒置占用，不代表生成速度已改善。

## 步驟 1：取得倉庫

```powershell
git clone https://github.com/shellpig/LocalStudio.git MinimaxH3
cd MinimaxH3
```

以下所有指令都在這個根目錄執行。文件中的 `<專案根目錄>` 就是這裡。

## 步驟 2：建立 Python 環境

以下用專案 venv 安裝 Python 套件，不使用 ComfyUI portable 的 `python_embeded`。

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
```

安裝 PyTorch（CUDA 13.0 版）：

```powershell
.\.venv\Scripts\python.exe -m pip install torch==2.10.0 torchvision==0.25.0 torchaudio==2.10.0 --index-url https://download.pytorch.org/whl/cu130
```

驗證：

```powershell
.\.venv\Scripts\python.exe -c "import torch; print(torch.__version__, torch.version.cuda, torch.cuda.is_available())"
```

應輸出類似 `2.10.0+cu130 13.0 True`。**`True` 是關鍵**，若是 `False` 表示 CUDA 沒接上，先解決這個再往下。

## 步驟 3：安裝 ComfyUI

把 ComfyUI clone 到根目錄底下的 `ComfyUI`：

```powershell
git clone https://github.com/comfyanonymous/ComfyUI.git ComfyUI
cd ComfyUI
git checkout v0.37.0
..\.venv\Scripts\python.exe -m pip install -r requirements.txt
cd ..
```

`v0.37.0`（commit `73c9bad4d21e7addbe1d13bc92eee0f1431b017d`）是本指南的固定版本，包含 Qwen-Image 2.1 與此專案使用的 SeedVR2 內建節點。舊版 H3 安裝實測不代表支援目前全部功能；不要依 `H3_INSTALL_RESULT.md` 降到 v0.31.0。

## 步驟 4：安裝加速套件

固定 Triton，SageAttention 使用與 Python 3.11／Torch 2.10／CUDA 13.0 相容的 Windows wheel，而不是只執行未固定版本的 `pip install sageattention`。

```powershell
.\.venv\Scripts\python.exe -m pip install triton-windows==3.6.0.post26
.\.venv\Scripts\python.exe -m pip install "https://github.com/woct0rdho/SageAttention/releases/download/v2.2.0-windows.post6/sageattention-2.2.0%2Bcu130torch2.10.0andhigher.post6-cp310-abi3-win_amd64.whl#sha256=1635283f5c01ec3cda58a784d0d7eabbcaffaf9511d1b263db4750e1ed7958bb"
```

來源：[SageAttention Windows post6 release](https://github.com/woct0rdho/SageAttention/releases/tag/v2.2.0-windows.post6)。此 wheel 的 `cp310-abi3` 標籤可用於本指南的 Python 3.11，不應換成只支援 cp312／cp313 的 wheel。

```powershell
.\.venv\Scripts\python.exe -c "import importlib.metadata as m; import triton, sageattention; print('triton-windows', m.version('triton-windows')); print('sageattention', m.version('sageattention'))"
.\.venv\Scripts\python.exe -m pip check
```

預期版本為 `3.6.0.post26` 與 `2.2.0+cu130torch2.10.0andhigher.post6`。版本及 import 檢查不能代替最後的實際生成驗證。

## 步驟 5：安裝第三方 ComfyUI 節點

從專案根目錄執行；每個 clone 都固定到本機使用的 commit，避免直接使用未驗證的最新版本。

```powershell
git clone https://github.com/Larryvrh/ComfyUI-MiniMax-H3-Turbo.git ComfyUI/custom_nodes/ComfyUI-MiniMax-H3-Turbo
git -C ComfyUI/custom_nodes/ComfyUI-MiniMax-H3-Turbo checkout 55fee864dd7b2976b1c4ce3c3d5f7968f181409f

git clone https://github.com/NikoDemon80/ComfyUI-H3-Motion-Context.git ComfyUI/custom_nodes/ComfyUI-H3-Motion-Context
git -C ComfyUI/custom_nodes/ComfyUI-H3-Motion-Context checkout c140ae99b8c38f782ebd8564c267b42aacade6a4

git clone https://github.com/vizart-vj/ComfyUI-MiniMax-H3-LongMedia.git ComfyUI/custom_nodes/ComfyUI-MiniMax-H3-LongMedia
git -C ComfyUI/custom_nodes/ComfyUI-MiniMax-H3-LongMedia checkout 96c50f7febc8c2e80c2a50d030d6cb3ff3de7ee3

git clone https://github.com/kijai/ComfyUI-KJNodes.git ComfyUI/custom_nodes/ComfyUI-KJNodes
git -C ComfyUI/custom_nodes/ComfyUI-KJNodes checkout 073efb07419f56cc714e099a82e49fbc23ad9263

.\.venv\Scripts\python.exe -m pip install -r ComfyUI\custom_nodes\ComfyUI-KJNodes\requirements.txt
.\.venv\Scripts\python.exe -m pip check
```

上述固定版本中，只有 KJNodes 另外附 `requirements.txt`；其他三個節點使用 ComfyUI／上述環境的相依套件。SeedVR2 工作流使用 ComfyUI **內建**節點，不需要另裝其他 SeedVR2 自訂節點。

| 節點 | 對應功能 | 本機版本／commit 前綴 |
|---|---|---|
| MiniMax-H3-Turbo | H3 Turbo LoRA 與採樣 | 1.2.3／`55fee864` |
| H3-Motion-Context | 一般影片動態延伸 | 0.2.0／`c140ae99` |
| H3-LongMedia | Ref2VA 參考影片與延伸 | 0.3.11／`96c50f7f` |
| KJNodes | H3 SageAttention patch | `073efb07` |

## 步驟 6：建立 junction（不可省略）

Studio 自有的 ComfyUI 節點放在倉庫的 `integrations\ComfyUI-H3-Studio\`，**不是**放在 `ComfyUI\custom_nodes\`。要讓 ComfyUI 載入它，必須建立一個目錄連結。

這樣設計的原因：程式碼只有一份，Git 追蹤的就是 ComfyUI 實際執行的那一份，不需要複製或同步。

在專案根目錄執行（**不需要系統管理員權限**）：

```powershell
cmd /c mklink /J "$PWD\ComfyUI\custom_nodes\ComfyUI-H3-Studio" "$PWD\integrations\ComfyUI-H3-Studio"
```

驗證：

```powershell
Get-Item ".\ComfyUI\custom_nodes\ComfyUI-H3-Studio" -Force | Select-Object LinkType, Target
```

`LinkType` 應為 `Junction`，`Target` 應指向 `integrations\ComfyUI-H3-Studio`。

**跳過這一步的後果：** ComfyUI 不會註冊 `/h3-studio/*` API 路由，也不會有 `H3CooledSampler` 與 `H3CooledTurboSampler` 兩個節點。Studio 介面會顯示連線正常，但作品列表是空的、優化按鈕會失敗、生成會因為找不到節點而中斷。

## 步驟 7：下載模型

以下模型提供**直接下載連結**；原有 H3／Qwen／SeedVR2 表格固定到 2026-10-11 核對的 revision，後續新增項目以各節標示的核對日期與版本為準。只下載要用的功能；不要 clone 整個模型倉庫，也不要將不同版本的同名模型互換。下載後的檔名與目錄必須和表格一致。若主 ComfyUI 的模型目錄尚不存在，先建立：

```powershell
New-Item -ItemType Directory -Force -Path .\ComfyUI\models\diffusion_models, .\ComfyUI\models\text_encoders, .\ComfyUI\models\vae, .\ComfyUI\models\loras | Out-Null
```

### H3 影片

全部七項約 54.2 GiB。若不做參考影片，可以省略 Ref2VA W4A8；若不使用 QUALITY 或一般動態延伸，可以省略 FP16 影片 VAE。初次設定不確定要用哪些模式時，下載完整七項。

| 本機檔名／下載連結 | 用途 | 放置目錄（專案根目錄起算） | 大小 GiB |
|---|---|---|---:|
| [`qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors`](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/e5eb578a89295337b8ff433a035929ce0279e0b6/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors) | 共用文字編碼器 | `ComfyUI/models/text_encoders/` | 14.61 |
| [`minimax_h3_video_vae_int8_convrot.safetensors`](https://huggingface.co/Kijai/MiniMax-H3-experimental/resolve/d8023be02fefbb3633b0cd335c3879f91177299d/minimax_h3_video_vae_int8_convrot.safetensors) | 共用 INT8 影片 VAE | `ComfyUI/models/vae/` | 2.95 |
| [`minimax_h3_audio_vae_fp32.safetensors`](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/e5eb578a89295337b8ff433a035929ce0279e0b6/vae/minimax_h3_audio_vae_fp32.safetensors) | 共用聲音 VAE | `ComfyUI/models/vae/` | 0.56 |
| [`minimax_h3_fl2va_pruned_int8_convrot.safetensors`](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/e5eb578a89295337b8ff433a035929ce0279e0b6/diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors) | 文字／首尾圖影片 | `ComfyUI/models/diffusion_models/` | 19.53 |
| [`minimax_h3_ref2va_pruned_w4a8_mixed.safetensors`](https://huggingface.co/Kijai/MiniMax-H3-experimental/resolve/d8023be02fefbb3633b0cd335c3879f91177299d/minimax_h3_ref2va_pruned_w4a8_mixed.safetensors) | 參考影片 Ref2VA | `ComfyUI/models/diffusion_models/` | 10.96 |
| [`minimax_h3_video_vae_fp16.safetensors`](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/e5eb578a89295337b8ff433a035929ce0279e0b6/vae/minimax_h3_video_vae_fp16.safetensors) | QUALITY／一般動態延伸 | `ComfyUI/models/vae/` | 4.85 |
| [`minimax_h3_turbo_v4_step600_ema.safetensors`](https://huggingface.co/larryvrh/MiniMax-H3-Turbo-Lora/resolve/43a74557ac3f6539db8e0f2a959d03feb7a81480/minimax_h3_turbo_v4_step600_ema.safetensors) | 4步／6步／8步 Turbo | `ComfyUI/models/loras/` | 0.73 |

**來源差異：** Ref2VA 的 W4A8 mixed 模型來自 Kijai，不是 Comfy-Org 的 Ref2VA INT8 模型。本指南的 INT8 Video VAE 也使用 Kijai 的 2.95 GiB 版本；Comfy-Org 有同名但不同內容的檔案，請使用上表指定連結與下方 SHA256。

### Singularity V2 pruned INT8（可選，2026-10-24 新增）

來源：[Singularity 模型作者](https://huggingface.co/WarmBloodAban/Minimax-h3_Singularity)、[LightX2V 模型／加速設定](https://github.com/ModelTC/Minimax-H3-Turbo)。以下連結固定到 2026-10-24 核對的 revision，兩項合計約 **21.35 GiB**。保留大小寫與完整檔名；LoRA 必須使用表中的 **ComfyUI 轉換版**。

| 本機檔名／直接下載 | 用途 | 放置目錄 | 大小 GiB |
|---|---|---|---:|
| [`Minimax-h3_Singularity_ref2va_v2_pruned_int8.safetensors`](https://huggingface.co/WarmBloodAban/Minimax-h3_Singularity/resolve/1259cf16cd0b655ba691a32fb46a409142762972/Minimax-h3_Singularity_ref2va_v2_pruned_int8.safetensors) | V2 pruned INT8 主模型，約 20.97 GB | `ComfyUI/models/diffusion_models/` | 19.53 |
| [`minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors`](https://huggingface.co/lightx2v/Minimax-h3-Turbo/resolve/30f485ed874aa44c8183348ad361c5eabad318da/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors) | V2 快速方案自動搭配的加速 LoRA | `ComfyUI/models/loras/` | 1.82 |

共用上方 H3 文字編碼器、影片 VAE 與聲音 VAE，不另下載一套。只做 Singularity 影片時不必為它載入原版主模型；原版生成、人臉精修與換角仍各自需要原有主模型。這個 V2 是 pruned INT8，不是約 34 GB 的完整 INT8，也不是 V1.3 W4A8。

下載後重新啟動 ComfyUI、重新整理 Studio，在「H3 模型」選 Singularity V2。操作、採樣配對與已測範圍見下方「Singularity V2 模型切換」。

### VOSR 2.0 1× 精修（可選，2026-10-24 新增）

來源：[VOSR 上游](https://github.com/cswry/VOSR)、[ComfyUI-VOSR2 節點](https://github.com/ylchen333/ComfyUI-VOSR2)。以下五個檔案固定到 `CSWRY/VOSR` revision `f24b3061b7f350b81e1907bdcfc27f71fb4ff3f3`。三套權重必須成組使用，不能把既有 H3 VAE 或 Qwen 圖像頁的 VAE 換進來。

| 下載檔名／直接下載 | 本機放置路徑（專案根目錄起算） | 大小 |
|---|---|---:|
| [`args.json`](https://huggingface.co/CSWRY/VOSR/resolve/f24b3061b7f350b81e1907bdcfc27f71fb4ff3f3/VOSR2/args.json) | `ComfyUI/models/vosr2/VOSR2/args.json` | 小型設定檔 |
| [`ema_model.safetensors`](https://huggingface.co/CSWRY/VOSR/resolve/f24b3061b7f350b81e1907bdcfc27f71fb4ff3f3/VOSR2/checkpoints/ema_model.safetensors) | `ComfyUI/models/vosr2/VOSR2/checkpoints/ema_model.safetensors` | 5.19 GiB |
| [`config.json`](https://huggingface.co/CSWRY/VOSR/resolve/f24b3061b7f350b81e1907bdcfc27f71fb4ff3f3/Qwen-Image-vae-2d/config.json) | `ComfyUI/models/vosr2/VOSR2/Qwen-Image-vae-2d/config.json` | 小型設定檔 |
| [`diffusion_pytorch_model.safetensors`](https://huggingface.co/CSWRY/VOSR/resolve/f24b3061b7f350b81e1907bdcfc27f71fb4ff3f3/Qwen-Image-vae-2d/diffusion_pytorch_model.safetensors) | `ComfyUI/models/vosr2/VOSR2/Qwen-Image-vae-2d/diffusion_pytorch_model.safetensors` | 0.17 GiB |
| [`dinov2_vitl14_pretrain.pth`](https://huggingface.co/CSWRY/VOSR/resolve/f24b3061b7f350b81e1907bdcfc27f71fb4ff3f3/torch_cache/checkpoints/dinov2_vitl14_pretrain.pth) | 先存為 `ComfyUI/models/vosr2/VOSR2/dinov2_vitl14_pretrain.pth`，再依下方轉換 | 1.13 GiB |

下載前建立目錄：

```powershell
New-Item -ItemType Directory -Force -Path .\ComfyUI\models\vosr2\VOSR2\checkpoints, .\ComfyUI\models\vosr2\VOSR2\Qwen-Image-vae-2d | Out-Null
```

DINOv2 上游是 `.pth`；Studio 檢查的是轉換後的 `dinov2_vitl14.safetensors`。下載並核對 SHA256 後，在專案根目錄執行：

```powershell
@'
from pathlib import Path
import torch
from safetensors.torch import save_file
bundle = Path("ComfyUI/models/vosr2/VOSR2")
state = torch.load(bundle / "dinov2_vitl14_pretrain.pth", map_location="cpu", weights_only=True, mmap=True)
save_file({key: value.contiguous() for key, value in state.items()}, str(bundle / "dinov2_vitl14.safetensors"))
'@ | .\.venv\Scripts\python.exe -
```

完整可用 bundle 約 **6.49 GiB**；保留原始 `.pth` 時另外占約 1.13 GiB。還需依步驟 15 安裝節點並重啟主 ComfyUI。**Studio 不會自動下載缺少的模型**，`/h3-studio/vosr/status` 必須回傳 `ready: true`；上游 ComfyUI 模型載入節點的自動下載功能與 Studio 的預檢不同。

### Qwen 圖像編輯（可選）

原版三項合計約 16.1 GiB。文字生圖、一般圖像編輯與攝影機視角需要一個圖像主模型、文字編碼器及 VAE；選用下方的微調模型時，只替換圖像主模型，文字編碼器及 VAE 沿用。

| 本機檔名／下載連結 | 用途 | 放置目錄（專案根目錄起算） | 大小 GiB |
|---|---|---|---:|
| [`qwen_image_2.1_int8_convrot.safetensors`](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/df94239739eef7205973a145ffa6f441f7b64e84/diffusion_models/qwen_image_2.1_int8_convrot.safetensors) | 圖像模型 | `ComfyUI/models/diffusion_models/` | 6.76 |
| [`qwen3vl_8b_int8_convrot.safetensors`](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/df94239739eef7205973a145ffa6f441f7b64e84/text_encoders/qwen3vl_8b_int8_convrot.safetensors) | 文字編碼器 | `ComfyUI/models/text_encoders/` | 8.71 |
| [`qwen_image_2.1_vae_bf16.safetensors`](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/df94239739eef7205973a145ffa6f441f7b64e84/vae/qwen_image_2.1_vae_bf16.safetensors) | 圖像 VAE | `ComfyUI/models/vae/` | 0.63 |

### Noct Q V4／REDQW21 UNLOCKED V2（可選，2026-10-11 新增）

兩款都是 Qwen-Image 2.1 的微調主模型，**不是 LoRA**，一次選一款。沿用上表的 `qwen3vl_8b_int8_convrot.safetensors` 與 `qwen_image_2.1_vae_bf16.safetensors`，放入 `ComfyUI/models/diffusion_models/`，在「圖像編輯 → 模型」選擇使用。模型權重不包含在本倉庫內。

| 模型 | Studio 使用的本機檔名 | 下載來源 | 大小 GiB |
|---|---|---|---:|
| Noct Q V4 INT8 ConvRot | `NoctQ_V4_int8_convrot.safetensors` | [作者說明](https://huggingface.co/Noctaluna/Noct-Q-Uncensored-Qwen-Image-2.1)／[下載 INT8 ConvRot](https://huggingface.co/Noctaluna/Noct-Q-Uncensored-Qwen-Image-2.1/resolve/main/NoctQ_V4_int8_convrot.safetensors) | 6.76 |
| REDQW21 UNLOCKED V2 INT8 | `REDQW21_V2_int8.safetensors` | [作者 V2 頁面](https://civitai.com/models/452459?modelVersionId=3370753)／[INT8 檔案，file ID 3258922](https://civitai.com/api/download/models/3370753?fileId=3258922) | 6.76 |

REDQW21 下載要求登入 Civitai。請選 V2 的 **INT8** 檔案（約 7.26 GB／6.76 GiB），不要誤選 FP8、V1 或付費工作流。上游下載檔名可能是 `redgptK2T2W6A8REDQW21_redqw21UNLOCKEDV2_int8.safetensors`；**下載後改名為 `REDQW21_V2_int8.safetensors`**。Studio 會在 V2 上傳參考圖及提交工作前檢查模型是否已安裝。

兩款均已在本機 ComfyUI v0.37.0／RTX 4080 Laptop 12 GB 上實際載入；V2 檔案已確認使用 INT8 ConvRot。Studio 沿用 Euler、simple、CFG 1、空白負面提示詞，步數預設 25；這是本機已驗證設定，不是作者效果的完整復現。Noct Q 作者另推薦 CFG 3 搭配負面提示詞；REDQW21 作者未公開完整採樣方案，其展示也包含額外後製工作流。

目前 Studio 最多接受 **4 張參考圖**；REDQW21 作者工作流所稱的 10 張上限不代表本介面已支援。編輯可選「依照 `<image1>`」或七種指定比例：指定比例先置中裁切第一張參考圖，再交給模型編輯，不做補景擴圖。第一張圖的手動裁切框會鎖定指定比例，可調整要保留的構圖；其他參考圖不會被這項設定裁切。輸出尺寸對齊 32 像素，比例可能有些微差異。作品保存模型與編輯比例，載回設定時會還原。

實測範圍與耗時見後面的效能章節；兩款的 2K、四圖參考與攝影機 LoRA 尚未實測。作者將這些衍生模型標示為研究／非商業用途，使用時仍須遵循各來源的授權。

### Qwen 攝影機視角（可選）

在 Qwen 三項之外，另下載以下 LoRA；目前介面強度建議 0.8。

| 本機檔名／下載連結 | 用途 | 放置目錄（專案根目錄起算） | 大小 GiB |
|---|---|---|---:|
| [`qwen_image_2.1_multiple_angles_v2_step1500.safetensors`](https://huggingface.co/akhaliq/Qwen-Image-2.1-Multiple-Angles-LoRA/resolve/0d91c4dfa22b3f5aa89c020eadc30d8f42cb51c0/checkpoints_v2/angles_v2_full_qwen21_multiple_angles_v2_qwen21_multiple_angles_v2_000001500.safetensors) | 視角 LoRA v2／step1500 | `ComfyUI/models/loras/` | 0.30 |

來源：[作者的 Multiple-Angles LoRA v2 說明](https://huggingface.co/akhaliq/Qwen-Image-2.1-Multiple-Angles-LoRA)。上游原檔位於 `checkpoints_v2/`，檔名為 `angles_v2_full_qwen21_multiple_angles_v2_qwen21_multiple_angles_v2_000001500.safetensors`。**下載後必須改成上表的本機檔名**；不要誤用 v1、step1000 或其他步數。

以下指令會建立目錄並直接以正確的本機檔名儲存；從專案根目錄執行：

```powershell
New-Item -ItemType Directory -Force -Path .\ComfyUI\models\loras | Out-Null
curl.exe -L --fail --retry 3 -C - "https://huggingface.co/akhaliq/Qwen-Image-2.1-Multiple-Angles-LoRA/resolve/0d91c4dfa22b3f5aa89c020eadc30d8f42cb51c0/checkpoints_v2/angles_v2_full_qwen21_multiple_angles_v2_qwen21_multiple_angles_v2_000001500.safetensors" -o ".\ComfyUI\models\loras\qwen_image_2.1_multiple_angles_v2_step1500.safetensors"
```

### 影片換角：BFS／Akatz V1.5（可選）

沿用 H3 的共用文字編碼器、INT8 影片 VAE、聲音 VAE 與 Ref2VA W4A8 主模型；不需另下載一套 H3。以下 LoRA 依換角模式選擇，放入 `ComfyUI/models/loras/`，保留表中的檔名。兩個 BFS LoRA 合計約 **0.87 GiB**；Akatz V1.5 另約 **0.145 GiB（155 MB）**，未計入前面的基本模型總量。只需安裝所選模式的權重。

| 本機檔名／下載連結 | 用途 | 大小 GiB |
|---|---|---:|
| [`minimax_h3_head_swap_v1.0_r32.safetensors`](https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI/resolve/e095edae3f4c69e18b4f27ed9e541078c87a8d98/loras/minimax_h3_head_swap_v1.0_r32.safetensors) | 換頭：臉部＋髮型 | 0.29 |
| [`minimax_h3_character_swap_v1.0_ref2va_r64_gl.safetensors`](https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI/resolve/e095edae3f4c69e18b4f27ed9e541078c87a8d98/loras/minimax_h3_character_swap_v1.0_ref2va_r64_gl.safetensors) | 整個角色替換：外貌、身形與服裝 | 0.58 |
| [`h3_character_swap_v1.5.safetensors`](https://huggingface.co/akatz-ai/MiniMax-H3-Character-Swap-LoRA/resolve/96ea3407b230b6f7df71c58c70e31df96bd7e533/h3_character_swap_v1.5.safetensors) | Akatz V1.5 整個角色替換：外貌、髮型、身形與服裝；20 步原生 | 0.145 |

SHA256：

```text
minimax_h3_head_swap_v1.0_r32.safetensors
ea97bd1a8178460661055784d63b4cb560732196fd15d5d7f33bfd214b65ab00

minimax_h3_character_swap_v1.0_ref2va_r64_gl.safetensors
643a3fe63646fee5aebb181a7e1c9f8a1feb5f472709f37e22eeec290cbb75e3

h3_character_swap_v1.5.safetensors
8f2c3c3eba161df8d0c6099598b4730f641f5ce01e04cd16d2427cff8a35218f
```

BFS 4／6／8 步還會使用前表的 `minimax_h3_turbo_v4_step600_ema.safetensors`；20 步使用原生採樣，不套用 Turbo。Akatz V1.5 目前只提供測試成功的 **20 步原生**流程，強度預設 **1.0**，來源影片接到 Ref2VA 參考影片輸入，不使用 BFS 的 Add Guide，也不套用 Turbo。Studio 會依模式自動選取換角 LoRA，不用再到「額外 LoRA」手動疊加。更新 Studio 程式後請重新啟動 ComfyUI、重新整理網頁，以載入更新的 `/h3-studio/swap/*` API。

下載 Akatz V1.5（在專案根目錄執行）：

```powershell
curl.exe -L --fail --retry 3 -C - "https://huggingface.co/akatz-ai/MiniMax-H3-Character-Swap-LoRA/resolve/96ea3407b230b6f7df71c58c70e31df96bd7e533/h3_character_swap_v1.5.safetensors" -o ".\ComfyUI\models\loras\h3_character_swap_v1.5.safetensors"
```

Akatz 版本、授權與作者設定見 [模型頁](https://huggingface.co/akatz-ai/MiniMax-H3-Character-Swap-LoRA)。Studio 使用本機已測的 W4A8／20 步／`res_multistep`／`simple` 配置；作者推薦的 INT8／另一款 8 步 Turbo／`er_sde`／`normal` 配置尚未在這台機器驗證。V1.5 是完整角色替換，沒有獨立的只換臉模式。

模型與範例來源：[BFS H3 模型倉庫](https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI)。模型權重不包含在 Git 倉庫內；使用時須同時遵循各資產授權及 H3 基礎模型條款。

### SeedVR2 影片畫質提升（可選）

兩項合計約 3.7 GiB，放在不同目錄。ComfyUI v0.37.0 已提供工作流所需的 SeedVR2 節點。

| 本機檔名／下載連結 | 用途 | 放置目錄（專案根目錄起算） | 大小 GiB |
|---|---|---|---:|
| [`seedvr2_3b_int8_convrot.safetensors`](https://huggingface.co/Comfy-Org/SeedVR2/resolve/df48879708206a403d2a61acd55578c2e80fd233/diffusion_models/seedvr2_3b_int8_convrot.safetensors) | 畫質提升模型 | `ComfyUI/models/diffusion_models/` | 3.22 |
| [`seedvr2_ema_vae_fp16.safetensors`](https://huggingface.co/Comfy-Org/SeedVR2/resolve/df48879708206a403d2a61acd55578c2e80fd233/vae/seedvr2_ema_vae_fp16.safetensors) | 畫質提升 VAE | `ComfyUI/models/vae/` | 0.47 |

AI 強度大於 0% 才需要這兩個模型。0% 使用 FFmpeg 普通放大，仍需要 FFmpeg／ffprobe。每次最多處理約 15 秒，建議先以 3 秒片段驗證；保留原比例、幀率與聲音，另存新作品，不支援再以 H3 動態延伸。強度混合可以重用已生成的 AI 快取。

### Drama3 本機語音（可選，2026-10-17 新增）

使用與 H3 **不同的 ComfyUI 與 Python 環境**。**先完成步驟 12 的環境 clone，再回來下載**；不要先在尚未 clone 的 `services/Drama3/ComfyUI` 建立模型目錄，否則 Git 會因目的地非空而拒絕 clone。以下是 Studio 程式目前指定的三個檔名；上游還有 FP8、INT8、W6A8 與 1.7B ASR，不能只換檔名就視為相同版本。下載連結固定到 2026-10-17 核對的 Hugging Face revision。

| 本機檔名／下載連結 | 用途 | 放置目錄（專案根目錄起算） | 大小 |
|---|---|---|---:|
| [`drama3_w4a8experts_bf16.safetensors`](https://huggingface.co/PedroMarinhoDev/Drama-3-ComfyUI/resolve/681e2fae64af1f12e64b9c19c82930a5f3bba1a4/drama3_w4a8experts_bf16.safetensors) | Drama3 文字轉語音 | `services/Drama3/ComfyUI/models/diffusion_models/` | 24.60 GB／22.91 GiB |
| [`drama3_codec.safetensors`](https://huggingface.co/PedroMarinhoDev/Drama-3-ComfyUI/resolve/681e2fae64af1f12e64b9c19c82930a5f3bba1a4/drama3_codec.safetensors) | 聲線編碼與音訊解碼 | `services/Drama3/ComfyUI/models/vae/` | 1.57 GB／1.46 GiB |
| [`qwen3_asr_0.6b_bf16.safetensors`](https://huggingface.co/PedroMarinhoDev/Qwen3-ASR-ComfyUI/resolve/6ad8c9be026925839479a8d97749068a4202fbe9/qwen3_asr_0.6b_bf16.safetensors) | 參考音訊逐字稿辨識 | `services/Drama3/ComfyUI/models/asr/` | 1.56 GB／1.46 GiB |

前兩項是配音／試聽所需；第三項只在按「辨識逐字稿」時使用，手動輸入正確逐字稿可省略 ASR。不要放進主 H3 的 `ComfyUI/models/`。下載來源：[Drama3 轉換模型倉庫](https://huggingface.co/PedroMarinhoDev/Drama-3-ComfyUI)、[Qwen3-ASR 轉換模型倉庫](https://huggingface.co/PedroMarinhoDev/Qwen3-ASR-ComfyUI)。

SHA256（依上游檔案資訊）：

```text
drama3_w4a8experts_bf16.safetensors
18fea6b8194f03c639098c93db5e4fc886e190e6b08e6eb69f9501f9703d7274

drama3_codec.safetensors
4fecf102907a48414230da9a74d72d07c3a92368eab53fab655797837bddf5ae

qwen3_asr_0.6b_bf16.safetensors
eb350ce7510a538eb136d8320db470a0761713c47de6e12b0fca090d4fc15ecf
```

例如下載主模型（codec／ASR 可從表格連結下載到各自目錄）：

```powershell
New-Item -ItemType Directory -Force -Path .\services\Drama3\ComfyUI\models\diffusion_models, .\services\Drama3\ComfyUI\models\vae, .\services\Drama3\ComfyUI\models\asr | Out-Null
curl.exe -L --fail --retry 3 -C - "https://huggingface.co/PedroMarinhoDev/Drama-3-ComfyUI/resolve/681e2fae64af1f12e64b9c19c82930a5f3bba1a4/drama3_w4a8experts_bf16.safetensors" -o ".\services\Drama3\ComfyUI\models\diffusion_models\drama3_w4a8experts_bf16.safetensors"
Get-FileHash .\services\Drama3\ComfyUI\models\diffusion_models\drama3_w4a8experts_bf16.safetensors -Algorithm SHA256
```

### 檔案驗證

不要只以檔案存在判定下載成功；中斷下載、HTML 錯誤頁或 Git LFS pointer 都不是真正的模型。先檢查大小，再以 SHA256 比對指定來源。

```powershell
Get-ChildItem ".\ComfyUI\models" -Recurse -Filter *.safetensors | Select-Object Name, @{n='GiB';e={[math]::Round($_.Length/1GB,2)}}
Get-FileHash ".\ComfyUI\models\loras\qwen_image_2.1_multiple_angles_v2_step1500.safetensors" -Algorithm SHA256
```

<details>
<summary>展開：上表下載檔案的 SHA256</summary>

| 本機檔名 | SHA256 |
|---|---|
| `Minimax-h3_Singularity_ref2va_v2_pruned_int8.safetensors` | `d7637c2c35cd30facd9e93778c491f6d82f91c4a441aecbdb4c384a62a5f3d9f` |
| `minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors` | `5b9ab5ade15d0775676d01a907268a69a1468dc6033b3b0d3ded5502f3ebb84c` |
| VOSR2 `ema_model.safetensors` | `bdcaa81e4c675b6074de643e27daafe73eb8125d4d0264d1bf30a004e9644b71` |
| VOSR2 `Qwen-Image-vae-2d/diffusion_pytorch_model.safetensors` | `1dd2c67f3f29734d48709513ed181d4f351966d76ba95f77a5cff8e1daf547fa` |
| VOSR2 原始 `dinov2_vitl14_pretrain.pth` | `d5383ea8f4877b2472eb973e0fd72d557c7da5d3611bd527ceeb1d7162cbf428` |
| `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | `35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6` |
| `minimax_h3_video_vae_int8_convrot.safetensors` | `9bb2d96f218c76babd85e0611b85ca8fb330a90546c01a0005e8a58a59593410` |
| `minimax_h3_audio_vae_fp32.safetensors` | `8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48` |
| `minimax_h3_fl2va_pruned_int8_convrot.safetensors` | `e889202c41dafb67b10d67b97f0d8541508036a6090af23425a5c2615d03c47a` |
| `minimax_h3_ref2va_pruned_w4a8_mixed.safetensors` | `de2c6c29c4ee702b45e48e40daae3834aeee58ab681c732d9152589a87c89910` |
| `minimax_h3_video_vae_fp16.safetensors` | `7c1f131492e7eddacaac9069a61b81bdd39de5cc96561e677c5eab1cdce5e522` |
| `minimax_h3_turbo_v4_step600_ema.safetensors` | `5f3a626cd72c93a8b9318d6760c510bc5092d2ab13aaba1f932c5bab07a416d3` |
| `qwen_image_2.1_int8_convrot.safetensors` | `cb74113cb03faecd79611b01fd7fd642f0aa60d6f0b95086abee214d75eaa57d` |
| `NoctQ_V4_int8_convrot.safetensors` | `4d92d5538253ab36e6a73b056cce5f697950f4303cb9e6686a3198d0ea13f9e8` |
| `REDQW21_V2_int8.safetensors` | `30532b445eabd4b84b108168b6b3fe720535ef400f6bf9d68bd551817d3531a3` |
| `qwen3vl_8b_int8_convrot.safetensors` | `8bfd0f6e12abf2d2d697ecc888e5e90b0d6741d6708f05799f53afa560452e8f` |
| `qwen_image_2.1_vae_bf16.safetensors` | `bb21f7473051e1ac368515dd3f2e15cd44d7a11748ee8823e1ddca3e4876b7c9` |
| `qwen_image_2.1_multiple_angles_v2_step1500.safetensors` | `548c57977c3f1c09c2c9e5f4e83e930cbc6f719c878a576ab8666ce29fef39b6` |
| `seedvr2_3b_int8_convrot.safetensors` | `c3dec8bcc5916843a8a858572970597462e1f2dc598d6dfd818f6cd40f53a157` |
| `seedvr2_ema_vae_fp16.safetensors` | `20678548f420d98d26f11442d3528f8b8c94e57ee046ef93dbb7633da8612ca1` |

</details>

校驗值取自以上指定來源的上游檔案資訊；攝影機 LoRA、Noct Q V4 與 REDQW21 V2 的校驗值另已與本機檔案比對一致。Noct Q 下載連結使用 `main`，請以上表 SHA256 確認版本。模型下載與功能實測是兩個不同檢查，還需要後面的安裝驗證。

## 步驟 8：安裝 FFmpeg

影片合併與時長偵測需要 `ffmpeg` 與 `ffprobe`，兩者都要能從 PATH 呼叫。

```powershell
winget install Gyan.FFmpeg
```

驗證（**需要重開終端機**）：

```powershell
ffmpeg -version; ffprobe -version
```

實測版本為 8.1。

## 步驟 9：安裝 Studio 介面

建議使用本機版本 **Node.js 24.15.0**，或相容的 24.x LTS。若使用 Node 22，需 **22.18.0 以上**；目前測試直接匯入 `.ts`，22.13.0 並不預設啟用所需的 TypeScript type stripping。[Node 官方版本說明](https://nodejs.org/en/blog/release/v22.18.0)。`package.json` 的 engine 下限仍為 22.13.0，請以這裡較嚴格的安裝／測試需求為準。

```powershell
cd h3-local-studio
npm ci
cd ..
```

驗證：

```powershell
cd h3-local-studio; npm test; cd ..
```

2026-10-17 本次文件核對重新執行 `npm test`：**建置通過，42 項測試中 39 通過、3 失敗**，失敗都在 `tests/rendered-html.test.mjs`：

- `keeps Motion Context continuation wiring intact`：仍要求舊的固定「12 秒」降溫文案；目前介面使用可調秒數與動態估算。
- `crops reference and keyframe images without altering the chosen file`：仍要求 Qwen 一律自由裁切的舊寫法，未包含現在第一張參考圖依指定編輯比例裁切的分支。
- `reuses an exact seed and reports the seed of finished videos`：只接受舊的 `reuseSeed(value: number)`，未接受目前增加的可選 `source` 參數。

這三項是原始碼文字斷言與目前程式不一致，不能據此直接判定生成、裁切或種子功能故障；但失敗後的同一測試其餘斷言未執行，不能宣稱整套驗證通過。本次只補文件，未修改測試或功能程式。

新安裝先用 `npm run build` 確認介面能建置，再按「安裝完成後的驗證」逐項測試。測試失敗不代表應改回舊模式或舊版 ComfyUI。

## 步驟 10：Prompt 優化引擎（可選）

H3「官方 H3 Prompt 優化」可選 Codex 或 Grok；Qwen「優化提示詞」固定使用 Codex。兩種優化都會提供提示詞及所選圖片給外部 CLI 服務。不安裝 CLI 仍可手動撰寫提示詞並生成，只是優化按鈕無法使用。

只用 H3 Prompt 優化時，裝其中一個引擎即可；要使用 Qwen 提示詞優化，必須安裝並登入 Codex。H3 引擎可在介面切換。

### Codex CLI

```powershell
npm install -g @openai/codex
codex login
```

需要有額度的 ChatGPT 帳號。

### Grok Build CLI

```powershell
npm install -g @xai-official/grok
grok login --oauth
```

需要能使用 Grok Build CLI 的帳號與可用額度。方案及免費額度可能改變，依當前 CLI／帳號顯示為準；文件不保證固定的免費呼叫次數。

驗證：

```powershell
codex --version
grok models
```

### `h3-prompt-writing` skill（兩個引擎都需要）

H3 Prompt 優化功能依賴一個名為 `h3-prompt-writing` 的 skill，內容是 MiniMax 官方的 prompt 撰寫格式指南。

**這個 skill 不包含在本倉庫內。** 這裡只提供取得與重建說明，不會安裝或附帶 skill。缺少它時，可以跳過 H3 優化，直接使用自己寫好的提示詞生成；Qwen 提示詞優化不依賴此 skill。

參考來源：

- [ComfyUI H3 Prompt 指南與官方資源入口](https://docs.comfy.org/tutorials/video/minimax/minimax-h3-prompt-guide)
- [MiniMax 基礎模式指南（T2VA／I2VA／FL2VA／L2VA）](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md)
- [MiniMax Full-reference 指南（Ref2VA）](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md)

如果已有自己的 `h3-prompt-writing`，可使用原版本。要讓另一個 agent 協助重建，請讓它讀取上述來源，建立下方目錄，並讓 `SKILL.md` 指示：依輸入模式讀取相對應的參考檔、遵守官方輸出結構、保留使用者台詞及圖片標籤。`base-en.txt`／`ref-en.txt` 是你本機 skill 的參考檔命名；它們不是此 repo 附帶的檔案。

#### 必要的目錄結構

```text
h3-prompt-writing/
├─ SKILL.md              # YAML frontmatter 需包含 name 與 description
└─ references/
   ├─ base-en.txt        # T2VA / I2VA / FL2VA / L2VA 的格式指南
   └─ ref-en.txt         # Ref2VA 的六段式格式指南
```

`SKILL.md` 的內容要能指引模型：判斷輸入模式後，讀取對應的 reference 檔案，並依其格式輸出。Codex 與 Grok 使用同一種 skill 格式，同一份檔案兩邊都能用。

#### 放置位置

- **Codex**：`%USERPROFILE%\.codex\skills\h3-prompt-writing\`
- **Grok**：`%USERPROFILE%\.grok\skills\h3-prompt-writing\`

兩個引擎都要用時不必放兩份。放在其中一處，再於 `%USERPROFILE%\.grok\config.toml` 加上指向設定：

```toml
[skills]
paths = ["~/.codex/skills/h3-prompt-writing"]
```

Grok 預設會掃描 `~/.grok/skills/`、`~/.claude/skills/` 與 `~/.cursor/skills/`，但**不會**掃描 `~/.codex/skills/`。走 Codex 目錄時一定要加這段設定。

驗證 Grok 有讀到：

```powershell
grok inspect
```

`Skills` 一節應列出 `h3-prompt-writing`。

#### 驗證 skill 是否能供 Studio 使用

H3 Studio 的 `h3_studio_api.py` 會指名 `$h3-prompt-writing`，並由 `validate_optimized_prompt()` 驗證輸出。安裝 agent 應搜尋這些函式名稱定位，避免依賴容易過時的行號。

- T2VA／I2VA／FL2VA／L2VA：輸出包含 `integrated_multimodal_description:`、`overall_soundscape:`、`non_diegetic_music:`，順序需一致；圖片模式另需官方圖片對齊開頭。
- Ref2VA：輸出包含 `subject_definitions:`、`summary:`、`retention_analysis:`、`detailed_description:`、`overall_soundscape:`、`non_diegetic_music:`，順序需一致。

先確認 CLI 能讀到本機 skill，再在 Studio 用短描述試一次 H3 優化。不符合結構時，依官方指南修正自己的 skill／輸出；**不要為了安裝而放寬程式驗證器或改動模型要求的欄位**。若一定要使用不同 skill 名稱，需另行修改程式中的指名文字，這已超出一般安裝流程。

## 步驟 11：Gemini TTS 金鑰（可選）

只有「語音生成」頁會用到。不設定的話其他功能都正常，語音生成頁會顯示「尚未設定 API 金鑰」並停用生成按鈕。

1. 到 Google AI Studio 建立 API 金鑰：<https://aistudio.google.com/apikey>。語音生成依 Gemini API 用量計費。
2. 設成 Windows **使用者**環境變數 `GEMINI_TTS_API_KEY`：

   ```powershell
   [Environment]::SetEnvironmentVariable("GEMINI_TTS_API_KEY", "<你的金鑰>", "User")
   ```

3. **重新啟動 ComfyUI**。金鑰由 ComfyUI 在執行時讀取，已經在跑的 ComfyUI 看不到新設定的變數。先執行 `stop_h3_studio.bat`，再從新開的終端機或檔案總管執行 `start_h3_studio.bat`。

金鑰只存在環境變數，不會寫進倉庫、設定檔或送到瀏覽器；介面只會拿到「有沒有設定」。

驗證：開啟介面的「語音生成」頁，上方應顯示「API 金鑰已設定」。

---

## 步驟 12：Drama3 獨立環境（可選）

Drama3 使用 `services/Drama3/.venv` 與 `services/Drama3/ComfyUI`，埠為 **8190**；主 H3 仍使用根目錄 `.venv`、`ComfyUI` 與 8188。不要為了 Drama3 直接升級或覆寫主 H3 環境。

### 新安裝

先完成主 H3 的 Python、FFmpeg 與 Studio 整合設定。以下從專案根目錄執行，建立獨立環境；目錄已存在時不要覆蓋，改依下一節處理既有安裝。

```powershell
New-Item -ItemType Directory -Force -Path .\services\Drama3 | Out-Null
.\.venv\Scripts\python.exe -m venv .\services\Drama3\.venv
.\services\Drama3\.venv\Scripts\python.exe -m pip install --upgrade pip
.\services\Drama3\.venv\Scripts\python.exe -m pip install torch==2.10.0 torchvision==0.25.0 torchaudio==2.10.0 --index-url https://download.pytorch.org/whl/cu130
git clone https://github.com/comfyanonymous/ComfyUI.git services/Drama3/ComfyUI
git -C services/Drama3/ComfyUI checkout 3541246a9c997f4b8c32f9f88f3c985d02021c79
.\services\Drama3\.venv\Scripts\python.exe -m pip install -r .\services\Drama3\ComfyUI\requirements.txt
git clone https://github.com/PedroMarinhoDev/ComfyUI-Drama3.git services/Drama3/ComfyUI/custom_nodes/ComfyUI-Drama3
git -C services/Drama3/ComfyUI/custom_nodes/ComfyUI-Drama3 checkout 66c4fb9cd3c0151e1e2ccd207847cb8335e87ab4
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\install_drama3_studio.ps1
.\services\Drama3\.venv\Scripts\python.exe -m pip check
```

這是本機使用的 ComfyUI **v0.40.0** 與 Drama3 節點 commit；其 requirements 包含 `comfy-kitchen==0.2.37` 與 `comfy-aimdo==0.5.6`。主 H3 安裝指南仍固定 v0.37.0。Drama3 節點不另附需安裝的 requirements，沿用獨立 ComfyUI 環境。以上新安裝步驟依現有環境整理，尚未在乾淨電腦完成全流程重裝。

`install_drama3_studio.ps1` **只建立 Studio 轉接節點的 junction**，不會替你安裝 Python、ComfyUI 或下載模型。完成後，依步驟 7 的 Drama3 表格下載模型，並重新啟動主 H3 ComfyUI，讓它載入新增的語音 API。

### 已有其他位置的 Drama3 安裝

可選擇複製既有完整環境，與上面的新安裝擇一；目的地 `services/Drama3` 必須尚不存在：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\migrate_drama3.ps1 -Source "D:\ExistingDrama3"
.\.venv\Scripts\python.exe .\tools\verify_drama3_copy.py "D:\ExistingDrama3"
```

來源目錄須包含 `ComfyUI/main.py` 與 `.venv/Lib/site-packages/torch`。遷移採複製，保留原安裝，重建本專案 venv 的命令入口，再連結 Studio 節點。驗證工具比對套件版本、模型／input／output／user 的檔案與 SHA256、原生 DLL／PYD，並寫入 `services/Drama3/migration-integrity.json`；大型模型校驗需要時間。請在目的地新增聲線或作品之前驗證，否則新增檔案也會造成清單不一致。

### 啟停與驗證

Studio 的 Drama3 工作會自動啟動 8190，完成、失敗或取消後嘗試關閉該服務，等待程序退出才結束佇列任務。聲線清單在待命時仍可讀取；既有 FLAC 由主 H3 後端提供，不需讓 Drama3 常駐。手動除錯可用：

```powershell
.\start_drama3.bat
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\drama3_service.ps1 -Action Status
Invoke-RestMethod 'http://127.0.0.1:8190/drama3-studio/runtime'
.\stop_drama3.bat
Invoke-RestMethod 'http://127.0.0.1:8188/h3-studio/drama3/status'
```

手動啟動後 runtime 的 `comfyRoot` 應指向本專案的 `services/Drama3/ComfyUI`；停止後 8190 無回應是正常情況，主 H3 的語音 status 應為 `ready: true`、`standby: true`。不要讓別套 ComfyUI 占用 8190。停止腳本遇到仍在生成／排隊的工作會拒絕停止；先在 Studio 按停止，等清理完成。

日誌位於 `services/Drama3/run/server-8190.stdout.log` 與 `server-8190.stderr.log`。目前啟動參數包含 `--disable-pinned-memory`，生成使用 experts in RAM、2 GiB expert GPU 快取；這是現行配置，並非效能最佳化結論。

## 步驟 13：RTX 提升套件（可選）

RTX 提升使用 **主 H3 的 `.venv`**，不裝進 Drama3 環境。需要 FFmpeg／ffprobe、NVIDIA CUDA GPU 與相容驅動；Studio 的補幀操作另外檢查 GPU compute capability 至少 8.9（RTX 40 系列或更新）。

```powershell
.\.venv\Scripts\python.exe -m pip install nvidia-vfx==0.2.0.0 --extra-index-url https://pypi.nvidia.com
.\.venv\Scripts\python.exe -c "import nvvfx; print(nvvfx.__version__); print(nvvfx.get_sdk_version()); print(nvvfx.VideoSuperRes, nvvfx.VideoFrameGeneration)"
.\.venv\Scripts\python.exe -m pip check
```

套件下載來源：[NVIDIA 套件索引](https://pypi.nvidia.com/nvidia-vfx/)、[0.2.0.0 套件說明](https://pypi.org/project/nvidia-vfx/0.2.0.0/)、[NVIDIA Python API 文件](https://docs.nvidia.com/maxine/vfx-python/latest/index.html)。本機使用 `nvidia-vfx 0.2.0.0`，對應 VFX SDK 1.3.0.0；Windows 執行庫隨 wheel 放在 `.venv/Lib/site-packages/nvvfx/libs/`。**不需另下載 SeedVR2 或把 RTX 權重放進 `ComfyUI/models/`。** Import 成功只驗證安裝，仍需短片實測效果。

安裝與更新 Studio 後重新啟動主 ComfyUI，以載入 `H3StudioRTX` 節點與 `/h3-studio/rtx/*` API；用法見下方「RTX 提升」。

---

## 步驟 14：人臉精修（可選）

先停止主 H3 ComfyUI（8188），再於專案根目錄執行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\install_h3_face.ps1
```

安裝器使用主專案的 `.venv`，安裝／檢查以下項目；若 8188 仍在監聽會拒絕執行。完成後重啟 ComfyUI、重新整理 Studio。

| 項目 | 安裝內容／位置 |
|---|---|
| FaceRefine 節點 | `ComfyUI/custom_nodes/ComfyUI-H3-FaceRefine/`，固定 commit `d8521d14fe0d721d80cd9417fff5a559cbc21aba` |
| NativeAudioLock 節點 | `ComfyUI/custom_nodes/ComfyUI-H3-NativeAudioLock/`，來源固定 commit `84895cfaaef39abb42fb844b02cb42f868c7bebf` |
| 偵測與切鏡相依套件 | 包含 Ultralytics、PySceneDetect 與 OpenCV；版本依 `tools/install_h3_face.ps1` |
| 人臉偵測器 | `ComfyUI/models/ultralytics/bbox/face_yolov8m.pt`，安裝器下載並核對 SHA256 |

安裝器會以 `opencv-python==5.0.0.93` 取代 `opencv-python-headless`，兩者共用 `cv2`，不要同時保留。現有 FaceRefine 若不是指定 commit，安裝器會停止，須先檢查版本差異。此流程使用規則／逐鏡頭選臉與追蹤，不需 InsightFace。

H3 模型仍須依步驟 7 另行下載：尤其是 `minimax_h3_video_vae_fp16.safetensors`，不能只裝一般快速影片使用的 INT8 VAE；另需 `minimax_h3_ref2va_pruned_w4a8_mixed.safetensors`、共用文字編碼器與聲音 VAE。快速 8 步還需 `minimax_h3_turbo_v4_step600_ema.safetensors`。精修不需要 BFS 或 Akatz 換角 LoRA。

服務啟動後，可讀取模式所需節點、套件與模型的就緒狀態：

```powershell
Invoke-RestMethod 'http://127.0.0.1:8188/h3-studio/face/status'
Invoke-RestMethod 'http://127.0.0.1:8188/h3-studio/face/status?mode=turbo-8&select=all_faces'
```

`ready: true` 只表示依賴已就緒，不能代替實際精修成片的效果驗證。操作見下方「人臉精修、自動精修與多人處理」。

---

## 步驟 15：VOSR 精修節點（可選）

VOSR 使用主專案 `.venv`；工作執行時啟動獨立 Python 程序，完成或中斷後退出，不另建立一套 ComfyUI。從專案根目錄安裝本機已驗證版本：

```powershell
git clone https://github.com/ylchen333/ComfyUI-VOSR2.git ComfyUI/custom_nodes/ComfyUI-VOSR2
git -C ComfyUI/custom_nodes/ComfyUI-VOSR2 checkout 6a21810b3f4f1a0ffc477c55330db0ac03c671f0
.\.venv\Scripts\python.exe -m pip install -r ComfyUI/custom_nodes/ComfyUI-VOSR2/requirements.txt
```

若資料夾已存在，先核對現有版本，不要重複 clone。節點使用現有 PyTorch、einops、safetensors 與 huggingface_hub；本機接入時沒有升級 PyTorch。依步驟 7 放齊五個下載檔及轉換後的 DINOv2 safetensors，確認 FFmpeg／FFprobe 可執行，再重啟主 ComfyUI 並重新整理 Studio：

```powershell
Invoke-RestMethod 'http://127.0.0.1:8188/h3-studio/vosr/status'
```

應為 `ready: true`、`missing: []`；缺檔會列出路徑。這是安裝預檢，仍須以短片測試輸出與畫面效果。使用方式見下方「VOSR 1× 精修」。

---

# 啟動與停止

啟動（會一併帶起 ComfyUI 與介面，並開啟瀏覽器）：

```powershell
.\start_h3_studio.bat
```

介面在 `http://localhost:3000`，ComfyUI API 在 `http://127.0.0.1:8188`。

Drama3 不隨 Studio 啟動常駐；使用本機語音工作時才自動啟動 8190，工作結束後退出。第一次使用的服務啟動與模型準備時間也算等待時間。

停止 Studio 與 H3（也會先嘗試停止本專案的 Drama3；Drama3 有工作時會拒絕繼續關閉）：

```powershell
.\stop_h3_studio.bat
```

只開 ComfyUI 不開介面，也不自動開啟瀏覽器（8188 已被占用時不重複啟動）：

```powershell
.\start_comfyui_h3.bat
```

只停止本專案的 ComfyUI，保留 Studio 前端：

```powershell
.\stop_comfyui_h3.bat
```

這兩支 ComfyUI 腳本都接受 `--no-pause`，供自動執行時避免等待按鍵。要重新載入 Studio 後端程式或釋放模型快取，可先停止再啟動 ComfyUI；正在生成或排隊的 ComfyUI 工作會隨停止中斷。

---

# 安裝完成後的驗證

依序執行，全部通過才算裝好。

**1. ComfyUI 有載入 Studio 節點**

啟動後在 ComfyUI 主控台輸出中尋找：

```text
0.0 seconds: ...\ComfyUI\custom_nodes\ComfyUI-H3-Studio
```

沒有這行代表步驟 6 的 junction 沒建好。

**2. 兩個冷卻節點有註冊**

```powershell
$i = Invoke-RestMethod 'http://127.0.0.1:8188/object_info'
'H3CooledSampler','H3CooledTurboSampler' | ForEach-Object {
  "$_ : " + ($i.PSObject.Properties.Name -contains $_)
}
```

兩個都要是 `True`。

**3. API 路由有回應**

```powershell
Invoke-RestMethod 'http://127.0.0.1:8188/h3-studio/outputs'
```

應回傳 JSON，全新安裝時 `outputs` 是空陣列。

**4. 介面可開啟**

瀏覽器打開 `http://localhost:3000`，右上角應顯示「本機 H3 已連線」。

**5. 實際生成一支影片**

在創作頁選「文字轉影片」，輸入短描述，模式選「6步」、解析度選「省顯存」、長度約 5 秒，按生成。首次載入模型較慢，降溫秒數也計入等待時間。驗證成品可播放、作品中可下載，並保存 seed 等設定。

**6. 依已安裝的可選功能驗證**

- Ref2VA：加入參考圖及不同的 `@標籤`，用短片驗證 4步／6步／8步。有首幀圖時，畫面比例與解析度估算依首幀計算；尺寸需取模型支援的 32 倍數，因此比例可能有些微取整差異。移除首幀後恢復手動比例。
- Qwen：先不加圖片，用短描述生成一張；再上傳一張圖驗證編輯。
- 攝影機視角：開啟選項，只保留一張原圖，選方位、角度與景別，強度先用 0.8；確認 v2 LoRA 已列在 ComfyUI 的 LoRA 清單。
- 畫質提升：從作品選一段約 3 秒影片，用 50% 強度驗證 720p 成品可播放、聲音與幀率有保留。
- Gemini 語音：切換到 Gemini 引擎，依步驟 11 設定金鑰後生成短句；未設定時停用按鈕是正常狀態。
- Drama3 語音：依步驟 12 安裝，先建立／選擇聲線，再用一句台詞生成；確認 FLAC 可下載、設定可讀回，以及完成後 8190 程序退出。試聽只解碼參考聲音，不能代替文字生成測試。
- RTX 提升：依步驟 13 安裝套件，以短片分別驗證 2 倍補幀與 2 倍超解析，檢查幀率／尺寸、時長、聲音及另存作品。
- 人臉精修：依步驟 14 安裝，先以約 2～3 秒、24 fps 的作品，從「影片操作 → 人臉精修」預覽選臉並測試；確認原片仍在、精修另存，以及尺寸、幀率與原音軌有保留。自動精修及多人模式應分別驗證，單人成功不代表多人追蹤已正確。

模型存在、API 已連線與 build 成功都不能代替這些實際功能驗證。

---

# 生成佇列與模式

H3 影片（含 BFS 換角）、Qwen 圖片、RTX 提升、VOSR 精修與 Drama3 工作共用佇列：可編輯時按「加入佇列」會保存當下設定，等待任務可移除；失敗保留錯誤並繼續下一筆。Qwen 多張生成是一整筆任務，H3 會等必要轉檔、合併與設定保存流程結束後才接下一筆；Drama3 的生成、聲線試聽、辨識與保存聲線都會排隊，執行時鎖定其設定，關閉服務也屬於該筆工作。完成後留在目前頁面，作品可到「作品」頁查看。

**佇列保存在目前瀏覽器頁面，不會持久保存。** 重新整理或關閉網頁會失去尚未執行的等待任務；已送到 ComfyUI 的 GPU 工作可能繼續，但瀏覽器負責的後處理／metadata 保存可能中斷。請等整筆完成再關閉頁面。ComfyUI 重啟也不提供任務續跑保證。

人臉精修也使用這個佇列：手動精修是一筆工作，多人逐組修復在同筆工作內依序執行；生成後自動精修則與原始影片生成共用一筆工作，完成精修或回報失敗後才輪到下一筆。

右側顯示類型標籤與前約 10 字摘要，移上或點選任務摘要可查看詳情與進度／錯誤。寬視窗使用右側清單，較窄視窗以「佇列」按鈕開啟浮動清單，可按「收合」或 Escape 關閉，不擠壓主編輯區。H3「生成圖片」、SeedVR2 畫質提升與 Gemini TTS 不屬於這個共用佇列。

| H3 模式 | 目前行為 |
|---|---|
| 原版 H3 4步／6步／8步 | 相同 Turbo 模型與採樣方式，差別是步數；每步都依介面秒數降溫，包含最後一步 |
| QUALITY | 原生 20 步、FP16 影片 VAE，每步降溫 |
| 安全長片 | Turbo 6 步、LoRA merge、低解析生成與分塊解碼，再以 CPU 放大成 480P；不支援 H3 動態延伸 |

參考生影片提供 4步／6步／8步，使用 Ref2VA W4A8／LongMedia 流程。COOLED FAST 與低顯存已從新任務選單移除，但仍保留舊作品設定的讀取相容性。H3 降溫預設 15 秒、最低 5 秒；Qwen 預設 0 秒，可自行增加，且跳過最後一步後的暫停。

## Singularity V2 模型切換

在「文生影片」「首尾圖生影片」「參考生影片」的設定中，選擇「H3 模型 → Singularity V2 · INT8」。切換時預設為 **4步 · 作者推薦**，不是額外疊加一個風格 LoRA。

| 項目 | 原版 H3 | Singularity V2 |
|---|---|---|
| 文字／首尾圖主模型 | 原版 FL2VA pruned INT8 | Singularity V2 pruned INT8 |
| 參考生影片主模型 | 原版 Ref2VA W4A8 mixed | 同一個 Singularity V2 pruned INT8 |
| 快速方案的加速 | Larry Turbo v4＋既有 Turbo 採樣器 | LightX2V Ref2VA 4-step ComfyUI LoRA，強度 1＋標準 Euler |
| V2 的排程偏移 | — | video 12／audio 3，`simple`；保留每步冷卻 |
| QUALITY | 原生 20 步，不加 Turbo | 文字／首尾圖介面可選原生 20 步，不加 Turbo；V2 此方案尚未實跑 |

V2 的 **6步／8步標為實驗設定**：作者推薦的是四步蒸餾版本，增加步數不保證品質更好。自動加速 LoRA 不列入「額外 LoRA」選單，避免重複套用；也不會同時疊加 Larry 與 LightX2V。V2 不提供安全長片與舊低顯存方案。

參考模式可同時上傳選填首圖、尾圖與最多九張參考圖；首尾圖由 `AddGuide` 約束開頭／結尾，其他參考圖保留原有標籤用途。參考影片仍使用 LongMedia＋SageAttention，尚未開放 sol-attn。

模型選擇會隨加入佇列時保存至 `h3Model`，作品顯示所用模型，「再做一次」還原原選擇，延伸沿用來源模型；舊作品缺少欄位時依原版處理。延伸接線與資料還原有測試，但 V2 的實際影片延伸尚未完成生成驗證。

人臉精修與換角仍使用各自的原版 Ref2VA W4A8 模型；H3 單幀生圖、Qwen、SeedVR2 與 RTX 也不跟著這個影片模型選單切換。**V2 生成後自動修臉的完整組合尚未實跑**，不能把既有修臉測試當作此組合已通過。

2026-10-24 本機已實跑 V2 文生影片 4／6／8 步、首尾圖 4 步，以及參考圖＋首尾圖 4 步；範圍為 608×352、約五秒、有聲短片。32 GB RAM 下已觀察到明顯記憶體壓力，不代表高解析度、多參考或長片同樣可用。詳見後方效能紀錄。

## 影片注意力選擇

在創作頁「模式」旁的「**注意力（影片）**」選擇：

| 選項 | 行為與適用範圍 |
|---|---|
| SageAttention（原有） | 預設，沿用 H3 省顯存 SageAttention patch。舊作品未保存注意力欄位時也使用此選項 |
| sol-attn + Comfy Kitchen | 使用稀疏注意力，未啟用稀疏的步數或短序列使用 Comfy Kitchen INT8 一般注意力；可用於文字、首尾圖影片與一般影片延伸 |

切換注意力不會改變所選步數、模型、LoRA、解析度、片長、種子與每步降溫。方法會隨加入佇列時的設定保存，作品列表會顯示；「再做一次」與一般影片延伸會載回原方法，送出前仍可切換。更新此功能後須**重啟主 ComfyUI**，才能載入後端的注意力設定保存欄位。

新方法固定使用 `sol-attn`、`tau=1.3`、`start_percent=0.2`、`end_percent=1.0`、`min_tokens=12288`、`extra_tokens=256`、`sink_conditioning=exact_kv_and_rows`，不與原 SageAttention patch 疊加。需要本機 ComfyUI 提供 `BlockSparseAttention`、`ModelAttentionBackend` 及對應 GPU kernel；本機 RTX 4080 Laptop、comfy-kitchen 0.2.35 已確認可用。較短序列可能完全不進入稀疏運算，實際速度及畫面差異需依設定比較。

**參考生影片（包含 Ref2VA 延伸）暫不提供新方法。** 原因是 LongMedia 遇到已有的稀疏區塊補丁時會跳過原本的記憶體分塊處理；介面停用此選項並維持 SageAttention。H3「生成圖片」、Qwen 圖像、影片換角與人臉精修也維持各自原有注意力接法。

2026-10-19 本機單次對照：同一張人物首圖、prompt、種子，Turbo 8 步、480×640、24 fps、約 5 秒，每步降溫 15 秒。兩組原生皆輸出 124 幀（約 5.17 秒），Studio 保留模型原生長度，不為湊整秒額外裁切。

| 項目 | SageAttention | sol-attn＋Comfy Kitchen |
|---|---:|---:|
| ComfyUI 總耗時（含 120 秒冷卻） | 294 秒 | 254 秒 |
| 採樣階段扣除固定冷卻 | 134 秒 | 102 秒 |
| 整張顯卡使用量峰值（取樣觀察） | 11,462 MiB | 11,474 MiB |

此例新方法總耗時少約 14%，確認有實際進入稀疏運算；顯存沒有明顯下降。抽查兩組均完成放低手機、微笑與揮手，表情與構圖略有不同。這是單次結果，不代表所有片長、解析度、步數與 LoRA 都有相同加速或品質。

---

# 影片換角（BFS／Akatz V1.5）

創作頁的模式排列為「參考生影片 → **影片換角** → 影片畫質提升」。此功能共用 H3／Qwen 的生成佇列，不是一般參考圖生影片，也不是在首尾圖工作流直接掛上換角 LoRA。

| 替換範圍 | 參考圖提供的內容 | 目標保留的原片內容 |
|---|---|---|
| BFS 換頭 | 臉部、頭型與髮型 | 身體、服裝、動作、鏡頭與背景 |
| BFS 整個角色替換 | 人物外貌、髮型、身形、服裝與畫風 | 動作、鏡頭與場景，以及未指定替換的其他人物 |
| Akatz V1.5 整個角色替換 | 人物外貌、髮型、身形、服裝與畫風 | 動作、鏡頭與場景，以及未指定替換的其他人物 |

## 操作

1. 選「影片換角」，在「換角模式」選 BFS 換頭、BFS 整個角色替換或 Akatz V1.5 整個角色替換。
2. 點選或拖入來源影片：接受 MP4／MOV／WebM，上限 **1 GB**。介面會顯示原片尺寸、時長與預計段數。
3. 點選或拖入 PNG／JPEG／WebP 參考圖，上限 **32 MB**。換頭建議使用含完整髮型的頭部近照，可按「裁切」排除設定稿中的其他身形或服裝圖；裁切不會修改原始檔。
4. 多人影片可在「要替換的人物」填入位置或衣著描述。系統會帶入對應的預設提示詞，可自行修改；切換換角模式會重新套用該模式的預設。
5. BFS 步數可選 **4／6／8 步 Turbo** 或 **20 步原生**；Akatz V1.5 只提供 **20 步原生**，切換時會設為 20 步、強度 1.0。解析度與參考生影片相同，提供 **480P／540P／原生 H3**。初始預設為 BFS 換頭、20 步、480P、LoRA 強度 1.0；種子留白時隨機。
6. 畫面比例自動跟隨來源影片，不提供手動比例選單。H3 生成畫布需對齊 32 像素，輸出會補正播放比例；輸出幀率統一為 **24 fps**，並合回來源音軌，不沿用原片的任意幀率。
7. 按「加入生成佇列」。每步降溫預設 15 秒、最低 5 秒，最後一步不暫停。完成後可在本頁預覽、下載，也會加入「作品」頁；「再做一次」會載回來源、參考圖與生成設定。

BFS 來源影片透過 **Add Guide** 提供對齊的影片引導；Akatz V1.5 則接到 **Ref2VA 參考影片**輸入。兩者的角色圖都走 Ref2VA 圖片參考。15 秒以內整段一次生成；超過 15 秒則按約 15 秒分段，最後一段依剩餘時長生成。模型要求的補齊幀會在合併時裁除，正常完成後以原片時長為準。作品與佇列會顯示所選換角模式，「再做一次」會恢復對應模式。

生成中可按「**完成目前這段後停止**」：目前已提交的段落仍會完成，之後不再提交新段，已完成部分會合併並保留相應的原音軌。若後續段落失敗，也會嘗試保留先前完成的部分。若尚無完成片段，就不會產生成品。

## 限制與驗證範圍

- 換角會重新生成畫面，不能保證其他區域逐像素不變；小臉、遮擋、快速動作、切鏡與長片可能造成身分、表情或動作漂移。分段接縫處也可能出現人物或光線不連續。
- 已完成本機 BFS 換頭的原生 20 步與 Turbo 8 步短片生成；另於 2026-10-18 使用同一支 2.33 秒白模片段、角色圖、種子與 480×832 尺寸，完成 BFS 整個角色替換與 Akatz V1.5 的 20 步測試，皆有換上參考角色。兩者各用對應的影片接法與提示詞，不是只變更 LoRA 的模型排名測試；耗時分別約 332／335 秒。V1.5 直接套 BFS Add Guide／8 步配置的小樣未成功換角。全部解析度、長片、多人及 V1.5 只換臉尚未經過完整實測；12 GB 顯卡建議先選 480P 短片。
- 原音軌會合回成品，但不代表模型能精準保留口型同步。來源與角色圖只送往本機 ComfyUI。
- 佇列與分段後處理由目前網頁維持，請等整筆任務完成後再重新整理或關閉頁面。來源與參考圖快取若已刪除，「再做一次」需重新上傳。

---

# 人臉精修、自動精修與多人處理

人臉精修會追蹤並裁切人臉，以 H3 局部重繪後合回來源畫面，目標是改善模糊臉部並保留原表情、視線、頭部姿勢與時序。這和「影片換角」是不同功能；精修以臉部區域合成，不提供整個角色或服裝替換。先完成安裝步驟 14。

## 共用設定

| 設定 | 選項與行為 |
|---|---|
| 精修模式 | **原生 20 步**（預設）：原片有聲音時加入音訊約束；**快速 8 步**：使用 Turbo，不做音訊約束。兩者最後都合回原音軌，但不保證口型精準同步 |
| 修復人物 | 臉最大、最左側、最右側、最靠近中央，或「不只一名人物，逐人修復」；預設臉最大 |
| 身份參考圖 | 單人模式從原始參考圖／首尾圖選一張；手動精修可補充清晰人物圖片。多人模式改為自動擷取各人物的原片人臉 |
| 修復強度 | 介面提供 0.2／0.3／0.4，預設 0.4；強度越高可能改動越多，可先用 0.2～0.3 比較 |
| 種子與降溫 | 沿用來源作品的種子與每步降溫；缺少時使用種子 42、預設降溫 15 秒，最低 5 秒，最後一步不暫停 |

原生模式只在來源有音軌時使用音訊約束；快速模式會提示「不以原音訊約束嘴型」，說話鏡頭尤其需要檢查。精修會增加一次額外生成，8／20 步是精修階段本身的步數。

## 手動精修：從作品預覽選臉

1. 在「作品」或「最近作品」找到影片，展開「影片操作 → **人臉精修**」。來源須為約 **15 秒以內、24 fps** 的作品；先精修，再做 RTX 補幀。
2. 選精修模式、人物規則、身份參考圖與強度。原作品沒有可用的人物參考圖時，可上傳「補充清晰人物參考圖」。
3. 按「**偵測人臉並預覽**」。單人模式會列出各鏡頭的編號預覽；只有一張臉的鏡頭預選人臉 0，多張臉的鏡頭需手動指定，沒有目標的鏡頭選「略過此鏡頭」。至少選取一個鏡頭才能送出。
4. 按「**加入精修佇列**」。精修和 H3／Qwen 等工作共用佇列；等待中的精修可以移除，執行時可按「停止精修」。
5. 完成後原片保留，新增標示「人臉精修」的作品，記錄精修模式、步數、強度與來源。「再做一次」會開啟精修設定，重新偵測確認後再執行。

## 自動精修：生成後接續修臉

1. 在創作頁選「**首尾圖生影片**」或「**參考生影片**」，加入圖片與影片生成設定。
2. 勾選「**生成後自動人臉精修**」，選精修模式、修復人物、身份參考圖與強度。單人身份參考可選已加入的參考圖、首幀或尾幀。
3. 加入生成佇列後，同一筆工作依序執行「生成影片（1/2）→ 人臉精修（2/2）」，原片與其設定會先保存，再開始精修；完成整筆後才執行下一筆工作。
4. 精修階段可按「**停止人臉精修（保留原片）**」。精修失敗或中止時原片仍可從作品列表使用，後續可從「影片操作」改為手動精修。

此開關不提供給文字轉影片、影片延伸或「影片換角」頁。自動單人模式依各鏡頭首次出現時的人物規則選人，不會先停下來讓使用者逐鏡頭確認；多人交錯、目標人物不在每個鏡頭時，建議先生成，再從作品列表預覽選臉。

## 多人處理：依原片人物逐組修復

將「修復人物」設為「**不只一名人物，逐人修復**」，手動精修與自動精修都可使用。系統會偵測人臉軌跡，從原片各組人物擷取清晰人臉作為各自的身份參考，依序修復並接續上一組結果；這個模式不能替每個人物分別指定外部角色圖。

手動精修先按「偵測人臉並預覽」，確認列出的「鏡頭／人物組」與自動擷取人臉，再加入精修佇列。軌跡需至少有 3 幀偵測；沒有可追蹤人物時，會要求改用單人模式預覽選臉。軌跡不跨越切鏡，同一個人在不同鏡頭可能計為不同組，組數不等於全片獨立人物數。

每組各跑一次精修，耗時會隨組數增加。若停止或後續組失敗，已完成至少一組時會嘗試另存部分成品，錯誤訊息會列出檔名；作品記錄「已完成／總人物組數」。這不是斷點續跑，下次重新偵測與執行仍是新的任務。交錯、遮擋、快速移動或重新入鏡仍可能追錯／分成多組，不能視為跨鏡頭身份辨識。

## 輸出、限制與驗證

- 成品保留來源尺寸、24 fps、影格數與原音軌，另存於來源影片所在目錄的 `H3_Studio_Face_*.mp4`，旁邊保存 `.mp4.h3.json`；不覆蓋原片。來源為一般 Studio 影片時，通常位於 `ComfyUI/output/video/`。
- 偵測／設定與多人參考圖快取位於 `ComfyUI/input/h3_face/`，精修中間影片位於 `ComfyUI/output/h3_face_cache/`。重新開啟或再做一次仍需要來源作品與身份參考圖存在。
- 目前支援約 15 秒內的短片，**不會自動把長片分段精修**；非 24 fps 作品會拒絕處理，RTX 補幀後的影片應回到補幀前原片精修。精修成品不支援 H3 動態延伸，延伸請使用仍保留的原片。
- 小臉、嚴重模糊、側臉、遮擋與追蹤失敗可能無法改善；局部合成也可能改變表情、身份或膚色，不能保證臉外區域逐像素不變。建議先用短片比較原片與成品。
- 模型就緒、單元測試或介面測試成功不等於生成品質已驗證。原生／快速、單人／多人、說話鏡頭、不同尺寸與人物交錯應分別驗收，不宣稱全部組合已完成實測。

---

# VOSR 1× 精修

這是**生成後的手動畫質處理**，對整段影片逐幀修復細節，不放大、不補幀，也不負責指定人物身份或追蹤人臉。與「人臉精修」及 SeedVR2 720p 提升是不同功能。

1. 選「影片畫質提升 → 畫質處理方式 → VOSR · 1× 精修（維持原尺寸）」。可上傳 MP4／MOV／WebM（上限 1 GB），或選已有作品；作品的「影片操作 → VOSR 精修」也能直接帶入。
2. 來源準備完成後，按「加入 VOSR 精修佇列」。工作與 H3／Qwen／RTX／Drama3 等依同一個 Studio 佇列順序執行；切換來源不改變已加入的那一筆。
3. 狀態會顯示載入、已處理幀數／總幀數與輸出驗證。完成後另存新作品，標示 VOSR 1×、來源、尺寸、幀率及耗時，原片保留。
4. VOSR 成品按「再做一次」會還原**當時的原始來源**；若要對該成品再精修一輪，請選「VOSR 精修」。重新載入設定不會自動開始 GPU 工作。

固定使用 BF16 DiT／視覺編碼器、FP32 VAE、wavelet 校色；DiT 與 VAE tile size 均為 512、overlap 64，每幀固定種子 42。這是本機已實跑的一組設定，介面第一版不開放倍率、強度或其他參數。模型在短生命週期的獨立程序內執行，前一筆模型先卸載，工作完成或被中斷後結束程序並清理暫存影片；不把未完成輸出列入作品。

成品維持來源的尺寸、固定幀率與幀數；有聲來源直接複製第一條音軌並比對音軌雜湊，無聲來源維持無聲。第一版支援**偶數寬高、一般方形像素、無旋轉標記的 8-bit SDR 固定幀率影片**；可變幀率、HDR／高位元或需旋轉／像素比例正規化的來源會回報不支援，請先轉換來源。VOSR 不沿用 SeedVR2 的 720p／15 秒片段設定。

目前未加入「生成後自動 VOSR」或「修臉後自動 VOSR」。更清楚的細節可能包含模型重新描繪，且不保證跨幀無閃爍；建議先用短片比較。2026-10-24 的約五秒樣本已驗證尺寸、124 幀、24 fps、音軌一致，以及中途停止後原片保留、無成品與暫存影片；尚未驗證所有長度、解析度、來源格式或修臉串接組合。

來源快取位於 `ComfyUI/input/h3_rtx/<sourceId>/`（沿用既有影片匯入）；成品為 `ComfyUI/output/video/H3_Studio_VOSR_1x_*.mp4`，旁邊 `.mp4.h3.json` 保存 `vosrSourceId`、來源檔名與處理資訊。刪除來源快取後，「再做一次」需重新選取或上傳原片。

# RTX 提升

創作頁選「RTX提升」，先依步驟 13 安裝 NVIDIA 套件。此功能使用 `H3StudioRTX`，與 SeedVR2「影片畫質提升」分開，不使用 SeedVR2 的強度混合或 720p 固定目標。

| 功能 | 選項 | 輸出行為 |
|---|---|---|
| 提高 FPS（補幀） | 2～16 倍 | 例如 24 → 48 fps；尺寸不變，保留時長，採 MEDIUM 模式與自動切鏡偵測 |
| 提高解析度（超解析） | 2／3／4 倍 | 寬與高各乘倍數並對齊 8 的倍數；幀率不變，採 ULTRA、strength 1.0 |

1. 上傳 MP4／MOV／WebM（上限 1 GB），或選擇 Studio 影片作品。
2. 選功能與倍數；來源資訊準備完成後會顯示預期尺寸／幀率。
3. 按「開始 RTX 提升」或「加入佇列」。來源與參數在加入時保存，透過共用佇列依序執行。
4. 完成後預覽／下載，也可在作品頁找到 `RTX 補幀` 或 `RTX 超解析` 標記。

成品另存至 `ComfyUI/output/video/H3_Studio_RTX_*.mp4`，來源快取在 `ComfyUI/input/h3_rtx/`；保留來源音軌內容（重新編為 AAC），影片輸出為 H.264 MP4，並保存操作、倍數、來源及處理耗時 metadata。成品不支援 H3 動態延伸。只更新瀏覽器無法載入新後端節點，新增／更新此功能後須重啟主 ComfyUI。

RTX 處理逐幀串流，沒有 SeedVR2 介面的約 15 秒上限，但長片、高解析度與高補幀倍數會增加處理時間與磁碟空間；支援選項不等於每種倍數與來源都已實測。這不是 NVIDIA 控制台對瀏覽器播放的即時增強設定。

---

# ORB360 環繞提示詞（可選）

新增 `minimax_h3_orb360_step1500.safetensors` 對應的環繞提示詞功能：描述人物與場景保持靜止，只有攝影機順時針環繞一圈，再回到起始視角。此功能提供提示詞模板，實際生成是否完成一圈仍需檢查成品。

下載：[作者模型頁](https://huggingface.co/MATLOWAI/MiniMax-H3-ORB360-CardSpin)／[step1500 固定版本直接下載](https://huggingface.co/MATLOWAI/MiniMax-H3-ORB360-CardSpin/resolve/de8aa4db6f9a0d949855f3dc62948ffc691aa6ce/minimax_h3_orb360_step1500.safetensors)。保留檔名，放在 `ComfyUI/models/loras/`；大小 596,450,168 bytes（約 569 MiB），不含在基本模型總量中。SHA256：`e9275b2f456f6bd004c9cb3cf5c636cad87217c5bc96e6a5b5533e917de121da`。

1. 將 LoRA 放入 `ComfyUI/models/loras/`，重新整理 Studio。
2. 在 H3 創作頁選「圖片轉影片」或「參考生影片」，上傳圖片。
3. 在「額外 LoRA」新增 `minimax_h3_orb360_step1500.safetensors`，強度使用 **0.8**。
4. 提示詞空白時，選擇此 LoRA 會自動填入環繞模板；已有提示詞時，按「套用環繞提示詞」替換。參考模式會使用第一張已上傳參考圖的標籤。
5. 模板要求靜音影片；若要輸出無音軌影片，另將聲音選項關閉，再按生成。

「套用環繞提示詞」只在圖片／參考模式的新影片顯示，不適用文字模式或影片延伸。**ORB360 使用 0.8；下方 MysticXXX V1 使用 0.5。**

---

# MysticXXX V1 額外 LoRA（可選）

本機新增 `MysticXXX_MMH3-V1.safetensors`，檔案不包含在 Git 倉庫內。這是 MiniMax H3 的人物身體／解剖表現 LoRA，作者主要針對成人題材訓練；用途介紹見 [作者頁面存檔（V1）](https://civarchive.com/models/2856467?modelVersionId=3226233)。它不負責 Turbo 加速，也不能保證改善一般對話、口型或吵架動作。

## 下載與安裝

- [下載 V1（Hugging Face 社群鏡像，固定版本）](https://huggingface.co/Kutches/minmax/resolve/318d8d9d7acea5a3fd55d8c0e21cbb65cbe7f534/MysticXXX_MMH3-V1.safetensors?download=true)
- [檔案資訊與 SHA256](https://huggingface.co/Kutches/minmax/blob/318d8d9d7acea5a3fd55d8c0e21cbb65cbe7f534/MysticXXX_MMH3-V1.safetensors)
- 大小：596,451,528 bytes，約 569 MiB。
- 保留檔名 `MysticXXX_MMH3-V1.safetensors`，放入 `ComfyUI/models/loras/`，再重新整理 Studio；選單未更新時重啟 ComfyUI。
- SHA256：`7dd837f4c5420d4ec59f3ff1757b3f9d264a6c0f120d65d9c4f59c77584dd0be`。

## 介面設定與目前限制

在 H3 創作頁的「額外 LoRA」按「＋ 新增 LoRA」，選擇 `MysticXXX_MMH3-V1.safetensors`，將強度手動改成 **0.5**。新增列目前預設為 0.8，並未自動改成 0.5。Turbo 由影片模式自動套用，不需重複新增。

**2026-10-17 已修正社群 LoRA 命名載入問題**（commit `f3522a5`）：額外 H3 LoRA 改用 `H3StudioLoRA`，支援帶／不帶 `diffusion_model.` 前綴及 `lora_unet_` 命名，接受 A／B 或 down／up 權重，並檢查配對、尺寸與實際模型目標。零匹配或權重套用不完整時會停止生成，部分未匹配項目會寫入警告。先前重複加前綴的問題已不是目前狀態，但修正命名不等於所有題材效果已經成片驗證。

上述 **0.5 是本機測試設定**；選單另外顯示 V1 作者建議 0.75～0.8，可依目標調整。更新程式後須重啟主 ComfyUI，否則舊服務仍使用舊載入器。原版社群權重可直接使用，不必為了前綴另外製作 `_H3Studio`／`_FIXED` 檔；不要同時疊加同一 LoRA 的原版與轉換版。

## 其他社群 H3 LoRA 與檢查工具

「額外 LoRA」選單會針對已識別的檔名顯示用途、強度建議與觸發詞；未知檔名仍顯示未核對提示。說明資料來自程式內的檔名對照，不會自動下載權重，也不代表列在選單中的每款都已驗證生成效果。H3 LoRA 放 `ComfyUI/models/loras/`；Qwen 攝影機 LoRA 僅用在 Qwen，不能當作 H3 LoRA 使用。

可先做不載入主模型的名稱／尺寸檢查：

```powershell
.\.venv\Scripts\python.exe .\tools\check_lora_h3.py
.\.venv\Scripts\python.exe .\tools\check_lora_h3.py .\ComfyUI\models\loras\MysticXXX_MMH3-V1.safetensors
```

也可把 LoRA 拖到 `check_lora_h3.bat`。工具以已安裝的 Turbo LoRA 作為參考，只檢查權重名稱與尺寸；實際生成時 `H3StudioLoRA` 再對照當次主模型，最終效果需固定 prompt／seed 比較成片。Turbo 本身由影片模式自動套用，不需重複放進額外 LoRA。

---

# 語音生成（Drama3 本機多人配音）

語音頁預設選「Drama3 · 本機多人配音」，可切到「Gemini · 雲端語音」。Drama3 不需要 API 金鑰，但需先完成步驟 12 的獨立環境與步驟 7 的模型下載。

1. 設定角色名稱與已保存的聲線，最多 **16 個角色**。同一角色的台詞使用同一聲線；「開啟所在資料夾」可查看保存檔。
2. 尚無聲線時，展開「新增聲線 · 上傳參考音訊」：上傳 **1～30 秒、32 MB 內**的單人清晰語音，接受 WAV／MP3／FLAC／M4A／OGG／WebM。
3. 選中文／英文／日文／粵語／韓文，按「辨識逐字稿」後校正內容；也可直接手動輸入與參考聲音一致的逐字稿。填名稱並選角色，按「保存聲線並指派」。
4. 對話劇本每列選角色、輸入台詞，使用 ↑／↓ 排序或「移除」。按鈕、角色與台詞採同列緊湊排列，文字框可拉高。最多 **100 段、每段 2,000 字元、合計 12,000 字元**。
5. 可在台詞加入 `[sighs]`、`[laughs]`、`[whispers]` 等表演提示，或自然語言風格指示；角色由選單指定，不要手動輸入 `<|speaker:N|>` 等系統標記。表演效果仍需實際聆聽確認。
6. 按「加入佇列 · 生成多人對話」。需要中斷時按「停止目前語音工作」；等待取消與程序退出後才會釋放佇列。完成後可播放、下載 FLAC，也會出現在作品頁「聲音」分類；「再做一次」載回角色、台詞與參數。

**試聽與生成不同：** 角色旁「試聽」是從保存聲線還原原本的參考音訊，不會讓模型重新念目前台詞。同一聲線在目前頁面取得試聽後可直接重播，試聽不加入作品。因此試聽很快，不代表新台詞生成也會一樣快。

| 資料 | 保存位置（專案根目錄起算） |
|---|---|
| 聲線（編碼＋逐字稿） | `services/Drama3/ComfyUI/output/drama3_voices/*.safetensors` |
| 正規化參考音訊 | `services/Drama3/ComfyUI/input/H3_Drama3_ref_*.wav` |
| Drama3 原始生成音訊 | `services/Drama3/ComfyUI/output/H3_Studio_Drama3/` |
| 匯入 Studio 的成品與 metadata | `ComfyUI/output/H3_Drama3/H3_Drama3_*.flac` 及 `.flac.h3.json` |
| 匯入 Studio 的聲線試聽 | `ComfyUI/output/H3_Drama3_Previews/` |

進階設定預設 Temperature 1、Top P 0.9、Top K 30、每塊 1,290 frames（約 60 秒）；種子可留白隨機或填非負安全整數。長文依約 300 UTF-8 bytes 自動分塊，中文一句可能占多個 bytes；時長上限是**每塊**上限，不是整份劇本的總長，提早結束就不會跑滿上限。大幅縮小上限可能截斷台詞。

目前會先釋放主 H3 的 GPU 模型，再啟動 Drama3；結果保存／匯入後關閉 8190 的 Python 程序，釋放模型與服務本身的記憶體。待命時顯示「Drama3 已待命」，不會為了讀取聲線清單常駐啟動。若關閉失敗會回報錯誤，不能把該筆當作已成功釋放；重啟主 H3 後端才會套用這套生命周期程式。已知本機生成效能與記憶體壓力見「效能參考」，尚未修復生成速度問題。

---

# 語音生成（Gemini TTS）

在語音頁切換「Gemini · 雲端語音」，於雲端執行，不佔本機 GPU。需要先完成步驟 11。

語音生成頁上方左側顯示 API 金鑰狀態，右側是「Google Studio 生成」。按「開啟」會在瀏覽器新分頁打開 Google AI Studio 的 Generate Speech 頁，直接在 Google 網頁上試用 Gemini TTS：<https://aistudio.google.com/generate-speech>。此連結不需要先設定本機 API 金鑰。

| 項目 | 說明 |
|---|---|
| 模型 | Gemini 3.8 Flash TTS（表演較細膩）、Gemini 3.8 Flash-Lite TTS（較快） |
| 文字長度 | 每次最多 6,000 字元；模型單次輸入上限為 8,192 tokens，較長內容請自行分段 |
| 語氣與表達方式 | 選填，最多 500 字元，例如「自然親切，語速稍慢」 |
| 輸出 | WAV，存在 `ComfyUI\output\H3_Audio\`，同時出現在作品頁的「聲音」分類，可試聽、下載、刪除 |

**聲線**

- **預設聲線**：下拉選單裡的 30 個 Gemini 預設聲線。按旁邊的「試聽」會用目前選的模型念一句英文固定短句。
- **聲線庫**：可用關鍵字、語言代碼（例如 `en-US`、`zh-TW`）與性別搜尋 Google 提供的全部預設聲線，每頁 50 個。每個聲線都能試聽；試聽時該列會變成播放器並自動播放，按「選用」就會套用到下拉選單。
- 聲線 ID 一律是小寫（例如 `kore`），與 Gemini 聲線清單 API 回傳的格式一致。

**試聽的費用與快取**

試聽也會呼叫 Gemini API，會用到額度。試聽只念一句依聲線語言選擇的短句，預覽**不會**加入作品。

同一組「模型 + 聲線 + 語言」只會真正呼叫一次，結果快取在 `ComfyUI\temp\h3_tts_preview_cache\`，之後重播不再計費。下拉選單與聲線庫試聽同一個預設聲線時共用同一份快取。要強制重新生成，刪除這個資料夾即可。

---

# 目錄配置

```text
MinimaxH3/                          ← Git 倉庫根目錄
├─ h3-local-studio/                 ← Studio 前端（唯一一份原始碼）
│  ├─ app/                          ← 介面
│  ├─ lib/comfy.ts                  ← 工作流建構與 ComfyUI API 呼叫
│  ├─ lib/tts.ts                    ← 語音生成 API 呼叫與預設聲線清單
│  ├─ lib/drama3.ts                 ← 本機多人配音 API
│  ├─ lib/rtx.ts                    ← RTX 提升 API 與佇列工作
│  ├─ lib/enhance.ts                ← SeedVR2 工作流與畫質混合
│  ├─ lib/vosr.ts                   ← VOSR 來源還原、佇列提交與進度
│  ├─ lib/generation-queue.ts       ← 瀏覽器內共用佇列
│  └─ tests/
├─ integrations/
│  ├─ ComfyUI-Drama3-Studio/        ← 8190 的角色綁定／聲線轉接節點
│  └─ ComfyUI-H3-Studio/            ← 8188 的 Studio 自有節點
│     ├─ __init__.py
│     ├─ h3_studio_api.py           ← /h3-studio/* API 路由
│     ├─ h3_studio_tts.py           ← Gemini TTS 請求、驗證與試聽快取
│     ├─ h3_studio_drama3.py        ← Drama3 工作、結果匯入與服務啟停
│     ├─ h3_studio_rtx.py           ← NVIDIA RTX 補幀／超解析
│     ├─ h3_studio_vosr.py          ← VOSR 工作節點、來源與進度 API
│     ├─ h3_studio_vosr_worker.py   ← 獨立程序逐幀精修、編碼與驗證
│     ├─ h3_studio_lora.py          ← 社群 H3 LoRA 載入檢查
│     ├─ h3_studio_enhance.py       ← 影片準備、混合與畫質提升 API
│     ├─ h3_cooled_turbo_sampler.py ← 兩個降溫用採樣節點
│     └─ h3_prompt_output_schema.json
├─ workflows/                       ← 五個 12GB 顯存 workflow JSON
├─ start_h3_studio.bat
├─ start_comfyui_h3.bat
├─ stop_h3_studio.bat
├─ start_drama3.bat / stop_drama3.bat ← 手動啟停獨立語音服務
├─ tools/drama3_service.ps1         ← Drama3 安全啟停與身分檢查
├─ H3_BENCHMARK.md                  ← 實測數據
├─ H3_INSTALL_RESULT.md             ← 安裝結果紀錄
│
├─ ComfyUI/                         ← 不納入 Git，自行安裝
│  ├─ custom_nodes/
│  │  └─ ComfyUI-H3-Studio ─────────→ junction 指向 integrations/
│  └─ models/                       ← 模型放這裡
├─ services/Drama3/                 ← 不納入 Git，獨立語音環境
│  ├─ .venv/                       ← Drama3 專用 Python
│  ├─ run/                         ← 8190 服務日誌
│  └─ ComfyUI/
│     ├─ custom_nodes/ComfyUI-Drama3/
│     ├─ custom_nodes/ComfyUI-Drama3-Studio → junction 指向 integrations/
│     ├─ models/                   ← Drama3 主模型、codec、ASR
│     └─ output/drama3_voices/      ← 已保存的角色聲線
└─ .venv/                           ← 不納入 Git，自行建立
```

`workflows/` 裡的五個 JSON 是可以直接在 ComfyUI 開啟的獨立工作流（Quality、Fast、Sage、Turbo 6 步、Turbo 8 步）。Studio 介面不使用它們，而是依照你選的設定動態建構工作流。

---

# 效能參考

RTX 4080 Laptop 12 GB，608×352、24fps、124 frames（5.2 秒）：

| 設定 | 步數 | 耗時 | 峰值 VRAM |
|---|---:|---:|---:|
| Native 基線 | 20 | 283 秒 | 11486 MB |
| QUALITY（含 SageAttention） | 20 | 187 秒 | 11458 MB |
| FAST（Turbo LoRA + INT8 VAE，暖機後） | 6 | **58 秒** | 11589 MB |

以上是 2026-08-11 的獨立 workflow 實測，詳見 `H3_BENCHMARK.md`，不包含目前 Studio 的每步降溫設定，不能直接當作目前介面的總耗時。

以下 Qwen 數據是在 25 步、每步降溫 3 秒下取得的歷次實測；目前 Qwen 預設降溫已改為 0 秒，所以下表不是目前預設設定的耗時：

| 設定 | 耗時 | 峰值 VRAM |
|---|---:|---:|
| 文字生圖 1024×1024 | 96 秒 | 10.4 GB |
| 文字生圖 1344×768 | 115 秒 | — |
| 編輯（1 張 1344×768 參考圖） | 136 秒 | 11.3 GB |

每步實際運算不到 1 秒，時間大多是降溫；2K（4 MP）尚未在 12 GB 上實測。

Qwen 最後一步後不再降溫（直接解碼存圖）；H3 每步降溫則包含最後一步。「加速」選 EasyCache 會跳過前後變化很小的步數，較快但細節可能略軟；速度差距尚未在 12 GB 上實測。

### 2026-10-11：Noct Q V4／REDQW21 V2 實測

同一台 RTX 4080 Laptop 12 GB，25 步、Euler／simple、CFG 1、降溫 0 秒、EasyCache 關閉。下表是各次 ComfyUI 工作記錄的執行時間，不包含下載與服務啟動；單次結果不是模型速度排名。

| 模型 | 測試 | 輸出尺寸 | 執行時間 |
|---|---|---|---:|
| Noct Q V4 | 文字生圖 | 1024×1024 | 38 秒 |
| Noct Q V4 | 單圖編輯，黃色雨衣改藍色 | 1024×1024 | 49 秒 |
| Noct Q V4 | 指定 16:9，第一張圖置中裁切後改色 | 1376×768 | 51 秒 |
| Noct Q V4 | 指定 9:16，第一張圖置中裁切後改色 | 768×1376 | 49 秒 |
| REDQW21 V2 | 文字生圖 | 1024×1024 | 37 秒 |
| REDQW21 V2 | 單圖編輯，黃色雨衣改藍色 | 1024×1024 | 49 秒 |
| REDQW21 V2 | 雙圖參考，第一張人物／場景與第二張雨衣顏色 | 1024×1024 | 85 秒 |

以上流程都成功輸出圖片，並確認模型版本可保存及讀回；指定編輯比例也完成保存驗證。一般人物與雨衣改色提示可用，但編輯可能改動臉部、構圖或背景，不能視為精確局部修改。兩款的 2K、四圖參考與攝影機 LoRA 尚未驗證，也未復現作者完整採樣／後製方案。

---

### 2026-10-17：Drama3 本機語音實測

RTX 4080 Laptop 12 GB、系統 RAM 32 GB、W4A8 主模型、experts in RAM、2 GiB GPU expert 快取、pinned memory 關閉。以下是後端日誌記錄的執行耗時，包含載入／預處理與推論，不代表各階段已分別量測：

| 台詞 | 成品長度 | 後端耗時 |
|---|---:|---:|
| 6 段雙人對話（自動分 3 塊） | 約 26.05 秒 | 約 648 秒 |
| 單句「先去問能不能留到月底……」 | 約 4.78 秒 | 約 162 秒 |

單句同步監控記錄中，從後端工作開始到第一個音訊 frame 約 74 秒；生成時可用 RAM 曾降至約 200 MB，並持續讀入磁碟頁面。任務結束並釋放模型後，可用 RAM 回升到約 17.5 GB。這證明生成期間有記憶體壓力，但尚未透過對照測試拆出換頁、CPU 發送 kernel、量化運算與傳輸各自的耗時比例，不能把全部延遲歸因於單一因素。

自動關閉服務的修改已通過 20 項後端測試與兩次真實聲線試聽的「自動啟動 → 保存結果 → 程序退出」驗證；這不是完整文字生成的效能修復，也未重跑以上生成作速度對照。

---

### 2026-10-24：Singularity V2 與 VOSR 實測

硬體為 RTX 4080 Laptop 12 GB、32 GB RAM，使用專案既有環境。下列是單次已完成的短片結果，不是不同 GPU 或冷暖狀態可直接套用的速度保證。

| V2 生成測試 | 尺寸／原生輸出幀數 | 完整耗時 |
|---|---|---:|
| 文生 4 步 | 608×352／124 幀 | 171 秒 |
| 文生 6 步 | 608×352／124 幀 | 183 秒 |
| 文生 8 步 | 608×352／124 幀 | 237 秒 |
| 首尾圖 4 步 | 608×352／124 幀 | 158 秒 |
| 參考圖＋首尾圖 4 步 | 608×352／120 幀 | 156 秒 |

以上均含音軌並完成整段解碼；每步冷卻 15 秒，第一筆另有冷啟動成本，因此不能直接用總耗時算採樣加速比。首尾圖測試使用相同測試圖作兩端約束，沒有涵蓋不同構圖的首尾轉換。抽幀未見明顯人物崩壞，但沒有證明 6／8 步必然優於 4 步。

VOSR 使用 V2 四步影片作來源，1× 處理 608×352、124 幀、24 fps。獨立試驗約 **58 秒**（不含首次下載與模型載入）；Studio 的完整工作約 **87 秒**，含獨立程序啟動、載入、處理及驗證。兩者均維持尺寸、幀率與幀數，原音軌資料雜湊一致；Studio 版本另外通過中斷清理、作品顯示、來源還原與 Chromium 桌機／手機介面驗收。

人臉輪廓、眼鼻與髮絲在放大比較中較清楚，但有重新描繪。相同來源光流做動作補償後，平均跨幀像素差異由約 1.21 增至 1.47（8-bit 尺度，約 +22%）；數值同時包含細節增強、光流誤差與可能的閃爍，**不是閃爍程度增加 22% 的結論，也不能據此宣稱無閃爍**。

# 疑難排解

### VOSR 顯示尚未就緒或再做一次找不到來源

先查看 `http://127.0.0.1:8188/h3-studio/vosr/status`。404 通常表示主 ComfyUI 尚未重啟或 Studio 節點未載入；`ready: false` 時依 `missing` 路徑補齊節點／模型，尤其確認 DINOv2 已轉成 safetensors。只重新整理網頁不會重新載入 Python 節點。若已刪除 `ComfyUI/input/h3_rtx/` 的來源快取，重新選取原片；不要把成品誤當成原始來源重跑。


**作品列表空白、優化按鈕失敗、生成找不到節點**
junction 沒建好。回到步驟 6，並確認 ComfyUI 主控台有 `ComfyUI-H3-Studio` 的載入紀錄。

**生成極慢，GPU 使用率卻很低**
記憶體不足導致權重被換出到硬碟。關掉瀏覽器分頁與其他吃記憶體的程式，重啟 ComfyUI 釋放快取模型。若專案放在外接硬碟，搬到內接 NVMe。

**Drama3 顯示待命，但 8190 無法連線**
這是完成後退出服務的正常狀態。請看主 H3 的 `/h3-studio/drama3/status`，應為 `ready: true`、`standby: true`；下一筆工作會自動啟動。若顯示未安裝，檢查步驟 12 的獨立 venv／ComfyUI 路徑；模型缺檔則依步驟 7 補齊。

**Drama3 試聽很快，生成一句話卻需要數分鐘**
試聽只解碼已保存的參考音訊；生成會準備約 24.6 GB 主模型並逐幀推論。請在生成當下看系統可用 RAM、磁碟讀取與進度，不要用工作結束後的記憶體百分比判斷。32 GB 開發機已觀察到大量換頁，目前速度問題仍存在；完成後關閉程序只釋放閒置記憶體。

**Drama3 工作完成後 Python 還常駐，或下一筆不會自動啟動**
確認已更新程式並重啟主 H3 ComfyUI，以載入新生命周期邏輯；確認該 PID 的命令列是本專案的 `--port 8190`，不要關閉其他 Python。查 `services/Drama3/run/server-8190.stderr.log` 及工作錯誤；閒置時可使用 `stop_drama3.bat`，工作中先按介面的停止。

**RTX 提升回報缺少 NVIDIA 套件／節點**
套件必須裝在主 H3 `.venv`，不是 Drama3 `.venv`。依步驟 13 確認 `import nvvfx` 與兩個 effect 類別可用，再重啟主 ComfyUI；補幀另外需要 RTX 40 系列或更新，不能只憑超解析可用就判定補幀支援。

**同一個 session 內切換 Turbo（4步／6步／8步）與 QUALITY 後變慢**
ComfyUI 會把載入過的模型留在記憶體，兩種 VAE 與有無 LoRA 的模型副本會同時堆著。重啟 ComfyUI 即可。

**Prompt 優化回「usage limit」**
CLI 帳號額度用盡。請依 Grok CLI 或帳號頁面確認方案、額度與重置時間。

**Prompt 優化回「did not return the official H3 prompt structure」**
模型這次沒有照官方格式輸出，屬於間歇性狀況，再按一次通常就好。Ref2VA 模式要求六個欄位，比其他模式容易失敗。

**語音生成頁顯示「尚未設定 API 金鑰」，但已經設過環境變數**
ComfyUI 是在設定變數之前啟動的。執行 `stop_h3_studio.bat` 後，從新開的終端機或檔案總管重新執行 `start_h3_studio.bat`。

**語音生成或試聽回「Gemini API 額度已用完或請求過多」**
Gemini API 回 HTTP 429。等一段時間再試，或到 Google AI Studio 檢查帳號的用量與計費設定。

**語音生成回「Gemini API 無法接受這次語音設定」**
通常是文字超過模型單次輸入上限（8,192 tokens），請分段生成。

**ComfyUI 主控台出現 `ConnectionResetError: [WinError 10054]`**
無害。介面每 5 秒輪詢一次 ComfyUI，逾時後主動關閉連線就會印出這個 traceback，不影響生成。

---

# 開發者資訊

| 元件 | 實測通過的版本 |
|---|---|
| Python | 3.11.15 |
| PyTorch | 2.10.0+cu130（CUDA 13.0） |
| ComfyUI | v0.37.0 |
| Drama3 獨立 ComfyUI | v0.40.0／`3541246a` |
| ComfyUI-Drama3 節點 | `66c4fb9c` |
| Drama3 獨立 comfy-kitchen／comfy-aimdo | 0.2.37／0.5.6 |
| nvidia-vfx（RTX 提升） | 0.2.0.0／VFX SDK 1.3.0.0 |
| triton-windows | 3.6.0.post26 |
| SageAttention | 2.2.0+cu130torch2.10.0andhigher.post6 |
| Pillow | 12.2.0 |
| Node.js | 24.15.0 |
| FFmpeg | 8.1 |

改動 `integrations/ComfyUI-H3-Studio/` 底下的檔案後要重啟 ComfyUI 才會生效。改動 `h3-local-studio/` 底下的檔案由 dev server 熱更新，不用重啟。

跑測試：

```powershell
cd h3-local-studio; npm test
```

Singularity／VOSR 新增驗證（均從專案根目錄執行，下列不提交 GPU 工作）：

```powershell
node --test h3-local-studio/tests/singularity.test.mjs h3-local-studio/tests/vosr.test.mjs
.\.venv\Scripts\python.exe tools/test_vosr_studio.py
.\.venv\Scripts\python.exe tools/test_h3_reference_anchors.py
```

`tools/test_vosr_studio_ui.mjs` 使用專用 headless Chromium 並攔截 API，檢查選擇方法、作品入口、佇列／進度、成品、原始來源還原與手機／桌機版面；不呼叫 GPU。`tools/test_h3_singularity.mjs` 與 `tools/test_vosr_video.py` 則會實際生成／處理影片，後者固定使用本機測試來源，不能當成無副作用的單元測試。

2026-10-24 完整 `npm test` 為 61 項、58 通過、3 項既有字串斷言失敗（Motion Context、裁切、沿用種子），已在修改前重現；新增測試通過。完整 TypeScript 檢查另有既有 Cloudflare 型別缺失，不能把正式建置成功視為型別檢查全綠。

Drama3 後端測試（在專案根目錄，用主專案 venv；模擬服務，不執行大模型）：

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s integrations/ComfyUI-H3-Studio -p test_h3_studio_drama3.py
```

涵蓋角色綁定、參考聲線試聽、下載／metadata、取消、工作完成後關閉、待命清單、下一筆重新啟動與失敗清理。`tools/test_h3_drama3.mjs` 會操作實際服務並建立測試聲線／配音，與不送 GPU 工作的 `tools/test_h3_queue_layout.mjs` 不同，不要當作純介面測試隨意執行。瀏覽器驗收只使用 Playwright 專用 headless Chromium，禁止啟動或控制本機 Microsoft Edge。

人臉精修後端測試（在專案根目錄，使用 mock 與 FFmpeg，不執行 H3 生成）：

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s integrations/ComfyUI-H3-Studio -p test_h3_studio_face.py
```

前端測試包含 `h3-local-studio/tests/face-refine.test.mjs`，檢查原生／快速精修接線、多人串接、取消與自動生成後接續精修等行為；`tools/test_h3_face_ui.mjs` 是攔截 ComfyUI API 的 Chromium 介面測試。`tools/test_h3_face.mjs` 預設會偵測真實來源並建立快取，加上 `--run` 才提交精修 GPU 工作，`--turbo`／`--multi` 分別切換快速／多人模式；請使用明確指定的短片，勿把它當作純 mock 測試。

---

# 授權

MIT License，見 `LICENSE`。

本倉庫不含模型權重。各模型與第三方節點依其原始授權條款使用。
