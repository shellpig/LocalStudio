# H3 Local Studio

Windows 本機版 MiniMax H3 影片製作介面。前端是一個網頁介面，實際生成交給本機的 ComfyUI 執行，全程不經過雲端。唯一的例外是可選的「語音生成」頁，它會把文字送到 Google Gemini API。

## 功能

- 文字轉影片（T2VA）
- 首尾圖轉影片（I2VA / FL2VA / L2VA）
- 參考圖轉影片（Ref2VA），最多 9 個參考項目，每項可設圖片、`@標籤` 與說明
- 影片延伸：沿用原本的人物與場景，接續前一段的最後畫面，裁掉重疊幀後合併
- 官方 H3 Prompt 優化：把一句白話描述改寫成 MiniMax 官方格式，可選 Codex 或 Grok 執行
- 圖像編輯（Qwen-Image 2.1）：文字生圖，或上傳最多 4 張圖後用一句指令編輯，支援 7 種比例與 2K
- 語音生成（Gemini 3.8 TTS，雲端，可選）：文字轉 WAV，30 個預設聲線加上可搜尋、試聽的 Google 聲線庫
- 作品列表、刪除、下載，並保存生成設定 metadata

---

# 這個倉庫不包含什麼

**這一節最重要。** 倉庫只有約 45 個原始碼檔案，總共不到 1 MB。要能實際生成影片，還需要自行準備下列東西，合計約 **54 GB 的模型**與數 GB 的執行環境。

| 缺少的東西 | 大小 | 為什麼不在倉庫裡 |
|---|---:|---|
| ComfyUI 本體 | 約 1 GB | 上游專案，另行 clone |
| 四個第三方 ComfyUI 節點 | 約 50 MB | 各自有 repo 與授權 |
| Python 虛擬環境 `.venv` | 約 8 GB | 含 PyTorch 與 CUDA 套件 |
| 七個模型檔 | **54.2 GB** | 體積過大 |
| `h3-local-studio/node_modules` | 約 300 MB | 由 `npm install` 產生 |
| FFmpeg | 約 150 MB | 系統層工具 |
| Codex 或 Grok CLI | 小 | 需個人帳號登入 |
| Gemini API 金鑰 | — | 個人憑證，只放在環境變數（見步驟 11） |
| `h3-prompt-writing` skill | 小 | **內容來自 MiniMax 官方文件，授權不同，需自行取得**（見步驟 10） |

倉庫本身只有：Studio 前端原始碼、ComfyUI 整合節點、五個 workflow JSON、啟動腳本與文件。

---

# 安裝

以下每一步都可以驗證。照順序做，不要跳。

## 步驟 0：硬體與系統需求

| 項目 | 需求 | 開發機實測值 |
|---|---|---|
| 作業系統 | Windows 10 / 11 | Windows 11 |
| GPU | NVIDIA，**VRAM 12 GB 以上** | RTX 4080 Laptop 12 GB |
| 系統 RAM | **32 GB 以上** | 32 GB |
| 硬碟空閒空間 | 70 GB 以上 | — |
| NVIDIA 驅動 | 支援 CUDA 13.0 | 591.86 |

**RAM 提醒：** 模型權重合計約 40 GB，超過 32 GB 實體記憶體。系統會把記憶體對映的權重換出，取樣時再從硬碟讀回。**強烈建議把整個專案放在內接 NVMe，不要放在 USB 外接硬碟。** 放外接碟時實測讀取延遲會達到 300 毫秒，GPU 使用率掉到 20% 以下，生成時間會從 1 分鐘變成 10 分鐘以上。

## 步驟 1：取得倉庫

```powershell
git clone https://github.com/shellpig/LocalStudio.git MinimaxH3
cd MinimaxH3
```

以下所有指令都在這個根目錄執行。文件中的 `<專案根目錄>` 就是這裡。

## 步驟 2：建立 Python 環境

需要 **Python 3.11**。

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
```

安裝 PyTorch（CUDA 13.0 版）：

```powershell
.\.venv\Scripts\python.exe -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu130
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

`v0.37.0` 是實測通過的版本，也是圖像編輯頁需要的最低版本（Qwen-Image 2.1 節點從這版開始內建）。只做 H3 影片的話 `62b3c94b`（v0.31.0-15）也可以。較新的版本通常也可以，但沒有驗證過。

## 步驟 4：安裝加速套件

```powershell
.\.venv\Scripts\python.exe -m pip install triton-windows
.\.venv\Scripts\python.exe -m pip install sageattention
```

驗證沒有相依衝突：

```powershell
.\.venv\Scripts\python.exe -m pip check
```

## 步驟 5：安裝第三方 ComfyUI 節點

```powershell
cd ComfyUI\custom_nodes
git clone https://github.com/Larryvrh/ComfyUI-MiniMax-H3-Turbo.git
git clone https://github.com/NikoDemon80/ComfyUI-H3-Motion-Context.git
git clone https://github.com/vizart-vj/ComfyUI-MiniMax-H3-LongMedia.git
git clone https://github.com/kijai/ComfyUI-KJNodes.git
cd ..\..
```

