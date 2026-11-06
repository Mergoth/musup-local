import { before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import type { DeliveryTarget } from "./digestDelivery.js";
import type { StructuredSummary } from "./structuredSummary.js";
import type { WhatsappMessage } from "./types.js";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "musup-test-"));
const { initDatabase } = await import("../db/database.js");
const { deliverDigest } = await import("./digestDelivery.js");

before(async () => {
  await initDatabase();
});

function recorder(name: string, failText?: (text: string) => boolean, failPhoto = false) {
  const log: string[] = [];
  const target: DeliveryTarget = {
    name,
    sendText: async (text) => {
      if (failText?.(text)) throw new Error("text failed");
      log.push(`text:${text.split("\n")[0]}`);
    },
    sendPhoto: async (_photo, caption) => {
      if (failPhoto) throw new Error("photo failed");
      log.push(`photo:${caption}`);
    },
  };
  return { target, log };
}

const message = (messageId: string, chatJid: string, chatLabel: string, sendable = false): WhatsappMessage => ({
  messageId,
  chatJid,
  chatLabel,
  fromMe: false,
  timestamp: 1,
  messageDateUtc: "",
  messageType: sendable ? "imageMessage" : "conversation",
  text: "x",
  sendablePicture: sendable,
  pictureFilePath: sendable ? `/m/${messageId}.jpg` : undefined,
});

const summary: StructuredSummary = {
  noActionRequiredText: "No action required",
  emptySummaryText: "Nothing new",
  chats: [
    {
      chatJid: "a@g.us",
      chatName: "2B",
      discussed: ["trip"],
      conclusions: [],
      actionItems: [],
      pictures: [{ messageId: "p1", caption: "Flyer" }],
    },
    { chatJid: "b@g.us", chatName: "Family", discussed: ["dinner"], conclusions: [], actionItems: [], pictures: [] },
  ],
};
const messages = [message("p1", "a@g.us", "2B", true), message("t1", "b@g.us", "Family")];
const readFile = () => Buffer.from("img");

test("each chat's text is followed by its pictures", async () => {
  const { target, log } = recorder("telegram");
  const result = await deliverDigest(summary, messages, [target], readFile);
  assert.deepEqual(log, ["text:<b>2B</b>", "photo:Flyer", "text:<b>Family</b>"]);
  assert.equal(result.deliveredChats, 2);
  assert.deepEqual(result.sentPictures, [{ messageId: "p1", caption: "Flyer" }]);
  assert.equal(result.failedChatJids.size, 0);
});

test("a failed chat does not stop the others and is reported for retry", async () => {
  const { target, log } = recorder("telegram", (text) => text.startsWith("<b>2B</b>"));
  const result = await deliverDigest(summary, messages, [target], readFile);
  assert.deepEqual(log, ["text:<b>Family</b>"]);
  assert.deepEqual([...result.failedChatJids], ["a@g.us"]);
  assert.equal(result.deliveredChats, 1);
});

test("a failed picture is skipped without failing the chat", async () => {
  const { target, log } = recorder("telegram", undefined, true);
  const result = await deliverDigest(summary, messages, [target], readFile);
  assert.deepEqual(log, ["text:<b>2B</b>", "text:<b>Family</b>"]);
  assert.equal(result.failedChatJids.size, 0);
  assert.deepEqual(result.sentPictures, []);
});

test("a chat without chatJid fails by its name", async () => {
  const noJid = { ...summary, chats: [{ ...summary.chats[0]!, chatJid: undefined }] };
  const { target } = recorder("telegram", () => true);
  const result = await deliverDigest(noJid, messages, [target], readFile);
  assert.deepEqual([...result.failedChatJids], ["a@g.us"]);
});

test("an empty summary is sent once as plain text", async () => {
  const { target, log } = recorder("telegram");
  await deliverDigest({ ...summary, chats: [] }, messages, [target], readFile);
  assert.deepEqual(log, ["text:Nothing new"]);
});
