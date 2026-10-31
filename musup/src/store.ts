import fs from "fs";
import path from "path";
import { config } from "./config.js";
import { appLogger } from "./appLogger.js";
import type { NormalizedMessage } from "./normalize.js";

const messagesDir = path.join(config.dataDir, "messages");

export function initStore(): void {
  fs.mkdirSync(messagesDir, { recursive: true });
}

function utcDateString(timestampSeconds: number): string {
  return new Date(timestampSeconds * 1000).toISOString().slice(0, 10);
}

function utcHourString(timestampSeconds: number): string {
  return new Date(timestampSeconds * 1000).toISOString().slice(11, 13);
}

function fileContainsMessage(filePath: string, messageId: string): boolean {
  if (!fs.existsSync(filePath)) return false;

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return raw
      .split("\n")
      .filter(Boolean)
      .some((line) => {
        try {
          const node = JSON.parse(line) as Record<string, unknown>;
          return node.messageId === messageId;
        } catch {
          return false;
        }
      });
  } catch (err) {
    appLogger.warn("Failed to check message file for duplicates", { filePath, err });
    return false;
  }
}

export function appendMessage(
  normalized: NormalizedMessage,
  chatName: string
): boolean {
  const dateStr = utcDateString(normalized.timestamp);
  const hourStr = utcHourString(normalized.timestamp);
  const dayDir = path.join(messagesDir, dateStr);
  const filePath = path.join(dayDir, `${hourStr}.ndjson`);

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
    fs.mkdirSync(dayDir, { recursive: true });
    if (fileContainsMessage(filePath, normalized.messageId)) return false;
    fs.appendFileSync(filePath, JSON.stringify(record) + "\n", "utf-8");
    return true;
  } catch (err) {
    appLogger.error("Failed to append message to file", { filePath, err });
    throw err;
  }
}
