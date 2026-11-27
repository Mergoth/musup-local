import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStructuredSummary, renderStructuredSummary, selectPictures } from "./structuredSummary.js";
import type { WhatsappMessage } from "./types.js";

test("parses pictures and drops entries without a messageId", () => {
  const parsed = parseStructuredSummary(
    '{"chats":[{"chatJid":"a@g.us","chatName":"2B","actionItems":[],"notes":["x"],"pictures":[{"messageId":"m1","caption":"Flyer"},{"caption":"no id"}]}]}',
  );
  assert.deepEqual(parsed.chats[0]?.pictures, [{ messageId: "m1", caption: "Flyer" }]);
});

test("missing pictures field parses as an empty list", () => {
  const parsed = parseStructuredSummary('{"chats":[{"chatJid":"a@g.us","chatName":"2B","notes":["x"]}]}');
  assert.deepEqual(parsed.chats[0]?.pictures, []);
});

test("picture-only chat survives parsing", () => {
  const parsed = parseStructuredSummary(
    '{"chats":[{"chatJid":"a@g.us","chatName":"2B","actionItems":[],"notes":[],"pictures":[{"messageId":"m1","caption":"Flyer"}]}]}',
  );
  assert.equal(parsed.chats.length, 1);
  assert.deepEqual(parsed.chats[0]?.pictures, [{ messageId: "m1", caption: "Flyer" }]);
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
    actionItems: [],
    notes: [],
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
  const chat = { chatName: "2B", actionItems: [], notes: [], pictures: [{ messageId: "m1", caption: "x" }] };
  assert.equal(selectPictures(chat, sendable).length, 1);
});

test("chats with nothing for the reader are dropped", () => {
  const parsed = parseStructuredSummary(
    '{"chats":[{"chatName":"Kickboxing","actionItems":[],"notes":[]},{"chatName":"4B","notes":["Trip cancelled"]}]}',
  );
  assert.deepEqual(parsed.chats.map((chat) => chat.chatName), ["4B"]);
});

test("action items render with requester and audience", () => {
  const parsed = parseStructuredSummary(JSON.stringify({
    askedText: "просит",
    chats: [{
      chatName: "TKD",
      actionItems: [
        { requestedBy: "Артур", audience: "только чёрные пояса", action: "прийти на взвешивание 27.11" },
        { requestedBy: "", audience: "", action: "оплатить взнос" },
        "legacy string item",
      ],
      notes: ["Старт в 08:30"],
    }],
  }));
  assert.equal(
    renderStructuredSummary(parsed),
    [
      "<b>TKD</b>",
      "✅ <b>Артур</b> просит (только чёрные пояса): прийти на взвешивание 27.11",
      "✅ оплатить взнос",
      "✅ legacy string item",
      "ℹ️ Старт в 08:30",
    ].join("\n"),
  );
});

test("stray colons and brackets from the model are trimmed", () => {
  const parsed = parseStructuredSummary(JSON.stringify({
    askedText: "просит:",
    chats: [{ chatName: "4B", actionItems: [{ requestedBy: "Lucía:", audience: "(только 4B)", action: "фото стр. 31" }] }],
  }));
  assert.match(renderStructuredSummary(parsed), /✅ <b>Lucía<\/b> просит \(только 4B\): фото стр\. 31$/);
});

test("readLabel rules via parseStructuredSummary", () => {
  const parsed = parseStructuredSummary(JSON.stringify({
    askedText: "просит:",
    chats: [{
      chatName: "4B",
      actionItems: [
        { requestedBy: "Jr.", audience: "(A) or (B)", action: "read" },
        { requestedBy: "Lucía:", audience: "(только 4B)", action: "write" },
        { requestedBy: "Doctor, ", audience: "group A,  ", action: "bring test" },
      ],
    }],
  }));
  assert.equal(parsed.askedText, "просит");
  assert.equal(parsed.chats[0]?.actionItems[0]?.requestedBy, "Jr.");
  assert.equal(parsed.chats[0]?.actionItems[0]?.audience, "(A) or (B)");
  assert.equal(parsed.chats[0]?.actionItems[1]?.requestedBy, "Lucía");
  assert.equal(parsed.chats[0]?.actionItems[1]?.audience, "только 4B");
  assert.equal(parsed.chats[0]?.actionItems[2]?.requestedBy, "Doctor");
  assert.equal(parsed.chats[0]?.actionItems[2]?.audience, "group A");
});
