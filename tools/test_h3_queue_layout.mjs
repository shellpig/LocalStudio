// UI-only regression: simulate queued jobs without sending any GPU work.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium, expect } = require(process.env.PLAYWRIGHT_MODULE || "playwright/test");
const browser = await chromium.launch({ headless: true });
const views = ["創作影片", "圖像編輯", "語音生成"];
const report = [];
const reply = (route, json) => route.fulfill({ json, headers: { "Access-Control-Allow-Origin": "*" } });
try {
  for (const width of [1920, 1880, 1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let completed = false;
    const voice = "synthetic_test_voice_00001_.safetensors";
    await page.route("**/system_stats", (route) => reply(route, { devices: [] }));
    await page.route("**/history?*", (route) => reply(route, {}));
    await page.route("**/h3-studio/outputs", (route) => reply(route, { outputs: [] }));
    await page.route("**/h3-studio/drama3/status", (route) => reply(route, { ready: true, voices: [voice], activeJob: null }));
    await page.route("**/h3-studio/drama3/jobs**", (route) => {
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: {
        "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
      } });
      if (route.request().method() === "POST") assert.equal(route.request().postDataJSON().operation, "previewVoice");
      return reply(route, { id: "layout-test", operation: "previewVoice", status: completed ? "completed" : "running", message: "Layout test" });
    });
    await page.route("**/prompt", () => { throw new Error("Layout test must not submit GPU work"); });
    await page.goto("http://localhost:3000");
    await expect(page.getByText("本機 H3 已連線", { exact: true })).toBeVisible();
    const nav = page.getByRole("complementary", { name: "主選單" });
    const box = async () => {
      const rect = await page.locator(".studio-editor").boundingBox();
      return { x: rect.x, y: rect.y, width: rect.width };
    };
    const baseline = {};
    for (const view of views) {
      await nav.getByRole("button", { name: view, exact: false }).click();
      baseline[view] = await box();
    }
    await expect(page.getByText("Drama3 已連線", { exact: true })).toBeVisible();
    await page.getByLabel("角色 1 聲線", { exact: true }).selectOption(voice);
    await page.getByRole("button", { name: "試聽角色一聲線", exact: true }).click();
    const panel = page.locator("#generation-queue-panel");
    await expect(panel).toHaveCount(1);
    assert.deepEqual(await box(), baseline["語音生成"], `editor shifted at ${width}px`);
    if (width >= 1880) {
      await expect(panel).toBeVisible();
      await expect(page.locator(".queue-toggle")).toBeHidden();
      const content = await page.getByRole("region", { name: "角色聲線" }).boundingBox();
      const queue = await panel.boundingBox();
      assert(queue.x >= content.x + content.width + 20, "wide queue must fit in the right margin");
    } else {
      const toggle = page.locator(".queue-toggle");
      await expect(panel).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      assert.deepEqual(await box(), baseline["語音生成"]);
      const queue = await panel.boundingBox();
      assert(queue.x >= 0 && queue.x + queue.width <= width);
      await page.getByRole("button", { name: "收合", exact: true }).click();
      await expect(panel).toBeHidden();
      await expect(toggle).toBeFocused();
      await toggle.click();
      await panel.locator(".queue-summary").focus();
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expect(page.getByRole("tooltip")).toHaveCount(0);
    }
    for (const view of views) {
      await nav.getByRole("button", { name: view, exact: false }).click();
      assert.deepEqual(await box(), baseline[view], `${view} shifted with a queue at ${width}px`);
    }
    completed = true;
    await expect(panel).toHaveCount(0, { timeout: 10000 });
    assert.deepEqual(await box(), baseline["語音生成"], `editor shifted when queue finished at ${width}px`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    const screenshot = path.join(os.tmpdir(), `h3-queue-layout-${width}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    assert.deepEqual(errors, []);
    report.push({ width, editorUnchanged: true, views, screenshot });
    await page.close();
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
