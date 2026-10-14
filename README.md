# H3 Local Studio

Windows 本機版 MiniMax H3 影片製作介面。影片、Qwen 圖像與 SeedVR2 畫質提升由本機 ComfyUI 執行。可選的 Prompt 優化會透過 Codex／Grok CLI 使用外部服務，並提供提示詞及所選圖片；語音生成與聲線試聽使用 Google Gemini API。

## 功能

- 文字轉影片（T2VA）
- 首尾圖轉影片（I2VA / FL2VA / L2VA）
- 參考圖轉影片（Ref2VA），最多 9 個參考項目，每項可設圖片、`@標籤` 與說明
- 影片延伸：沿用原本的人物與場景，接續前一段的最後畫面，裁掉重疊幀後合併
- 官方 H3 Prompt 優化：把一句白話描述改寫成 MiniMax 官方格式，可選 Codex 或 Grok 執行
- 圖像編輯（Qwen-Image 2.1）：原版、Noct Q V4、REDQW21 UNLOCKED V2 三種主模型可切換；文字生圖或上傳最多 4 張圖編輯，支援 7 種比例與 2K。編輯預設依第一張圖比例，指定比例時先裁切第一張圖
- 語音生成（Gemini 3.8 TTS，雲端，可選）：文字轉 WAV，30 個預設聲線加上可搜尋、試聽的 Google 聲線庫
- 攝影機視角：Qwen 圖像搭配 Multiple-Angles LoRA v2，支援方位、角度、景別與強度
- 影片換角：BFS 換頭（臉部＋髮型）或整個角色替換，支援 4／6／8／20 步、480P／540P／原生 H3，沿用來源影片比例並合回原音軌
- 影片畫質提升：SeedVR2 3B INT8，另存 720p 作品，保留原比例、幀率與聲音
- H3 影片與 Qwen 圖片共用生成佇列，按下生成時保存設定與圖片，依序執行
- 作品列表、刪除、下載，並保存生成設定 metadata

---

# 這個倉庫不包含什麼

**這一節最重要。** 倉庫提供原始碼，不包含 ComfyUI、執行環境及模型。完整 H3 七個模型約 **54.2 GiB**；加上 Qwen、攝影機 LoRA 與 SeedVR2，模型合計約 **74.3 GiB**（約 80 GB），還需另外預留環境、下載快取、暫存影片與作品空間。

上述大小使用 Qwen 原版；另加 Noct Q V4 與 REDQW21 V2 兩個可選主模型需約 **13.5 GiB**，三款都保留時模型合計約 **87.8 GiB**。

| 缺少的東西 | 大小 | 為什麼不在倉庫裡 |
|---|---:|---|
| ComfyUI 本體 | 約 1 GB | 上游專案，另行 clone |
| 四個第三方 ComfyUI 節點 | 約 50 MB | 各自有 repo 與授權 |
| Python 虛擬環境 `.venv` | 約 8 GB | 含 PyTorch 與 CUDA 套件 |
| 模型檔 | H3 約 54.2 GiB；全部功能約 74.3 GiB | 體積過大，見步驟 7 |
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
| H3 文字／首尾圖影片（4步／6步／8步） | H3 共用三項、首尾圖模型、Turbo LoRA | 步驟 5 的 H3 節點 |
| H3 QUALITY、一般影片動態延伸 | 上述模型，另加 FP16 影片 VAE | Motion Context 節點 |
| H3 參考生影片（4步／6步／8步） | H3 共用三項、Ref2VA W4A8 模型、Turbo LoRA | LongMedia 節點；最多 9 張參考圖 |
| 影片換角（BFS 換頭／整個角色替換） | H3 共用三項、Ref2VA W4A8 模型、對應 BFS LoRA；4／6／8 步另需 Turbo LoRA | H3 原生 Add Guide、既有 H3／KJNodes 節點與 FFmpeg |
| Qwen 文字生圖／圖像編輯 | Qwen 三項 | 使用 ComfyUI v0.37.0 |
| Qwen 攝影機視角 | Qwen 三項、攝影機 LoRA | 只上傳一張原圖 |
| 影片畫質提升（AI 強度大於 0%） | SeedVR2 兩項 | ComfyUI v0.37.0 的內建 SeedVR2 節點、FFmpeg |
| H3 Prompt 優化 | 不需要額外生成模型 | Codex 或 Grok 登入，加上外部 Prompt skill |
| Qwen 提示詞優化 | 不需要額外生成模型 | 固定使用 Codex CLI，不使用 H3 Prompt skill |
| Gemini 語音生成 | 不需要本機生成模型 | 步驟 11 的 API 金鑰 |

