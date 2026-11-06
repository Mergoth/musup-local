import { before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "musup-test-"));
const { initDatabase } = await import("../db/database.js");
const store = await import("./mediaStore.js");

before(async () => {
  await initDatabase();
});

const base = { chatJid: "a@g.us", kind: "picture" as const, status: "pending" as const, mimeType: "image/jpeg" };

test("the same message is recorded once", () => {
  assert.equal(store.upsertMediaItem({ ...base, messageId: "dup" }), true);
  assert.equal(store.upsertMediaItem({ ...base, messageId: "dup", status: "unavailable" }), false);
  assert.equal(store.getMediaItem("dup")?.status, "pending");
});

test("updateMediaItem changes status and result", () => {
  store.upsertMediaItem({ ...base, messageId: "upd" });
  store.updateMediaItem("upd", { status: "done", resultText: "x", attempts: 1 });
  const item = store.getMediaItem("upd");
  assert.equal(item?.status, "done");
  assert.equal(item?.resultText, "x");
  assert.equal(item?.attempts, 1);
  assert.equal(store.getMediaItems(["upd", "missing"]).size, 1);
});

test("deleteMediaFile removes the file and clears the path", () => {
  fs.mkdirSync(store.mediaDir(), { recursive: true });
  const filePath = path.join(store.mediaDir(), "del.jpg");
  fs.writeFileSync(filePath, "img");
  store.upsertMediaItem({ ...base, messageId: "del", filePath });
  store.deleteMediaFile("del");
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(store.getMediaItem("del")?.filePath, null);
});

test("listMediaByStatus filters by status", () => {
  store.upsertMediaItem({ ...base, messageId: "fail1", status: "failed" });
  assert.ok(store.listMediaByStatus(["failed"]).some((item) => item.messageId === "fail1"));
  assert.ok(!store.listMediaByStatus(["failed"]).some((item) => item.messageId === "dup"));
});

test("purgeMediaItems keeps only retained messages", () => {
  const filePath = path.join(store.mediaDir(), "gone.jpg");
  fs.writeFileSync(filePath, "img");
  store.upsertMediaItem({ ...base, messageId: "gone", filePath });
  store.upsertMediaItem({ ...base, messageId: "keep" });
  const removed = store.purgeMediaItems(new Set(["keep"]));
  assert.ok(removed >= 1);
  assert.equal(store.getMediaItem("gone"), undefined);
  assert.equal(fs.existsSync(filePath), false);
  assert.ok(store.getMediaItem("keep"));
});

test("orphan media files without a record are removed", () => {
  fs.mkdirSync(store.mediaDir(), { recursive: true });
  const orphan = path.join(store.mediaDir(), "orphan.jpg");
  const owned = path.join(store.mediaDir(), "owned.jpg");
  fs.writeFileSync(orphan, "x");
  fs.writeFileSync(owned, "x");
  store.upsertMediaItem({ ...base, messageId: "owned", filePath: owned });
  assert.equal(store.purgeOrphanMediaFiles(), 1);
  assert.equal(fs.existsSync(orphan), false);
  assert.equal(fs.existsSync(owned), true);
});
