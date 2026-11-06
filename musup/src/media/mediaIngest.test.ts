import { before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import type { WAMessage } from "@whiskeysockets/baileys";
import type { NormalizedMessage } from "../normalize.js";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "musup-test-"));
const { initDatabase } = await import("../db/database.js");
const { ingestMedia } = await import("./mediaIngest.js");
const { getMediaItem } = await import("./mediaStore.js");

before(async () => {
  await initDatabase();
});

const raw = {} as WAMessage;
function normalized(messageId: string, media: NormalizedMessage["media"]): NormalizedMessage {
  return { messageId, chatJid: "a@g.us", fromMe: false, timestamp: 1, messageType: "imageMessage", media };
}
const picture = { kind: "picture" as const, mimeType: "image/png", viewOnce: false, fileLength: 10 };

test("downloads a picture once and stores it with its extension", async () => {
  let downloads = 0;
  const download = async () => {
    downloads += 1;
    return Buffer.from("png");
  };
  assert.equal(await ingestMedia(raw, normalized("p1", picture), download), true);
  assert.equal(await ingestMedia(raw, normalized("p1", picture), download), false);
  assert.equal(downloads, 1);
  const item = getMediaItem("p1");
  assert.equal(item?.status, "pending");
  assert.ok(item?.filePath?.endsWith("p1.png"));
  assert.equal(fs.readFileSync(item!.filePath!, "utf-8"), "png");
});

test("view-once media is never downloaded", async () => {
  const download = async () => assert.fail("must not download");
  assert.equal(await ingestMedia(raw, normalized("v1", { ...picture, viewOnce: true }), download), false);
  assert.equal(getMediaItem("v1")?.status, "skipped_view_once");
});

test("oversized pictures and long voice notes are skipped", async () => {
  const download = async () => assert.fail("must not download");
  await ingestMedia(raw, normalized("big", { ...picture, fileLength: 11 * 1024 * 1024 }), download);
  await ingestMedia(
    raw,
    normalized("long", { kind: "voice", mimeType: "audio/ogg", viewOnce: false, seconds: 601 }),
    download,
  );
  assert.equal(getMediaItem("big")?.status, "skipped_too_large");
  assert.equal(getMediaItem("long")?.status, "skipped_too_large");
});

test("a failed download marks the media unavailable", async () => {
  const download = async (): Promise<Buffer> => {
    throw new Error("expired");
  };
  assert.equal(await ingestMedia(raw, normalized("x1", picture), download), false);
  assert.equal(getMediaItem("x1")?.status, "unavailable");
});
