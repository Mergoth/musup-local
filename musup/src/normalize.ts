import type { WAMessage } from "@whiskeysockets/baileys";

export type NormalizedMessage = {
  messageId: string;
  chatJid: string;
  senderJid?: string;
  fromMe: boolean;
  timestamp: number;
  messageType: string;
  text?: string;
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
  const msg = message.message;
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

export function normalizeMessage(message: WAMessage): NormalizedMessage | null {
  const key = message.key;

  if (!key.id || !key.remoteJid) {
    return null;
  }

  const msg = message.message;
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
  };
}
