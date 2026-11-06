import { test } from "node:test";
import assert from "node:assert/strict";
import type { WAMessage } from "@whiskeysockets/baileys";
import { classifyMedia } from "./normalize.js";

const wa = (message: unknown) => ({ key: { id: "m", remoteJid: "a@g.us" }, message }) as WAMessage;

test("image is a picture", () => {
  assert.deepEqual(classifyMedia(wa({ imageMessage: { mimetype: "image/jpeg", fileLength: 2048 } })), {
    kind: "picture",
    mimeType: "image/jpeg",
    viewOnce: false,
    fileLength: 2048,
    seconds: undefined,
  });
});

test("push-to-talk audio is a voice note", () => {
  const media = classifyMedia(wa({ audioMessage: { mimetype: "audio/ogg; codecs=opus", ptt: true, seconds: 42 } }));
  assert.equal(media?.kind, "voice");
  assert.equal(media?.seconds, 42);
  assert.equal(media?.viewOnce, false);
});

test("regular audio files are out of scope", () => {
  assert.equal(classifyMedia(wa({ audioMessage: { mimetype: "audio/mpeg", ptt: false } })), undefined);
});

test("view-once picture is flagged", () => {
  const media = classifyMedia(wa({ viewOnceMessageV2: { message: { imageMessage: { mimetype: "image/jpeg" } } } }));
  assert.equal(media?.kind, "picture");
  assert.equal(media?.viewOnce, true);
});

test("view-once voice note is flagged", () => {
  const media = classifyMedia(
    wa({ viewOnceMessageV2Extension: { message: { audioMessage: { mimetype: "audio/ogg", ptt: true } } } }),
  );
  assert.equal(media?.kind, "voice");
  assert.equal(media?.viewOnce, true);
});

test("videos and stickers are ignored", () => {
  assert.equal(classifyMedia(wa({ videoMessage: { mimetype: "video/mp4" } })), undefined);
  assert.equal(classifyMedia(wa({ stickerMessage: { mimetype: "image/webp" } })), undefined);
});
