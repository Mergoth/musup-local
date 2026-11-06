import { before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "musup-test-"));
const { initDatabase, updateSettings } = await import("../db/database.js");
const store = await import("./mediaStore.js");
const { processMediaItem, ensureMediaProcessed } = await import("./mediaWorker.js");

before(async () => {
  await initDatabase();
  fs.mkdirSync(store.mediaDir(), { recursive: true });
});

function addItem(messageId: string, kind: "picture" | "voice"): string {
  const filePath = path.join(store.mediaDir(), `${messageId}.${kind === "picture" ? "jpg" : "ogg"}`);
  fs.writeFileSync(filePath, "data");
  store.upsertMediaItem({
    messageId,
    chatJid: "a@g.us",
    kind,
    status: "pending",
    mimeType: kind === "picture" ? "image/jpeg" : "audio/ogg",
    filePath,
  });
  return filePath;
}

const unused = {
  describeImage: async () => assert.fail("describeImage must not be called"),
  transcribeAudio: async () => assert.fail("transcribeAudio must not be called"),
  transcodeToMp3: async () => assert.fail("transcodeToMp3 must not be called"),
};

test("vision not configured leaves the picture not_configured", async () => {
  addItem("nc1", "picture");
  await processMediaItem("nc1", unused);
  assert.equal(store.getMediaItem("nc1")?.status, "not_configured");
});

test("picture is described and its file kept", async () => {
  updateSettings({ visionApiUrl: "http://v", visionModel: "m", visionApiKey: "k" });
  const filePath = addItem("pic1", "picture");
  await processMediaItem("pic1", { ...unused, describeImage: async () => "Flyer" });
  const item = store.getMediaItem("pic1");
  assert.equal(item?.status, "done");
  assert.equal(item?.resultText, "Flyer");
  assert.ok(fs.existsSync(filePath));
});

test("voice note is transcribed and its file deleted", async () => {
  updateSettings({ transcriptionApiUrl: "http://t", transcriptionModel: "m", transcriptionApiKey: "k" });
  const filePath = addItem("voice1", "voice");
  await processMediaItem("voice1", {
    ...unused,
    transcodeToMp3: async () => Buffer.from("mp3"),
    transcribeAudio: async () => "Hola",
  });
  assert.equal(store.getMediaItem("voice1")?.status, "done");
  assert.equal(store.getMediaItem("voice1")?.resultText, "Hola");
  assert.equal(fs.existsSync(filePath), false);
});

test("failures are retried once at digest time, then left alone", async () => {
  addItem("fail1", "picture");
  let calls = 0;
  const failing = {
    ...unused,
    describeImage: async (): Promise<string> => {
      calls += 1;
      throw new Error("model down");
    },
  };
  await processMediaItem("fail1", failing);
  assert.equal(store.getMediaItem("fail1")?.status, "failed");
  assert.equal(store.getMediaItem("fail1")?.attempts, 1);

  await ensureMediaProcessed(["fail1"], 1000, failing);
  assert.equal(store.getMediaItem("fail1")?.attempts, 2);

  await ensureMediaProcessed(["fail1"], 1000, failing);
  assert.equal(calls, 2);
});

test("a hung model call times out without blocking the digest", async () => {
  addItem("hang1", "picture");
  const hung = { ...unused, describeImage: () => new Promise<string>(() => {}) };
  await ensureMediaProcessed(["hang1"], 50, hung);
  assert.equal(store.getMediaItem("hang1")?.status, "failed");
});

test("missing file marks the media unavailable", async () => {
  const filePath = addItem("gone1", "picture");
  fs.rmSync(filePath);
  await processMediaItem("gone1", unused);
  assert.equal(store.getMediaItem("gone1")?.status, "unavailable");
});
