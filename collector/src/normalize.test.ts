import test from "node:test";
import assert from "node:assert";
import { normalizeMessage, extractText } from "#src/normalize.js";
import type { WAMessage } from "@whiskeysockets/baileys";

test("extractText should extract text from simple conversations", () => {
  const msg: WAMessage = {
    key: { id: "123", remoteJid: "abc@g.us" },
    message: {
      conversation: "Hello, World!",
    },
    messageTimestamp: 1717670000,
  };
  assert.strictEqual(extractText(msg), "Hello, World!");
});

test("extractText should extract text from extended text messages", () => {
  const msg: WAMessage = {
    key: { id: "123", remoteJid: "abc@g.us" },
    message: {
      extendedTextMessage: {
        text: "Hello from extended text!",
      },
    },
    messageTimestamp: 1717670000,
  };
  assert.strictEqual(extractText(msg), "Hello from extended text!");
});

test("extractText should extract captions from media messages", () => {
  const imageMsg: WAMessage = {
    key: { id: "123", remoteJid: "abc@g.us" },
    message: {
      imageMessage: {
        caption: "Nice photo",
      },
    },
    messageTimestamp: 1717670000,
  };
  assert.strictEqual(extractText(imageMsg), "Nice photo");

  const videoMsg: WAMessage = {
    key: { id: "123", remoteJid: "abc@g.us" },
    message: {
      videoMessage: {
        caption: "Nice video",
      },
    },
    messageTimestamp: 1717670000,
  };
  assert.strictEqual(extractText(videoMsg), "Nice video");
});

test("normalizeMessage should return null if key id or remoteJid is missing", () => {
  const msg1: WAMessage = {
    key: { remoteJid: "abc@g.us" },
    messageTimestamp: 1717670000,
  };
  assert.strictEqual(normalizeMessage(msg1), null);

  const msg2: WAMessage = {
    key: { id: "123" },
    messageTimestamp: 1717670000,
  };
  assert.strictEqual(normalizeMessage(msg2), null);
});

test("normalizeMessage should correctly parse a complete message", () => {
  const msg: WAMessage = {
    key: {
      id: "msg-999",
      remoteJid: "120363421703374121@g.us",
      participant: "34666555444@s.whatsapp.net",
      fromMe: false,
    },
    message: {
      conversation: "Test group message",
    },
    messageTimestamp: 1717670123,
  };

  const normalized = normalizeMessage(msg);
  assert.ok(normalized);
  assert.strictEqual(normalized.messageId, "msg-999");
  assert.strictEqual(normalized.chatJid, "120363421703374121@g.us");
  assert.strictEqual(normalized.senderJid, "34666555444@s.whatsapp.net");
  assert.strictEqual(normalized.fromMe, false);
  assert.strictEqual(normalized.timestamp, 1717670123);
  assert.strictEqual(normalized.messageType, "conversation");
  assert.strictEqual(normalized.text, "Test group message");
});
