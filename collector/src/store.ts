import fs from "fs";
import path from "path";
import { config } from "./config.js";
import { appLogger } from "./appLogger.js";
import type { NormalizedMessage } from "./normalize.js";

const chatsFile = path.join(config.dataDir, "chats.json");
const messagesDir = path.join(config.dataDir, "messages");

// In-memory JID → name map, backed by chats.json
const chatNameMap = new Map<string, string>();

export function initStore(): void {
  fs.mkdirSync(messagesDir, { recursive: true });
  fs.mkdirSync(path.dirname(chatsFile), { recursive: true });

  if (fs.existsSync(chatsFile)) {
    try {
      const raw = fs.readFileSync(chatsFile, "utf-8");
      const obj = JSON.parse(raw) as Record<string, string>;
      for (const [jid, name] of Object.entries(obj)) {
        chatNameMap.set(jid, name);
      }
      appLogger.info(`Loaded ${chatNameMap.size} chat names from chats.json`);
    } catch (err) {
      appLogger.warn("Failed to parse chats.json, starting fresh", err);
    }
  }
}

export function getCachedChatName(jid: string): string | undefined {
  return chatNameMap.get(jid);
}

export function registerChatName(jid: string, name: string): void {
  if (chatNameMap.get(jid) === name) return;

  chatNameMap.set(jid, name);
  const obj: Record<string, string> = {};
  for (const [k, v] of chatNameMap.entries()) obj[k] = v;

  try {
    fs.writeFileSync(chatsFile, JSON.stringify(obj, null, 2), "utf-8");
    appLogger.info("Registered chat", { jid, name });
  } catch (err) {
    appLogger.warn("Failed to write chats.json", err);
  }
}

function utcDateString(timestampSeconds: number): string {
  return new Date(timestampSeconds * 1000).toISOString().slice(0, 10);
}

export function appendMessage(
  normalized: NormalizedMessage,
  chatName: string
): void {
  const dateStr = utcDateString(normalized.timestamp);
  const filePath = path.join(messagesDir, `${dateStr}.ndjson`);

  const record = {
    messageId: normalized.messageId,
    chatJid: normalized.chatJid,
    chatName,
    senderJid: normalized.senderJid ?? null,
    fromMe: normalized.fromMe,
    timestamp: normalized.timestamp,
    messageType: normalized.messageType,
    text: normalized.text ?? "",
  };

  try {
    fs.appendFileSync(filePath, JSON.stringify(record) + "\n", "utf-8");
  } catch (err) {
    appLogger.error("Failed to append message to file", { filePath, err });
    throw err;
  }
}

export function getAllChats(): Map<string, string> {
  return new Map(chatNameMap);
}