目前指南固定主要套件與節點到本機使用的版本；第三方 requirements 中的其他相依套件仍由 pip 解析。本指南已核對原始碼、版本與下載來源，尚未在另一台乾淨電腦完成全流程重裝。

## 步驟 0：硬體與系統需求

| 項目 | 需求 | 開發機實測值 |
|---|---|---|
| 作業系統 | Windows 10 / 11 | Windows 11 |
| GPU | NVIDIA，**VRAM 12 GB 以上** | RTX 4080 Laptop 12 GB |
| 系統 RAM | **32 GB 以上** | 32 GB |
| 硬碟空閒空間 | H3 建議至少 80 GB；全部功能建議至少 110 GB，作品與快取另計 | — |
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

以下每個檔名都有**直接下載連結**，固定到 2026-10-11 核對的上游 revision。只下載要用的功能；不要 clone 整個模型倉庫，也不要將不同版本的同名模型互換。下載後的檔名與目錄必須和表格一致。若目錄尚不存在，先建立：

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

### BFS 影片換角（可選）

沿用 H3 的共用文字編碼器、INT8 影片 VAE、聲音 VAE 與 Ref2VA W4A8 主模型；不需另下載一套 H3。以下兩個 LoRA 依替換範圍選擇，放入 `ComfyUI/models/loras/`，保留表中的檔名。兩個都安裝約增加 **0.87 GiB**，未計入前面的基本模型總量。

| 本機檔名／下載連結 | 用途 | 大小 GiB |
|---|---|---:|
| [`minimax_h3_head_swap_v1.0_r32.safetensors`](https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI/resolve/e095edae3f4c69e18b4f27ed9e541078c87a8d98/loras/minimax_h3_head_swap_v1.0_r32.safetensors) | 換頭：臉部＋髮型 | 0.29 |
| [`minimax_h3_character_swap_v1.0_ref2va_r64_gl.safetensors`](https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI/resolve/e095edae3f4c69e18b4f27ed9e541078c87a8d98/loras/minimax_h3_character_swap_v1.0_ref2va_r64_gl.safetensors) | 整個角色替換：外貌、身形與服裝 | 0.58 |

SHA256：

```text
minimax_h3_head_swap_v1.0_r32.safetensors
ea97bd1a8178460661055784d63b4cb560732196fd15d5d7f33bfd214b65ab00

minimax_h3_character_swap_v1.0_ref2va_r64_gl.safetensors
643a3fe63646fee5aebb181a7e1c9f8a1feb5f472709f37e22eeec290cbb75e3
```

4／6／8 步還會使用前表的 `minimax_h3_turbo_v4_step600_ema.safetensors`；20 步使用原生採樣，不套用 Turbo。兩種模式都由 Studio 自動選取 BFS LoRA，不用再到「額外 LoRA」手動疊加。更新 Studio 程式後請重新啟動 ComfyUI、重新整理網頁，以載入新增的 `/h3-studio/swap/*` API。

模型與範例來源：[BFS H3 模型倉庫](https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI)。模型權重不包含在 Git 倉庫內；使用時須同時遵循各資產授權及 H3 基礎模型條款。

### SeedVR2 影片畫質提升（可選）

兩項合計約 3.7 GiB，放在不同目錄。ComfyUI v0.37.0 已提供工作流所需的 SeedVR2 節點。

