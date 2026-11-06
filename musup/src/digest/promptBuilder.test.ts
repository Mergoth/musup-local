import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStructuredInput } from "./promptBuilder.js";
import type { WhatsappMessage } from "./types.js";

const base = { chatJid: "a@g.us", chatLabel: "2B", fromMe: false, timestamp: 1, messageDateUtc: "" };

test("sendable pictures are marked, voice notes are not", () => {
  const messages: WhatsappMessage[] = [
    { ...base, messageId: "p1", messageType: "imageMessage", text: "[picture] Flyer", sendablePicture: true },
    { ...base, messageId: "v1", messageType: "audioMessage", text: "[voice note] Hola" },
  ];
  const input = JSON.parse(buildStructuredInput(messages, new Date(0), new Date(1000), "English"));
  const [picture, voice] = input.chats[0].messages;
  assert.deepEqual(picture.picture, { sendable: true });
  assert.equal(voice.picture, undefined);
  assert.equal(voice.text, "[voice note] Hola");
});
