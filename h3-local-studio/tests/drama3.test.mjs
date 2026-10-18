import assert from "node:assert/strict";
import test from "node:test";
import { drama3Status, submitDrama3, waitDrama3, uploadDrama3Reference, cancelDrama3, drama3DownloadUrl, drama3VoicePreviewUrl, openDrama3VoiceFolder } from "../lib/drama3.ts";

test("Drama3 submits the full dialogue and observes only its job", async () => {
  const original = globalThis.fetch;
  const calls = [];
  const settings = { roles: [{ id: "a", name: "A", voice: "a.safetensors" }], lines: [{ roleId: "a", text: "Hello." }], seed: 42 };
  globalThis.fetch = async (url, options) => {
    calls.push([String(url), options]);
    if (String(url).endsWith("/jobs")) return Response.json({ id: "job-1", status: "running" });
    return Response.json({ id: "job-1", status: "completed", operation: "generate", result: { filename: "out.flac", drama3: settings } });
  };
  try {
    const job = await submitDrama3("generate", settings);
    const updates = [];
    const result = await waitDrama3(job.id, (update) => updates.push(update));
    assert.deepEqual(JSON.parse(calls[0][1].body), { ...settings, operation: "generate" });
    assert.match(calls[1][0], /\/jobs\/job-1$/);
    assert.deepEqual(result.result.drama3, settings);
    assert.equal(updates.length, 1);
  } finally { globalThis.fetch = original; }
});

test("Drama3 propagates failures and targeted cancellation", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith("/cancel")) {
      assert.equal(options.method, "POST");
      return Response.json({ id: "job-1", status: "cancelling" });
    }
    return Response.json({ id: "job-1", status: "failed", message: "generation failed" });
  };
  try {
    assert.equal((await cancelDrama3("job-1")).status, "cancelling");
    await assert.rejects(waitDrama3("job-1", () => {}), /generation failed/);
  } finally { globalThis.fetch = original; }
});

test("reference uploads use multipart and status/download retain the correct backend", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /^http:\/\/127\.0\.0\.1:8188\/h3-studio\/drama3\//);
    if (String(url).endsWith("/upload")) {
      assert.equal(options.body.get("audio").name, "voice.wav");
      return Response.json({ reference: "saved.wav" });
    }
    return Response.json({ ready: true, voices: ["a.safetensors"], activeJob: null });
  };
  try {
    assert.equal(await uploadDrama3Reference(new File(["fixture"], "voice.wav")), "saved.wav");
    assert.equal((await drama3Status()).ready, true);
    assert.match(drama3DownloadUrl("out.flac"), /\/drama3\/download\?filename=out.flac$/);
  } finally { globalThis.fetch = original; }
});

test("voice folder and preview requests preserve the selected voice and use Studio routes", async () => {
  const original = globalThis.fetch;
  const voice = "nested/voice.safetensors";
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /\/voices\/open-folder$/);
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), { voice });
    return Response.json({ folder: "C:\\Drama3\\voices" });
  };
  try {
    assert.equal((await openDrama3VoiceFolder(voice)).folder, "C:\\Drama3\\voices");
    assert.match(drama3VoicePreviewUrl("abc123"), /\/voices\/preview\/abc123$/);
  } finally { globalThis.fetch = original; }
});
