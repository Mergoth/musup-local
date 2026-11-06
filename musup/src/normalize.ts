import { normalizeMessageContent, type WAMessage } from "@whiskeysockets/baileys";
import type { MediaKind } from "./media/mediaTypes.js";

export type MediaInfo = {
  kind: MediaKind;
  mimeType: string;
  viewOnce: boolean;
  fileLength?: number;
  seconds?: number;
};

export type NormalizedMessage = {
  messageId: string;
  chatJid: string;
  senderJid?: string;
  fromMe: boolean;
  timestamp: number;
  messageType: string;
  text?: string;
  media?: MediaInfo;
};

type BaileysMessage = NonNullable<WAMessage["message"]>;

function detectMessageType(msg: BaileysMessage): string {
  if (msg.conversation) return "conversation";
  if (msg.extendedTextMessage) return "extendedTextMessage";
  if (msg.imageMessage) return "imageMessage";
  if (msg.videoMessage) return "videoMessage";
  if (msg.documentMessage) return "documentMessage";
  if (msg.audioMessage) return "audioMessage";
  if (msg.stickerMessage) return "stickerMessage";
  if (msg.reactionMessage) return "reactionMessage";
  if (msg.pollCreationMessage) return "pollCreationMessage";
  if (msg.pollUpdateMessage) return "pollUpdateMessage";
  if (msg.locationMessage) return "locationMessage";
  if (msg.contactMessage) return "contactMessage";
  if (msg.contactsArrayMessage) return "contactsArrayMessage";
  if (msg.protocolMessage) return "protocolMessage";

  return Object.keys(msg)[0] || "unknown";
}

export function extractText(message: WAMessage): string | undefined {
  // Disappearing, view-once and edited messages wrap the real content one level down.
  const msg = normalizeMessageContent(message.message);
  if (!msg) return undefined;

  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.documentMessage?.caption ||
    undefined
  );
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

// Pictures and push-to-talk voice notes; everything else stays out of scope.
export function classifyMedia(message: WAMessage): MediaInfo | undefined {
  const raw = message.message;
  const msg = normalizeMessageContent(raw);
  if (!raw || !msg) return undefined;

  // normalizeMessageContent unwraps view-once, so check the raw wrapper.
  const viewOnce = Boolean(
    raw.viewOnceMessage || raw.viewOnceMessageV2 || raw.viewOnceMessageV2Extension,
  );

  if (msg.imageMessage) {
    return {
      kind: "picture",
      mimeType: msg.imageMessage.mimetype || "image/jpeg",
      viewOnce,
      fileLength: optionalNumber(msg.imageMessage.fileLength),
      seconds: undefined,
    };
  }

  if (msg.audioMessage?.ptt) {
    return {
      kind: "voice",
      mimeType: msg.audioMessage.mimetype || "audio/ogg",
      viewOnce,
      fileLength: optionalNumber(msg.audioMessage.fileLength),
      seconds: optionalNumber(msg.audioMessage.seconds),
    };
  }

  return undefined;
}

export function normalizeMessage(message: WAMessage): NormalizedMessage | null {
  const key = message.key;

  if (!key.id || !key.remoteJid) {
    return null;
  }

  const msg = normalizeMessageContent(message.message);
  const messageType = msg ? detectMessageType(msg) : "unknown";

  return {
    messageId: key.id,
    chatJid: key.remoteJid,
    senderJid: key.participant || key.remoteJid || undefined,
    fromMe: Boolean(key.fromMe),
    timestamp:
      typeof message.messageTimestamp === "number"
        ? message.messageTimestamp
        : Number(message.messageTimestamp || 0),
    messageType,
    text: extractText(message),
    media: classifyMedia(message),
  };
}