實測通過的版本：

| 節點 | 版本 |
|---|---|
| ComfyUI-MiniMax-H3-Turbo | 1.2.3 |
| ComfyUI-H3-Motion-Context | 0.2.0 |
| ComfyUI-MiniMax-H3-LongMedia | 0.3.11 |
| ComfyUI-KJNodes | commit `073efb0` |

若節點有自己的 `requirements.txt`，用專案 venv 安裝：

```powershell
.\.venv\Scripts\python.exe -m pip install -r ComfyUI\custom_nodes\ComfyUI-KJNodes\requirements.txt
```

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

**跳過這一步的後果：** ComfyUI 不會註冊十二組 `/h3-studio/*` API 路由，也不會有 `H3CooledSampler` 與 `H3CooledTurboSampler` 兩個節點。Studio 介面會顯示連線正常，但作品列表是空的、優化按鈕會失敗、生成會因為找不到節點而中斷。

## 步驟 7：下載模型

共七個檔案，**合計 54.2 GB**。請放到下列**確切**的目錄：

| 檔案 | 放置目錄 | 大小 |
|---|---|---:|
| `minimax_h3_fl2va_pruned_int8_convrot.safetensors` | `ComfyUI\models\diffusion_models\` | 19.53 GB |
| `minimax_h3_ref2va_pruned_w4a8_mixed.safetensors` | `ComfyUI\models\diffusion_models\` | 10.96 GB |
| `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | `ComfyUI\models\text_encoders\` | 14.61 GB |
| `minimax_h3_video_vae_fp16.safetensors` | `ComfyUI\models\vae\` | 4.85 GB |
| `minimax_h3_video_vae_int8_convrot.safetensors` | `ComfyUI\models\vae\` | 2.95 GB |
| `minimax_h3_audio_vae_fp32.safetensors` | `ComfyUI\models\vae\` | 0.56 GB |
| `minimax_h3_turbo_v4_step600_ema.safetensors` | `ComfyUI\models\loras\` | 0.73 GB |

檔名必須完全一致，程式碼是以檔名載入的。

來源：

- **官方基線模型**（前四項與 audio VAE）：依 ComfyUI 官方 H3 教學下載
  <https://docs.comfy.org/tutorials/video/minimax/minimax-h3>
- **INT8 ConvRot Video VAE**：<https://huggingface.co/Kijai/MiniMax-H3-experimental>
  SHA-256 `9bb2d96f218c76babd85e0611b85ca8fb330a90546c01a0005e8a58a59593410`
- **Turbo LoRA**：<https://huggingface.co/larryvrh/MiniMax-H3-Turbo-Lora>
  SHA-256 `5f3a626cd72c93a8b9318d6760c510bc5092d2ab13aaba1f932c5bab07a416d3`

`minimax_h3_ref2va_pruned_w4a8_mixed.safetensors` 只有參考圖模式會用到。不做 Ref2VA 可以先不下載，省 11 GB。

### 圖像編輯（Qwen-Image 2.1，可選）

只有「圖像編輯」頁會用到，三個檔案**合計 16.1 GB**，同樣以檔名載入：

| 檔案 | 放置目錄 | 大小 |
|---|---|---:|
| `qwen_image_2.1_int8_convrot.safetensors` | `ComfyUI\models\diffusion_models\` | 6.76 GB |
| `qwen3vl_8b_int8_convrot.safetensors` | `ComfyUI\models\text_encoders\` | 8.71 GB |
| `qwen_image_2.1_vae_bf16.safetensors` | `ComfyUI\models\vae\` | 0.63 GB |

來源：<https://huggingface.co/Comfy-Org/Qwen-Image-2.1>（各自在 `diffusion_models/`、`text_encoders/`、`vae/` 子目錄）。
官方教學：<https://docs.comfy.org/zh/tutorials/image/qwen/qwen-image-2-1>。

官方教學預設的文字編碼器是 `qwen3vl_8b_bf16.safetensors`（16.3 GB）；這裡改用 int8 版以配合 12 GB 顯存與 32 GB 記憶體，也是 ComfyUI 內建範本使用的檔案。

驗證檔案都到位：

```powershell
Get-ChildItem ".\ComfyUI\models" -Recurse -Filter *.safetensors | Select-Object Name, @{n='GB';e={[math]::Round($_.Length/1GB,2)}}
```

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

需要 **Node.js 22.13.0 以上**（開發機為 v24.15.0）。

```powershell
cd h3-local-studio
npm install
cd ..
```

驗證：

```powershell
cd h3-local-studio; npm test; cd ..
```

六個測試應全數通過。

## 步驟 10：Prompt 優化引擎（可選）

只有「官方 H3 Prompt 優化」這個按鈕會用到。不裝的話其他功能都正常，只是按下去會回錯誤。

支援兩個引擎，**裝其中一個就好**，介面上可以切換。

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

需要 **SuperGrok 或 X Premium+ 訂閱**。免費帳號可以登入，但額度大約十幾次呼叫就會用盡，之後會回「usage limit」錯誤。

驗證：

```powershell
codex --version
grok models
```

### `h3-prompt-writing` skill（兩個引擎都需要）

優化功能依賴一個名為 `h3-prompt-writing` 的 skill，內容是 MiniMax 官方的 prompt 撰寫格式指南。

**這個 skill 不包含在本倉庫內，需要你自行取得或撰寫。** 它的參考內容來自 MiniMax 官方文件，授權狀況與本專案不同，因此沒有一併發布。請自行從 MiniMax 官方的 prompt 撰寫指南整理，或使用你既有的版本。

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

#### 如果你的 skill 名稱或格式不同，要改哪裡

程式碼與 skill 之間有兩處耦合，都在
`integrations\ComfyUI-H3-Studio\h3_studio_api.py`。

**一、skill 名稱**寫在送給 CLI 的指令文字裡，共兩處：

| 行號 | 內容 | 適用模式 |
|---|---|---|
| 264 | `Use the $h3-prompt-writing skill and its full-reference guide ...` | Ref2VA |
| 296 | `Use the $h3-prompt-writing skill and its base reference guide ...` | 其他四種模式 |

skill 取別的名字時，把這兩處的 `$h3-prompt-writing` 換成你的名稱。前面的 `$` 是引擎用來指名 skill 的寫法，要保留。

**二、輸出欄位名稱**由驗證函式 `validate_optimized_prompt()` 強制檢查，位置在第 319 到 321 行：

```python
["subject_definitions:", "summary:", "retention_analysis:",
 "detailed_description:", "overall_soundscape:", "non_diegetic_music:"]   # Ref2VA
