// UI-only: mock ComfyUI requests so this submits no GPU work.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
const require = createRequire(import.meta.url);
const { chromium, expect } = require(process.env.PLAYWRIGHT_MODULE || "playwright/test");
await mkdir(new URL("../work/singularity-v2/", import.meta.url), { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const graphs = [], saved = [], errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const tiny = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 608; canvas.height = 352;
    return canvas.toDataURL("image/png").split(",")[1];
  }), "base64");
  await page.route("http://127.0.0.1:8188/**", async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname;
    const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST,GET,OPTIONS" };
    const reply = (json) => route.fulfill({ json, headers });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (path === "/system_stats") return reply({ devices: [] });
    if (path === "/h3-studio/outputs") return reply({ outputs: saved });
    if (path === "/upload/image") return reply({ name: "fixture.png" });
    if (path === "/view") return route.fulfill({ body: tiny, contentType: "image/png", headers });
    if (path === "/prompt") { graphs.push(req.postDataJSON().prompt); return reply({ prompt_id: `singularity-ui-${graphs.length}` }); }
    if (path.startsWith("/history/")) {
      const id = path.split("/").pop();
      return reply({ [id]: { status: { completed: true }, outputs: { out: { videos: [{ filename: `${id}.mp4`, subfolder: "video", type: "output" }] } } } });
    }
    if (path === "/h3-studio/output-metadata") { saved.unshift(req.postDataJSON()); return reply({ ok: true }); }
    return reply({});
  });
  await page.goto("http://localhost:3000");
  await expect(page.getByText("本機 H3 已連線", { exact: true })).toBeVisible();
  const model = page.getByRole("combobox", { name: "H3 模型", exact: true });
  const profile = page.getByRole("combobox", { name: "模式", exact: true });
  await expect(model).toHaveValue("original");
  await model.selectOption("singularity-v2");
  await expect(profile).toHaveValue("cooled-turbo-4");
  await page.getByLabel("影片描述", { exact: true }).fill("An adult person waves.");
  let completed = 0;
  for (const [value, steps] of [["cooled-turbo-4", 4], ["fast", 6], ["cooled-turbo-8", 8]]) {
    await profile.selectOption(value);
    await page.getByRole("button", { name: "生成影片", exact: false }).last().click();
    await expect.poll(() => saved.length).toBe(++completed);
    assert.equal(graphs.at(-1)["9"].inputs.steps, steps);
    assert.match(graphs.at(-1)["120"].inputs.lora_name, /ref2v_turbo_4step_v0.1/);
    assert.equal(saved[0].h3Model, "singularity-v2");
  }
  await page.getByRole("button", { name: "參考生影片", exact: true }).click();
  await expect(profile).toHaveValue("cooled-turbo-4");
  await page.locator("#first-frame-upload").setInputFiles({ name: "first.png", mimeType: "image/png", buffer: tiny });
  await page.locator("#last-frame-upload").setInputFiles({ name: "last.png", mimeType: "image/png", buffer: tiny });
  await page.locator('.reference-upload-section input[type="file"]').first().setInputFiles({ name: "ref.png", mimeType: "image/png", buffer: tiny });
  await page.getByPlaceholder("例如：女主角").fill("person");
  await expect(page.getByRole("combobox", { name: "注意力（影片）", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "生成影片", exact: false }).last().click();
  await expect.poll(() => saved.length).toBe(4);
  assert.equal(graphs[3]["212"].inputs.frame_idx, 0);
  assert.equal(graphs[3]["213"].inputs.frame_idx, -1);
  await page.getByRole("button", { name: "singularity-ui-1.mp4 影片操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "再做一次", exact: true }).click();
  await expect(model).toHaveValue("singularity-v2");
  await expect(profile).toHaveValue("cooled-turbo-4");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator(".composer-footer").first().screenshot({ path: `E:/AI_Work/projects/MinimaxH3/work/singularity-v2/ui-${width}.png` });
    const bounds = await model.boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
  }
  await model.selectOption("original");
  await expect(profile).toHaveValue("fast");
  assert.deepEqual(errors, []);
  console.log("Singularity UI: model pairing, 4/6/8 steps, reference anchors, redo and desktop/mobile layout passed.");
} finally { await browser.close(); }
