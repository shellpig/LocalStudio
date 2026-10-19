// UI-only: intercept every ComfyUI request; submit no GPU work.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium, expect } = require(process.env.PLAYWRIGHT_MODULE || "playwright/test");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const graphs = [], saved = [], errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const tiny = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 480; canvas.height = 640;
    return canvas.toDataURL("image/png").split(",")[1];
  }), "base64");
  await page.route("http://127.0.0.1:8188/**", async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname;
    const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST,GET,OPTIONS" };
    const reply = (json) => route.fulfill({ json, headers });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (path === "/system_stats") return reply({ devices: [] });
    if (path === "/h3-studio/outputs") return reply({ outputs: saved });
    if (path === "/upload/image") return reply({ name: "first.png" });
    if (path === "/view") return route.fulfill({ body: tiny, contentType: "image/png", headers });
    if (path === "/prompt") {
      graphs.push(req.postDataJSON().prompt);
      return reply({ prompt_id: `attention-ui-${graphs.length}` });
    }
    if (path.startsWith("/history/")) {
      const id = path.split("/").pop();
      return reply({ [id]: { status: { completed: true }, outputs: { out: { videos: [{ filename: `${id}.mp4`, subfolder: "video", type: "output" }] } } } });
    }
    if (path === "/h3-studio/output-metadata") { saved.unshift(req.postDataJSON()); return reply({ ok: true }); }
    return reply({});
  });
  await page.goto("http://localhost:3000");
  await expect(page.getByText("本機 H3 已連線", { exact: true })).toBeVisible();
  const attention = page.getByRole("combobox", { name: "注意力（影片）", exact: true });
  await expect(attention).toHaveValue("sage");
  await page.getByRole("button", { name: "首尾圖生影片", exact: true }).click();
  await page.locator("#first-frame-upload").setInputFiles({ name: "first.png", mimeType: "image/png", buffer: tiny });
  await expect(page.locator(".setting-note")).toContainText("首圖 480 × 640");
  await page.getByRole("combobox", { name: "模式", exact: true }).selectOption("cooled-turbo-8");
  await page.getByRole("combobox", { name: "解析度", exact: true }).selectOption("p480");
  await page.getByLabel("影片描述", { exact: true }).fill("An adult person lowers a phone and waves.");
  await page.getByLabel("生成種子", { exact: true }).fill("42");
  for (const method of ["sol", "sage"]) {
    await attention.selectOption(method);
    await page.getByRole("button", { name: "生成影片", exact: false }).last().click();
    await expect.poll(() => saved.length).toBe(method === "sol" ? 1 : 2);
    assert.equal(saved[0].attentionMethod, method);
    const graph = graphs.at(-1);
    assert.equal(graph["9"].inputs.steps, 8);
    assert.equal(graph["15"].inputs.noise_seed, 42);
    assert.equal(graph["119"].class_type, method === "sol" ? "ModelAttentionBackend" : "MiniMaxH3MemoryEfficientSageAttentionPatch");
    if (method === "sol") assert.equal(graph["118"].inputs["selection.tau"], 1.3);
  }
  await page.getByRole("button", { name: "參考生影片", exact: true }).click();
  await expect(attention).toBeDisabled();
  await expect(attention).toHaveValue("sage");
  await expect(page.locator(".setting-note")).toContainText("LongMedia");
  await page.getByRole("button", { name: "首尾圖生影片", exact: true }).click();
  await expect(attention).toBeEnabled();
  await page.getByRole("button", { name: "attention-ui-1.mp4 影片操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "再做一次", exact: true }).click();
  await expect(attention).toHaveValue("sol");
  await expect(page.getByLabel("生成種子", { exact: true })).toHaveValue("42");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator(".video-face-footer").screenshot({ path: `E:/AI_Work/projects/MinimaxH3/work/attention-ab-20261019/studio-ui-${width}.png` });
    const bounds = await attention.boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    assert(bounds.width >= 185, "attention option must remain readable");
  }
  assert.deepEqual(errors, []);
  console.log("Attention UI: both methods submitted; metadata, redo, Ref2VA restriction and desktop/mobile layout verified.");
} finally {
  await browser.close();
}