["integrated_multimodal_description:", "overall_soundscape:",
 "non_diegetic_music:"]                                                   # 其他模式
```

驗證器會檢查這些欄位**全部存在、順序正確**，並且各模式的開頭字串符合官方格式（例如 I2VA 必須以 `For the target video, at 0.00 seconds` 開頭）。

你的 skill 若產出不同的欄位名稱或順序，優化會失敗並回報
`did not return the official H3 prompt structure`。**這時要改的是驗證器的欄位清單，不是去改 skill 遷就程式碼**——因為這些欄位名稱是 MiniMax H3 模型實際吃的格式，改了會影響生成品質。

另外，第 270 行的指令文字也重述了 Ref2VA 的六個欄位順序。改欄位時三處要一起改，否則指令與驗證會互相矛盾。

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

只開 ComfyUI 不開介面：

```powershell
.\start_comfyui_h3.bat
```

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

在創作頁輸入一段描述，profile 選 FAST、解析度選 safe、長度 5 秒，按生成。第一次會花數分鐘載入模型，之後同樣設定會快很多。

---

# 語音生成（Gemini TTS）

在雲端執行，不佔本機 GPU。需要先完成步驟 11。

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
│  └─ tests/
├─ integrations/
│  └─ ComfyUI-H3-Studio/            ← Studio 自有的 ComfyUI 節點
│     ├─ __init__.py
│     ├─ h3_studio_api.py           ← 十二組 /h3-studio/* API 路由
│     ├─ h3_studio_tts.py           ← Gemini TTS 請求、驗證與試聽快取
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

完整測試紀錄見 `H3_BENCHMARK.md`。

圖像編輯（Qwen-Image 2.1 int8、25 步、每步降溫 3 秒）：

| 設定 | 耗時 | 峰值 VRAM |
|---|---:|---:|
| 文字生圖 1024×1024 | 96 秒 | 10.4 GB |
| 文字生圖 1344×768 | 115 秒 | — |
| 編輯（1 張 1344×768 參考圖） | 136 秒 | 11.3 GB |

每步實際運算不到 1 秒，時間大多是降溫；2K（4 MP）尚未在 12 GB 上實測。

最後一步後不再降溫（直接解碼存圖）。「加速」選 EasyCache 會跳過前後變化很小的步數，較快但細節可能略軟；速度差距尚未在 12 GB 上實測。

---

# 疑難排解

**作品列表空白、優化按鈕失敗、生成找不到節點**
junction 沒建好。回到步驟 6，並確認 ComfyUI 主控台有 `ComfyUI-H3-Studio` 的載入紀錄。

**生成極慢，GPU 使用率卻很低**
記憶體不足導致權重被換出到硬碟。關掉瀏覽器分頁與其他吃記憶體的程式，重啟 ComfyUI 釋放快取模型。若專案放在外接硬碟，搬到內接 NVMe。

**同一個 session 內切換 FAST 與 QUALITY 後變慢**
ComfyUI 會把載入過的模型留在記憶體，兩種 VAE 與有無 LoRA 的模型副本會同時堆著。重啟 ComfyUI 即可。

**Prompt 優化回「usage limit」**
CLI 帳號額度用盡。Grok 免費層級額度很小，需要 SuperGrok 或 X Premium+ 訂閱。

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
