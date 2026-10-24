// Mocked UI acceptance; dedicated Chromium only, no real GPU submission.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
const require = createRequire(import.meta.url);
const { chromium, expect } = require(process.env.PLAYWRIGHT_MODULE || "playwright/test");
await mkdir(new URL("../work/vosr-studio/", import.meta.url), { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], submitted = [], restored = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const original = { filename: "original.mp4", subfolder: "video", type: "output", kind: "video", width: 608, height: 352, fps: 24 };
  const input = { sourceId: "a".repeat(32), sourceName: "original.mp4", sourceFile: "source.mp4", width: 608, height: 352, fps: 24, duration: 5.167 };
  const product = { filename: "VOSR-output.mp4", subfolder: "video", type: "output", kind: "video", vosrRefined: true, vosrSourceId: input.sourceId, vosrSourceName: input.sourceName, width: 608, height: 352, fps: 24, generationSeconds: 60 };
  let complete = false;
  await page.route("http://127.0.0.1:8188/**", async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname;
    const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST,GET,OPTIONS" };
    const reply = (json) => route.fulfill({ json, headers });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (path === "/system_stats") return reply({ devices: [] });
    if (path === "/h3-studio/outputs") return reply({ outputs: complete ? [product, original] : [original] });
    if (path === "/h3-studio/vosr/status") return reply({ ready: true });
    if (path === "/h3-studio/rtx/prepare") return reply(input);
    if (path === "/h3-studio/vosr/restore") { restored.push(req.postDataJSON()); return reply(input); }
    if (path === "/prompt") { submitted.push(req.postDataJSON()); return reply({ prompt_id: "vosr-ui" }); }
    if (path === "/history/vosr-ui") return reply(complete ? { "vosr-ui": { outputs: { "1": { images: [product] } }, status: { completed: true } } } : {});
    if (path.startsWith("/h3-studio/vosr/progress/")) return reply({ phase: "processing", done: 10, total: 124 });
    if (path === "/view") return route.fulfill({ status: 204, headers });
    return reply({});
  });
  await page.goto("http://localhost:3000");
  await expect(page.getByText("本機 H3 已連線", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "影片畫質提升", exact: true }).click();
  const method = page.getByRole("combobox", { name: "畫質處理方式", exact: true });
  await expect(method).toHaveValue("seedvr2");
  await method.selectOption("vosr");
  await expect(page.getByRole("heading", { name: "VOSR 1× 精修", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "或從 Studio 作品選取", exact: true }).selectOption("video/original.mp4");
  const start = page.getByRole("button", { name: "加入 VOSR 精修佇列", exact: true });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page.getByText("VOSR 精修：10／124 幀", { exact: true }).first()).toBeVisible();
  assert.equal(submitted[0].prompt["1"].class_type, "H3StudioVOSR");
  assert.equal(submitted[0].prompt["1"].inputs.source_id, input.sourceId);
  complete = true;
  await expect(page.getByRole("heading", { name: "VOSR 1× 精修成品", exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByTitle("作品", { exact: true }).click();
  await page.getByRole("button", { name: "VOSR-output.mp4 影片操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "再做一次", exact: true }).click();
  await expect(method).toHaveValue("vosr");
  await expect.poll(() => restored.length).toBe(1);
  assert.equal(restored[0].sourceId, input.sourceId);
  await expect(start).toBeEnabled();
  await expect(page.getByLabel("VOSR來源預覽")).toHaveAttribute("src", /h3_rtx%2Faaaaaaaa/);
  await page.getByTitle("作品", { exact: true }).click();
  await page.getByRole("button", { name: "original.mp4 影片操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "VOSR 精修", exact: true }).click();
  await expect(method).toHaveValue("vosr");
  await expect(start).toBeEnabled();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByLabel("VOSR精修設定", { exact: true }).screenshot({ path: `E:/AI_Work/projects/MinimaxH3/work/vosr-studio/ui-${width}.png` });
    const bounds = await start.boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
  }
  assert.deepEqual(errors, []);
  console.log("VOSR UI passed: method selection, queue/progress, result, source action, redo original, desktop/mobile.");
} finally { await browser.close(); }