| 本機檔名／下載連結 | 用途 | 放置目錄（專案根目錄起算） | 大小 GiB |
|---|---|---|---:|
| [`seedvr2_3b_int8_convrot.safetensors`](https://huggingface.co/Comfy-Org/SeedVR2/resolve/df48879708206a403d2a61acd55578c2e80fd233/diffusion_models/seedvr2_3b_int8_convrot.safetensors) | 畫質提升模型 | `ComfyUI/models/diffusion_models/` | 3.22 |
| [`seedvr2_ema_vae_fp16.safetensors`](https://huggingface.co/Comfy-Org/SeedVR2/resolve/df48879708206a403d2a61acd55578c2e80fd233/vae/seedvr2_ema_vae_fp16.safetensors) | 畫質提升 VAE | `ComfyUI/models/vae/` | 0.47 |

AI 強度大於 0% 才需要這兩個模型。0% 使用 FFmpeg 普通放大，仍需要 FFmpeg／ffprobe。每次最多處理約 15 秒，建議先以 3 秒片段驗證；保留原比例、幀率與聲音，另存新作品，不支援再以 H3 動態延伸。強度混合可以重用已生成的 AI 快取。

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

截至 2026-10-11，最近一次完整測試紀錄是 **27 項、25 通過、2 失敗**，失敗都在 `tests/rendered-html.test.mjs`：

- `keeps Motion Context continuation wiring intact`：仍要求舊的固定「12 秒」降溫文案；目前介面使用可調秒數與動態估算。
- `reuses an exact seed and reports the seed of finished videos`：只接受舊的 `reuseSeed(value: number)`，未接受目前增加的可選 `source` 參數。

這兩個失敗點是過時的原始碼文字斷言，不能據此判定生成或種子功能故障；但失敗後的同一測試其餘斷言未執行，不能宣稱整套驗證通過。修正與完整重跑需另行處理。

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

# 啟動與停止

啟動（會一併帶起 ComfyUI 與介面，並開啟瀏覽器）：

```powershell
.\start_h3_studio.bat
```

介面在 `http://localhost:3000`，ComfyUI API 在 `http://127.0.0.1:8188`。

停止兩個服務：

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
- 語音：依步驟 11 設定金鑰後生成短句；未設定時停用按鈕是正常狀態。

模型存在、API 已連線與 build 成功都不能代替這些實際功能驗證。

---

# 生成佇列與模式

H3 影片與 Qwen 圖片共用佇列：執行中可繼續編輯設定，按「加入佇列」時保存當下的提示詞、圖片與參數。等待任務可移除；失敗保留錯誤並繼續下一筆。Qwen 多張生成是一整筆任務，H3 也會等必要轉檔、合併與設定保存流程結束後才接下一筆。完成後留在目前頁面，作品可到「作品」頁查看。

**佇列保存在目前瀏覽器頁面，不會持久保存。** 重新整理或關閉網頁會失去尚未執行的等待任務；已送到 ComfyUI 的 GPU 工作可能繼續，但瀏覽器負責的後處理／metadata 保存可能中斷。請等整筆完成再關閉頁面。ComfyUI 重啟也不提供任務續跑保證。

右側顯示類型標籤與前約 10 字摘要，移上任務可查看完整提示詞與進度／錯誤；窄視窗時清單放到下方。H3「生成圖片」、SeedVR2 畫質提升與 Gemini TTS 不屬於這個共用佇列。

| H3 模式 | 目前行為 |
|---|---|
| 4步／6步／8步 | 相同 Turbo 模型與採樣方式，差別是步數；每步都依介面秒數降溫，包含最後一步 |
| QUALITY | 原生 20 步、FP16 影片 VAE，每步降溫 |
| 安全長片 | Turbo 6 步、LoRA merge、低解析生成與分塊解碼，再以 CPU 放大成 480P；不支援 H3 動態延伸 |

參考生影片提供 4步／6步／8步，使用 Ref2VA W4A8／LongMedia 流程。COOLED FAST 與低顯存已從新任務選單移除，但仍保留舊作品設定的讀取相容性。H3 降溫預設 15 秒、最低 5 秒；Qwen 預設 0 秒，可自行增加，且跳過最後一步後的暫停。

---

# 影片換角（BFS）

創作頁的模式排列為「參考生影片 → **影片換角** → 影片畫質提升」。此功能共用 H3／Qwen 的生成佇列，不是一般參考圖生影片，也不是在首尾圖工作流直接掛上換角 LoRA。

| 替換範圍 | 參考圖提供的內容 | 目標保留的原片內容 |
|---|---|---|
| 換頭 | 臉部、頭型與髮型 | 身體、服裝、動作、鏡頭與背景 |
| 整個角色替換 | 人物外貌、髮型、身形、服裝與畫風 | 動作、鏡頭與場景，以及未指定替換的其他人物 |

## 操作

1. 選「影片換角」，再選「換頭」或「整個角色替換」。
2. 點選或拖入來源影片：接受 MP4／MOV／WebM，上限 **1 GB**。介面會顯示原片尺寸、時長與預計段數。
3. 點選或拖入 PNG／JPEG／WebP 參考圖，上限 **32 MB**。換頭建議使用含完整髮型的頭部近照，可按「裁切」排除設定稿中的其他身形或服裝圖；裁切不會修改原始檔。
4. 多人影片可在「要替換的人物」填入位置或衣著描述。系統會帶入對應的預設提示詞，可自行修改；切換替換範圍會重新套用該模式的預設。
5. 步數可選 **4／6／8 步 Turbo** 或 **20 步原生**；解析度與參考生影片相同，提供 **480P／540P／原生 H3**。預設為換頭、20 步、480P、LoRA 強度 1.0；種子留白時隨機。
6. 畫面比例自動跟隨來源影片，不提供手動比例選單。H3 生成畫布需對齊 32 像素，輸出會補正播放比例；輸出幀率統一為 **24 fps**，並合回來源音軌，不沿用原片的任意幀率。
7. 按「加入生成佇列」。每步降溫預設 15 秒、最低 5 秒，最後一步不暫停。完成後可在本頁預覽、下載，也會加入「作品」頁；「再做一次」會載回來源、參考圖與生成設定。

來源影片透過 **Add Guide** 提供對齊的影片引導，角色圖走 Ref2VA 圖片參考。15 秒以內整段一次生成；超過 15 秒則按約 15 秒分段，最後一段依剩餘時長生成。模型要求的補齊幀會在合併時裁除，正常完成後以原片時長為準。

生成中可按「**完成目前這段後停止**」：目前已提交的段落仍會完成，之後不再提交新段，已完成部分會合併並保留相應的原音軌。若後續段落失敗，也會嘗試保留先前完成的部分。若尚無完成片段，就不會產生成品。

## 限制與驗證範圍

- 換角會重新生成畫面，不能保證其他區域逐像素不變；小臉、遮擋、快速動作、切鏡與長片可能造成身分、表情或動作漂移。分段接縫處也可能出現人物或光線不連續。
- 已完成本機換頭的原生 20 步與 Turbo 8 步短片生成；這不代表兩種替換模式、全部步數、全部解析度及長片都經過完整實測。原生 H3 解析度的長片更吃顯存，12 GB 顯卡建議先選 480P。
- 原音軌會合回成品，但不代表模型能精準保留口型同步。來源與角色圖只送往本機 ComfyUI。
- 佇列與分段後處理由目前網頁維持，請等整筆任務完成後再重新整理或關閉頁面。來源與參考圖快取若已刪除，「再做一次」需重新上傳。

---

# ORB360 環繞提示詞（可選）

新增 `minimax_h3_orb360_step1500.safetensors` 對應的環繞提示詞功能：描述人物與場景保持靜止，只有攝影機順時針環繞一圈，再回到起始視角。此功能提供提示詞模板，實際生成是否完成一圈仍需檢查成品。

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

**目前 Studio 的 V1 載入問題尚未修正，以上操作僅完成設定，不能視為 LoRA 已生效。** 2026-10-13 以相同 prompt、seed、6 步生成有／無 V1 的對照，兩段原片的畫面與音訊雜湊完全相同。唯讀診斷確認：V1 權重已有 `diffusion_model.` 前綴，額外 LoRA 使用的 `MiniMaxH3TurboLoRA` 節點又加了一次，導致 200 組 adapter 指向 `diffusion_model.diffusion_model.…`，無法匹配模型權重。需修正載入方式並重新驗證後，才能評估 V1 @ 0.5 的效果。

---

# 語音生成（Gemini TTS）

在雲端執行，不佔本機 GPU。需要先完成步驟 11。

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
│  ├─ lib/enhance.ts                ← SeedVR2 工作流與畫質混合
│  ├─ lib/generation-queue.ts       ← 瀏覽器內共用佇列
│  └─ tests/
├─ integrations/
│  └─ ComfyUI-H3-Studio/            ← Studio 自有的 ComfyUI 節點
│     ├─ __init__.py
│     ├─ h3_studio_api.py           ← /h3-studio/* API 路由
│     ├─ h3_studio_tts.py           ← Gemini TTS 請求、驗證與試聽快取
│     ├─ h3_studio_enhance.py       ← 影片準備、混合與畫質提升 API
│     ├─ h3_cooled_turbo_sampler.py ← 兩個降溫用採樣節點
│     └─ h3_prompt_output_schema.json
├─ workflows/                       ← 五個 12GB 顯存 workflow JSON
├─ start_h3_studio.bat
├─ start_comfyui_h3.bat
├─ stop_h3_studio.bat
├─ H3_BENCHMARK.md                  ← 實測數據
├─ H3_INSTALL_RESULT.md             ← 安裝結果紀錄
│
├─ ComfyUI/                         ← 不納入 Git，自行安裝
│  ├─ custom_nodes/
│  │  └─ ComfyUI-H3-Studio ─────────→ junction 指向 integrations/
│  └─ models/                       ← 模型放這裡
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

# 疑難排解

**作品列表空白、優化按鈕失敗、生成找不到節點**
junction 沒建好。回到步驟 6，並確認 ComfyUI 主控台有 `ComfyUI-H3-Studio` 的載入紀錄。

**生成極慢，GPU 使用率卻很低**
記憶體不足導致權重被換出到硬碟。關掉瀏覽器分頁與其他吃記憶體的程式，重啟 ComfyUI 釋放快取模型。若專案放在外接硬碟，搬到內接 NVMe。

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

---

# 授權

MIT License，見 `LICENSE`。

本倉庫不含模型權重。各模型與第三方節點依其原始授權條款使用。
