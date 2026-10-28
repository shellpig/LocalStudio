// UI smoke test with mocked ComfyUI APIs; no GPU jobs are submitted.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium, expect } = require(process.env.PLAYWRIGHT_MODULE || "playwright/test");
const temp = await mkdtemp(join(tmpdir(), "h3-swap-ui-"));
const videoPath = join(temp, "source.mp4");
const untmods = process.env.H3_SWAP_MODE === "untmods-face";
const mode = untmods ? "untmods-face" : "akatz-v1.5";
const steps = untmods ? 8 : 20;
const label = untmods ? "UntMods FaceSwap 臉部替換" : "Akatz V1.5 整個角色替換";
const lora = untmods ? "SS_FaceSwap_MiniMax_H3_REF2VA.safetensors" : "h3_character_swap_v1.5.safetensors";
const turbo = "minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors";
let browser;
try {
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=128x128:rate=24", "-t", "1", "-c:v", "libx264", videoPath]);
  const video = await readFile(videoPath);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const image = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 128; canvas.height = 128;
    return canvas.toDataURL("image/png").split(",")[1];
  }), "base64");
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let settings, graph, finished = false;
  const work = { filename: "swap.mp4", subfolder: "video", type: "output", kind: "video", swapMode: mode, swapSource: "source.mp4", swapSourceFile: "h3_swap/source.mp4", swapReferenceFile: "h3_swap/reference.png", swapStrength: 0.8, swapTarget: "the woman", swapCompletedSegments: 1, swapTotalSegments: 1, prompt: `Saved ${mode} prompt`, profile: untmods ? "cooled-turbo-8" : "quality", resolution: "p480", steps, width: 480, height: 480, duration: 1, cooldownSeconds: 5, seed: 42, sound: false };
  await page.route("http://127.0.0.1:8188/**", async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname;
    const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST,GET,OPTIONS" };
    const reply = (json) => route.fulfill({ json, headers });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (path === "/system_stats") return reply({ devices: [] });
    if (path === "/h3-studio/outputs") return reply({ outputs: finished ? [work] : [] });
    if (path === "/view") return route.fulfill({ body: req.url().includes(".png") ? image : video, contentType: req.url().includes(".png") ? "image/png" : "video/mp4", headers });
    if (path.startsWith("/object_info")) return reply({ LoraLoaderModelOnly: { input: { required: { lora_name: [[lora, ...(untmods ? [turbo] : [])]] } } } });
    if (path === "/h3-studio/swap/prepare") {
      const body = req.postDataBuffer().toString();
      settings = JSON.parse(body.split('name="settings"\r\n\r\n')[1].split("\r\n")[0]);
      assert.equal(settings.mode, mode); assert.equal(settings.steps, steps);
      return reply({ sourceId: "a".repeat(32), referenceFile: "reference.png", width: 128, height: 128, segments: [{ inputFile: "guide.mp4", keepFrames: 24, length: 39 }] });
    }
    if (path === "/prompt") {
      graph = req.postDataJSON().prompt;
      assert.equal(graph["2"].inputs.lora_name, lora);
      assert.deepEqual(graph["13"].inputs["ref_videos.ref_video_0"], ["12", 0]);
      assert.equal(graph["14"], undefined);
      if (untmods) assert.equal(graph["25"].inputs.lora_name, turbo);
      else assert.equal(graph["25"], undefined);
      return reply({ prompt_id: "swap-ui" });
    }
    if (path === "/history/swap-ui") return reply({ "swap-ui": { status: { completed: true }, outputs: { "24": { images: [{ filename: `${"a".repeat(32)}_seg0_00001_.mp4`, subfolder: "h3_swap_cache", type: "output" }] } } } });
    if (path === "/h3-studio/swap/finish") { finished = true; return reply(work); }
    return reply({});
  });
  await page.goto("http://localhost:3000");
  await expect(page.getByText("本機 H3 已連線", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "影片換角", exact: true }).click();
  const panel = page.getByRole("region", { name: "影片換角設定" });
  const stepSelect = panel.getByRole("combobox", { name: /^步數/ });
  await stepSelect.selectOption("8");
  await panel.getByLabel("換角模式").selectOption(mode);
  await expect(stepSelect).toHaveValue(String(steps));
  assert.deepEqual(await stepSelect.locator("option").evaluateAll((options) => options.map((option) => option.value)), untmods ? ["8", "20"] : ["20"]);
  await expect(panel.getByLabel("LoRA 強度")).toHaveValue("1");
  await expect(panel.getByRole("textbox", { name: "提示詞", exact: true })).toHaveValue(/<Video 1>/);
  if (untmods) await expect(panel.getByRole("textbox", { name: "提示詞", exact: true })).toHaveValue(/^Faceswap\./);
  await panel.getByLabel("換角模式").selectOption("character");
  assert.equal(await stepSelect.locator("option").count(), 4);
  await panel.getByLabel("換角模式").selectOption(mode);
  await panel.locator('input[type="file"]').nth(0).setInputFiles({ name: "source.mp4", mimeType: "video/mp4", buffer: video });
  await panel.locator('input[type="file"]').nth(1).setInputFiles({ name: "reference.png", mimeType: "image/png", buffer: image });
  await expect(panel.getByRole("button", { name: "加入生成佇列", exact: true })).toBeEnabled();
  await panel.getByRole("button", { name: "加入生成佇列", exact: true }).click();
  await expect(panel.getByRole("heading", { name: `${label} · 1.00 秒`, exact: true })).toBeVisible();
  assert(settings && graph && finished);
  await page.getByRole("button", { name: /作品$/ }).click();
  await expect(page.getByText(`${label} · ${steps} 步 · 1／1 段`, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "swap.mp4 影片操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "再做一次", exact: true }).click();
  await expect(panel.getByLabel("換角模式")).toHaveValue(mode);
  await expect(stepSelect).toHaveValue(String(steps));
  await expect(panel.getByRole("textbox", { name: "提示詞", exact: true })).toHaveValue(work.prompt);
  await expect(panel.getByLabel("LoRA 強度")).toHaveValue("0.8");
  await expect(panel.getByLabel("種子（留白隨機）")).toHaveValue("42");
  if (process.env.H3_SWAP_SCREENSHOT) await page.screenshot({ path: process.env.H3_SWAP_SCREENSHOT, fullPage: true });
  assert.deepEqual(errors, []);
  console.log(`PASS: ${mode} switching, supported steps, queued submission, result labels and redo restoration`);
} finally {
  if (browser) await browser.close();
  await unlink(videoPath).catch(() => {});
  await rmdir(temp);
}
