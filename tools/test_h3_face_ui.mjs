// UI-only smoke test. All ComfyUI requests are intercepted; no GPU work is submitted.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium, expect } = require(process.env.PLAYWRIGHT_MODULE || "playwright/test");
const browser = await chromium.launch({ headless: true });
const original = { filename: "H3_Studio_UI_Face_source.mp4", subfolder: "video", type: "output", kind: "video", firstImagePath: "identity.png", prompt: "A person walks.", profile: "fast", resolution: "safe", sourceMode: "image", inputMode: "standard", seed: 42, sound: true, width: 608, height: 352, cooldownSeconds: 5 };
try {
  for (const width of [1920, 1440, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 950 } });
    const tiny = Buffer.from(await page.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 256;
      return canvas.toDataURL("image/png").split(",")[1];
    }), "base64");
    const errors = []; const graphs = []; let savedOriginal = false;
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("http://127.0.0.1:8188/**", async (route) => {
      const req = route.request(), url = new URL(req.url()), path = url.pathname;
      const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST,GET,OPTIONS" };
      const reply = (json) => route.fulfill({ json, headers });
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
      if (path === "/system_stats") return reply({ devices: [] });
      if (path === "/h3-studio/outputs") return reply({ outputs: [original] });
      if (path === "/history") return reply({});
      if (path === "/h3-studio/face/status") return reply({ ready: true });
      if (path === "/upload/image") return reply({ name: "identity.png" });
      if (path === "/view") return route.fulfill({ body: tiny, contentType: "image/png", headers });
      if (path === "/prompt") { graphs.push(req.postDataJSON().prompt); return reply({ prompt_id: `face-ui-${graphs.length}` }); }
      if (path.startsWith("/history/")) {
        const id = path.split("/").pop();
        const graph = graphs[Number(id.split("-").pop()) - 1];
        return reply({ [id]: { status: { completed: true }, outputs: { out: { videos: [{ ...original, filename: id.endsWith("1") ? original.filename : `${graph["27"].inputs.filename_prefix.split("/").pop()}_00001_.mp4`, subfolder: id.endsWith("1") ? "video" : "h3_face_cache" }] } } } });
      }
      if (path === "/h3-studio/output-metadata") {
        savedOriginal = true;
        if (width === 1280) assert.equal(req.postDataJSON().faceRefine.mode, "turbo-8");
        return reply({ saved: true });
      }
      if (path === "/h3-studio/face/prepare") {
        const body = req.postDataJSON();
        if (!body.scan) assert(savedOriginal, "automatic refinement must follow original metadata persistence");
        return reply({ sourceId: "a".repeat(32), videoPath: "fixture.mp4", referenceFile: "identity.png", frames: 56, sound: true, settings: body.settings,
          targets: body.settings.select === "all_faces" ? [{ index: 0, label: "鏡頭 1 · 人物組 1", referenceFile: "a.png" }, { index: 1, label: "鏡頭 1 · 人物組 2", referenceFile: "b.png" }] : undefined,
          preview: body.scan ? { shots: [{ segment: [0, 28], frame: 0, faces: 2, jpg: tiny.toString("base64"), boxes: [] }, { segment: [28, 56], frame: 28, faces: 1, jpg: tiny.toString("base64"), boxes: [] }] } : undefined });
      }
      if (path === "/h3-studio/face/finish") {
        const saved = req.postDataJSON().settings;
        return reply({ ...original, filename: "H3_Studio_Face_ui.mp4", faceRefined: true, faceRefine: saved, faceRefineSteps: saved.mode === "turbo-8" ? 8 : 20, faceRefinePeopleCompleted: req.postDataJSON().completedPeople });
      }
      return reply({});
    });
    await page.goto("http://localhost:3000");
    await expect(page.getByText("本機 H3 已連線", { exact: true })).toBeVisible();
    const referenceMode = width === 1280;
    await page.getByRole("button", { name: referenceMode ? "參考生影片" : "首尾圖生影片", exact: true }).click();
    await page.getByLabel("生成後自動人臉精修").check();
    await expect(page.getByLabel("修臉人物", { exact: true })).toBeVisible();
    await expect(page.getByLabel("人臉精修模式")).toHaveValue("native-20");
    if (referenceMode) {
      await page.getByLabel("人臉精修模式").selectOption("turbo-8");
      await expect(page.getByText(/快速精修保留原音軌/)).toBeVisible();
      await page.getByLabel("修臉人物", { exact: true }).selectOption("all_faces");
      await expect(page.getByLabel("修臉身份參考圖")).toBeDisabled();
    }
    if (referenceMode) {
      await page.locator('#reference-image-1').setInputFiles({ name: "identity.png", mimeType: "image/png", buffer: tiny });
      await page.getByPlaceholder("例如：女主角", { exact: true }).fill("person");
      await expect(page.getByAltText("參考圖片 1", { exact: true })).toBeVisible();
    } else {
      await page.locator('#first-frame-upload').setInputFiles({ name: "identity.png", mimeType: "image/png", buffer: tiny });
      await expect(page.locator(".setting-note").filter({ hasText: "首圖 256 × 256" })).toBeVisible();
    }
    await page.getByLabel("生成種子", { exact: true }).fill("42");
    await page.getByLabel("影片描述", { exact: true }).fill("A person walks.");
    await page.locator(".video-face-footer").screenshot({ path: `E:/AI_Work/projects/MinimaxH3/work/face-layout-${width}.png` });
    await page.getByRole("button", { name: "生成影片", exact: false }).last().click();
    await expect(page.getByText("H3 影片與人臉精修已完成，原片已保留。", { exact: true })).toBeVisible();
    assert.equal(graphs.length, referenceMode ? 3 : 2);
    if (referenceMode) assert(graphs[0]["104"], "reference generation must keep its own workflow");
    assert(Object.values(graphs[1]).some((node) => node.class_type === "H3FaceStitch"));
    assert.equal(graphs[1]["20"].inputs.steps, referenceMode ? 8 : 20);
    assert.equal(Boolean(graphs[1]["29"]), referenceMode);
    await page.getByRole("complementary", { name: "主選單" }).getByRole("button", { name: "作品", exact: false }).click();
    await page.getByRole("button", { name: `${original.filename} 影片操作`, exact: true }).click();
    await page.getByRole("menuitem", { name: "人臉精修", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: `人臉精修 · ${original.filename}`, exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("人臉精修模式").selectOption("turbo-8");
    if (referenceMode) await dialog.getByLabel("修臉人物", { exact: true }).selectOption("all_faces");
    await dialog.getByRole("button", { name: "偵測人臉並預覽", exact: true }).click();
    if (referenceMode) {
      await expect(dialog.getByText("已偵測 2 個人物組，將依序修復。", { exact: true })).toBeVisible();
      await expect(dialog.getByAltText("鏡頭 1 · 人物組 1 的原片人臉")).toBeVisible();
      await expect(dialog.getByAltText("鏡頭 1 · 人物組 2 的原片人臉")).toBeVisible();
    } else {
      await expect(dialog.getByLabel("鏡頭 1 修復人物")).toBeVisible();
      await dialog.getByLabel("鏡頭 1 修復人物").selectOption("1");
      await dialog.getByLabel("鏡頭 2 修復人物").selectOption("-1");
    }
    const bounds = await dialog.boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    await page.screenshot({ path: `E:/AI_Work/projects/MinimaxH3/work/face-ui-${width}.png`, fullPage: true });
    await dialog.getByRole("button", { name: "加入精修佇列", exact: true }).click();
    await expect(dialog.getByText("人臉精修完成，原片與新成品都已保留。", { exact: true })).toBeVisible();
    const last = graphs.at(-1);
    if (referenceMode) {
      assert.equal(graphs.length, 5);
      assert.equal(last["1"].class_type, "H3StudioMultiFaceSource");
      assert.equal(last["1"].inputs.target_index, 1);
      assert.equal(last["12"].inputs.image, "b.png");
    } else assert.equal(last["1"].inputs.confirmed_pick, "1,-1");
    assert.equal(last["20"].inputs.steps, 8);
    assert.equal(last["15"], undefined);
    assert.equal(last["29"].class_type, "H3StudioFaceUnlockAudio");
    assert.deepEqual(errors, []);
    await dialog.getByRole("button", { name: "關閉", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.close();
    console.log(`face UI ${width}px (${referenceMode ? "reference" : "image"}): automatic pipeline, manual shot picks, original retention passed`);
  }
} finally { await browser.close(); }
