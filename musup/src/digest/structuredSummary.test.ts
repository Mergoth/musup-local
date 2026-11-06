import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStructuredSummary, selectPictures } from "./structuredSummary.js";
import type { WhatsappMessage } from "./types.js";

test("parses pictures and drops entries without a messageId", () => {
  const parsed = parseStructuredSummary(
    '{"chats":[{"chatJid":"a@g.us","chatName":"2B","discussed":[],"conclusions":[],"actionItems":[],"pictures":[{"messageId":"m1","caption":"Flyer"},{"caption":"no id"}]}]}',
  );
  assert.deepEqual(parsed.chats[0]?.pictures, [{ messageId: "m1", caption: "Flyer" }]);
});

test("missing pictures field parses as an empty list", () => {
  const parsed = parseStructuredSummary('{"chats":[{"chatJid":"a@g.us","chatName":"2B","discussed":["x"]}]}');
  assert.deepEqual(parsed.chats[0]?.pictures, []);
});

function msg(messageId: string, chatJid: string, sendablePicture: boolean): WhatsappMessage {
  return {
    messageId,
    chatJid,
    chatLabel: chatJid === "a@g.us" ? "2B" : "Family",
    fromMe: false,
    timestamp: 1,
    messageDateUtc: "",
    messageType: sendablePicture ? "imageMessage" : "audioMessage",
    text: "",
    sendablePicture,
    pictureFilePath: sendablePicture ? `/media/${messageId}.jpg` : undefined,
  };
}

test("only sendable pictures from the same chat are selected, once", () => {
  const sendable = new Map(
    [msg("m1", "a@g.us", true), msg("m2", "b@g.us", true), msg("m3", "a@g.us", false)].map((m) => [m.messageId, m]),
  );
  const chat = {
    chatJid: "a@g.us",
    chatName: "2B",
    discussed: [],
    conclusions: [],
    actionItems: [],
    pictures: [
      { messageId: "m1", caption: "Flyer" },
      { messageId: "m2", caption: "other chat" },
      { messageId: "m3", caption: "voice" },
      { messageId: "m4", caption: "made up" },
      { messageId: "m1", caption: "again" },
    ],
  };
  assert.deepEqual(selectPictures(chat, sendable), [
    { messageId: "m1", caption: "Flyer", filePath: "/media/m1.jpg" },
  ]);
});

test("chat without chatJid matches pictures by chat name", () => {
  const sendable = new Map([["m1", msg("m1", "a@g.us", true)]]);
  const chat = { chatName: "2B", discussed: [], conclusions: [], actionItems: [], pictures: [{ messageId: "m1", caption: "x" }] };
  assert.equal(selectPictures(chat, sendable).length, 1);
});
