import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStructuredInput, senderLabel } from "./promptBuilder.js";
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

test("senders are named: saved contact, then WhatsApp name, then number", () => {
  const contacts = new Map([["111@s.whatsapp.net", "Arthur coach"], ["222@s.whatsapp.net", "222"]]);
  const lookup = (jid: string) => contacts.get(jid);
  const from = (senderJid: string, senderName?: string): WhatsappMessage => ({
    ...base, messageId: senderJid, messageType: "conversation", text: "hi", senderJid, senderName,
  });

  assert.equal(senderLabel(from("111@s.whatsapp.net", "Artur"), lookup), "Arthur coach");
  assert.equal(senderLabel(from("222@s.whatsapp.net", "Arseniy's mum"), lookup), "Arseniy's mum");
  assert.equal(senderLabel(from("333@s.whatsapp.net"), lookup), "+333");
  assert.equal(senderLabel(from("444@lid"), lookup), "Unknown sender");
  assert.equal(senderLabel({ ...from("555@s.whatsapp.net", "Vlad"), fromMe: true }, lookup), "Me");
});

test("the prompt input carries sender names", () => {
  const messages: WhatsappMessage[] = [
    { ...base, messageId: "m1", messageType: "conversation", text: "Send page 31", senderJid: "1@s.whatsapp.net", senderName: "Arseniy" },
  ];
  const input = JSON.parse(buildStructuredInput(messages, new Date(0), new Date(1000), "English"));
  assert.equal(input.chats[0].messages[0].sender, "Arseniy");
});
