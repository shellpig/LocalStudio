// Live acceptance: dedicated Playwright Chromium only; leaves a reusable demo voice and audio.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium, expect } = require(process.env.PLAYWRIGHT_MODULE || "playwright/test");
const artifact = await fs.mkdtemp(path.join(os.tmpdir(), "h3-drama3-ui-"));
const existing = process.argv.includes("--existing");
let audioUrl, duration;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://localhost:3000");
  await expect(page.getByText("本機 H3 已連線", { exact: true })).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "語音生成", exact: false }).click();
  await expect(page.getByText("Drama3 已連線", { exact: true })).toBeVisible({ timeout: 15000 });
  console.log("Drama3 UI connected");
  if (!existing) {
  await page.getByLabel("角色 1 名稱", { exact: true }).fill("Alex");
  await page.getByLabel("角色 2 名稱", { exact: true }).fill("Robin");

  await page.getByText("新增聲線 · 上傳參考音訊", { exact: true }).click();
  await page.getByLabel("參考音訊", { exact: true }).setInputFiles(process.env.DRAMA3_TEST_REFERENCE || fileURLToPath(new URL("../services/Drama3/ComfyUI/input/drama3_synthetic_reference.mp3", import.meta.url)));
  await page.getByLabel("辨識語言", { exact: true }).selectOption("English");
  await page.getByRole("button", { name: "辨識逐字稿", exact: true }).click();
  console.log("Reference transcription queued");
  await expect(page.getByLabel("參考逐字稿", { exact: true })).not.toHaveValue("", { timeout: 300000 });
  const transcript = await page.getByLabel("參考逐字稿", { exact: true }).inputValue();
  assert(transcript.trim().length >= 10, "ASR must return a nonempty transcript of the reference clip");
  console.log("Reference transcript:", transcript);
  await page.getByLabel("聲線名稱", { exact: true }).fill("Studio_Demo_Alex");
  await page.getByRole("button", { name: "保存聲線並指派", exact: true }).click();
  await expect(page.getByLabel("角色 1 聲線", { exact: true })).not.toHaveValue("", { timeout: 300000 });
  console.log("Demo voice saved");
  await page.getByText("新增聲線 · 上傳參考音訊", { exact: true }).click();
  await page.getByLabel("角色 2 聲線", { exact: true }).selectOption("xiaowu_young_gemini_reference_00001_.safetensors");
  await page.getByLabel("第 1 段台詞", { exact: true }).fill("Hello, I am Alex.");
  await page.getByLabel("第 2 段台詞", { exact: true }).fill("Hi Alex, I am Robin.");

  await page.getByRole("button", { name: "＋ 新增台詞", exact: true }).click();
  await page.getByLabel("第 3 段台詞", { exact: true }).fill("This is the third line.");
  await page.getByRole("button", { name: "上移第 3 段", exact: true }).click();
  await expect(page.getByLabel("第 2 段台詞", { exact: true })).toHaveValue("This is the third line.");
  await page.locator(".drama3-line").nth(1).getByRole("button", { name: "移除", exact: true }).click();
  await expect(page.getByLabel("第 2 段台詞", { exact: true })).toHaveValue("Hi Alex, I am Robin.");

  await page.getByText("進階生成設定", { exact: true }).click();
  await page.locator(".drama3-page").getByLabel("種子（留白隨機）", { exact: true }).fill("424242");
  await page.getByLabel("每個文字區塊上限（秒）", { exact: true }).fill("15");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(artifact, "dialogue-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "加入佇列 · 生成多人對話", exact: true }).click();
  console.log("Two-speaker generation queued");
  await expect(page.getByRole("heading", { name: "對話成品", exact: true })).toBeVisible({ timeout: 900000 });
  const outputAudio = page.locator(".drama3-page audio");
  await expect.poll(async () => outputAudio.evaluate((audio) => Number.isFinite(audio.duration) && audio.duration > 0), { timeout: 15000 }).toBe(true);
  audioUrl = await outputAudio.getAttribute("src");
  duration = await outputAudio.evaluate((audio) => audio.duration);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(artifact, "dialogue-completed.png"), fullPage: true });
  }
  const outputs = await (await page.request.get("http://127.0.0.1:8188/h3-studio/outputs")).json();
  const result = outputs.outputs.find((item) => item.model === "drama3" && item.seed === 424242);
  assert(result && result.drama3.roles.length === 2);
  assert.equal(result.drama3.lines[1].text, "Hi Alex, I am Robin.");

  await page.getByRole("button", { name: "作品", exact: false }).first().click();
  await page.getByRole("tab", { name: /^聲音/ }).click();
  const card = page.locator(".audio-card").filter({ hasText: result.filename });
  await expect(card).toBeVisible();
  await expect.poll(async () => card.locator("audio").evaluate((audio) => Number.isFinite(audio.duration) && audio.duration > 0), { timeout: 15000 }).toBe(true);
  audioUrl = await card.locator("audio").getAttribute("src");
  duration = await card.locator("audio").evaluate((audio) => audio.duration);
  await card.getByRole("button", { name: "再做一次", exact: true }).click();
  await expect(page.getByLabel("角色 2 名稱", { exact: true })).toHaveValue("Robin");
  await expect(page.getByLabel("第 1 段台詞", { exact: true })).toHaveValue("Hello, I am Alex.");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(artifact, "dialogue-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(artifact, "dialogue-mobile.png"), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ artifact, audioUrl, duration, result, errors }, null, 2));
} finally {
  await browser.close();
}
