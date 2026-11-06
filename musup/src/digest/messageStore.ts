import fs from "fs";
import path from "path";
import { config } from "../config.js";
import { appLogger } from "../appLogger.js";
import type { WhatsappMessage } from "./types.js";
import { getSubscribedChatJids } from "../db/database.js";

const messagesDir = path.join(config.dataDir, "messages");
const processedFile = path.join(config.dataDir, "processed.json");

let processedIds: Set<string> | undefined;

function loadProcessed(): Set<string> {
  if (!fs.existsSync(processedFile)) return new Set();

  try {
    const raw = fs.readFileSync(processedFile, "utf-8");
    return new Set(Object.keys(JSON.parse(raw) as Record<string, unknown>));
  } catch (err) {
    appLogger.warn("Failed to load processed.json, starting fresh", err);
    return new Set();
  }
}

function getProcessedIds(): Set<string> {
  if (!processedIds) processedIds = loadProcessed();
  return processedIds;
}

function parseMessageLine(
  line: string
): (Omit<WhatsappMessage, "chatLabel" | "messageDateUtc"> & { chatName?: string }) | null {
  try {
    const node = JSON.parse(line) as Record<string, unknown>;
    const messageId = typeof node.messageId === "string" ? node.messageId : "";
    const chatJid = typeof node.chatJid === "string" ? node.chatJid : "";
    const timestamp = typeof node.timestamp === "number" ? node.timestamp : 0;
    const text = typeof node.text === "string" ? node.text.trim() : "";

    if (!messageId || !chatJid || !timestamp || !text) return null;

    return {
      messageId,
      chatJid,
      chatName: typeof node.chatName === "string" ? node.chatName : undefined,
      senderJid: typeof node.senderJid === "string" ? node.senderJid : undefined,
      fromMe: Boolean(node.fromMe),
      timestamp,
      messageType: typeof node.messageType === "string" ? node.messageType : "unknown",
      text,
    };
  } catch (err) {
    appLogger.warn("Failed to parse NDJSON line", err);
    return null;
  }
}

function parseFile(filePath: string, fromTs = 0, toTs = Number.MAX_SAFE_INTEGER): WhatsappMessage[] {
  const messages: WhatsappMessage[] = [];
  const raw = fs.readFileSync(filePath, "utf-8");

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parsed = parseMessageLine(trimmed);
    if (!parsed) continue;
    if (parsed.timestamp < fromTs || parsed.timestamp >= toTs) continue;

    const chatLabel = parsed.chatName || parsed.chatJid;
    const { chatName: _chatName, ...message } = parsed;
    messages.push({
      ...message,
      chatLabel,
      messageDateUtc: new Date(message.timestamp * 1000).toISOString(),
    });
  }

  return messages;
}

function listStoredMessageFiles(): string[] {
  if (!fs.existsSync(messagesDir)) {
    return [];
  }

  const files: string[] = [];

  for (const entry of fs.readdirSync(messagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
    const entryPath = path.join(messagesDir, entry.name);

    for (const file of fs.readdirSync(entryPath, { withFileTypes: true })) {
      if (!file.isFile() || !/^\d{2}\.ndjson$/.test(file.name)) continue;
      files.push(path.join(entryPath, file.name));
    }
  }

  return files.sort();
}

function listMessageFiles(fromTs = 0, toTs = Number.MAX_SAFE_INTEGER): string[] {
  return listStoredMessageFiles().filter((filePath) => {
    const day = path.basename(path.dirname(filePath));
    const hour = path.basename(filePath, ".ndjson");
    const bucketStartMs = Date.parse(`${day}T${hour}:00:00.000Z`);
    if (!Number.isFinite(bucketStartMs)) return false;

    const bucketStartTs = bucketStartMs / 1000;
    const bucketEndTs = bucketStartTs + 60 * 60;
    return bucketEndTs > fromTs && bucketStartTs < toTs;
  });
}

export function loadMessages(fromTs: number, toTs: number): WhatsappMessage[] {
  const result = listMessageFiles(fromTs, toTs).flatMap((filePath) =>
    parseFile(filePath, fromTs, toTs),
  );

  const processed = getProcessedIds();
  const subscribedChatJids = getSubscribedChatJids();
  const filtered = result
    .filter((m) => !processed.has(m.messageId))
    .filter((m) => subscribedChatJids.includes(m.chatJid))
    .sort((a, b) => a.timestamp - b.timestamp);

  appLogger.info("Loaded messages for digest", {
    loaded: filtered.length,
    skipped: result.length - filtered.length,
    fromTs,
    toTs,
  });

  return filtered;
}

export function getLatestMessageForChat(chatJid: string): WhatsappMessage | undefined {
  let latest: WhatsappMessage | undefined;
  const nowTs = Math.ceil(Date.now() / 1000);
  const fromTs = nowTs - Math.max(config.messageRetentionHours, 1) * 60 * 60;

  for (const filePath of listMessageFiles(fromTs, nowTs + 1)) {
    for (const message of parseFile(filePath)) {
      if (message.chatJid !== chatJid) continue;
      if (!latest || message.timestamp > latest.timestamp) latest = message;
    }
  }

  return latest;
}

export function markProcessed(ids: Iterable<string>): void {
  const processed = getProcessedIds();
  let added = 0;

  for (const id of ids) {
    if (!processed.has(id)) {
      processed.add(id);
      added += 1;
    }
  }

  if (added === 0) return;

  try {
    fs.mkdirSync(path.dirname(processedFile), { recursive: true });
    fs.writeFileSync(
      processedFile,
      JSON.stringify(Object.fromEntries([...processed].map((id) => [id, true])), null, 2),
      "utf-8"
    );
    appLogger.info("Marked messages as processed", { added, total: processed.size });
  } catch (err) {
    appLogger.error("Failed to write processed.json", err);
  }
}

export function markExistingMessagesUnprocessed(): {
  resetMessages: number;
  existingMessages: number;
  processedBefore: number;
  processedAfter: number;
} {
  const processed = getProcessedIds();
  const processedBefore = processed.size;
  const existingMessageIds = new Set<string>();

  for (const filePath of listStoredMessageFiles()) {
    for (const message of parseFile(filePath)) {
      existingMessageIds.add(message.messageId);
    }
  }

  let resetMessages = 0;
  for (const id of existingMessageIds) {
    if (!processed.delete(id)) continue;
    resetMessages += 1;
  }

  if (resetMessages > 0) {
    fs.mkdirSync(path.dirname(processedFile), { recursive: true });
    fs.writeFileSync(
      processedFile,
      JSON.stringify(Object.fromEntries([...processed].map((id) => [id, true])), null, 2),
      "utf-8",
    );
  }

  appLogger.info("Marked existing messages as unprocessed", {
    resetMessages,
    existingMessages: existingMessageIds.size,
    processedBefore,
    processedAfter: processed.size,
  });

  return {
    resetMessages,
    existingMessages: existingMessageIds.size,
    processedBefore,
    processedAfter: processed.size,
  };
}

export function purgeOldMessages(
  retentionHours = config.messageRetentionHours,
  summarizedRetentionHours = config.summarizedMessageRetentionHours,
): {
  deletedFiles: number;
  cutoff: string;
} {
  if (!fs.existsSync(messagesDir)) {
    return { deletedFiles: 0, cutoff: new Date().toISOString() };
  }

  const safeHours = (hours: number, fallback: number) =>
    Math.max(1, Number.isFinite(hours) ? hours : fallback);
  const cutoffMs = Date.now() - safeHours(retentionHours, 168) * 60 * 60 * 1000;
  const summarizedCutoffMs =
    Date.now() - safeHours(summarizedRetentionHours, 24) * 60 * 60 * 1000;
  const processed = getProcessedIds();
  let deletedFiles = 0;

  // Past the hard cutoff a file always goes; past the summarized cutoff only once
  // every message in it was summarized, so a skipped or failed digest loses nothing.
  const removeIfOld = (filePath: string, bucketMs: number) => {
    if (bucketMs >= summarizedCutoffMs) return;
    if (bucketMs >= cutoffMs && parseFile(filePath).some((m) => !processed.has(m.messageId))) {
      return;
    }
    fs.unlinkSync(filePath);
    deletedFiles += 1;
  };

  for (const entry of fs.readdirSync(messagesDir, { withFileTypes: true })) {
    const entryPath = path.join(messagesDir, entry.name);

    if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;

    for (const file of fs.readdirSync(entryPath, { withFileTypes: true })) {
      if (!file.isFile() || !/^\d{2}\.ndjson$/.test(file.name)) continue;
      const bucketMs = Date.parse(`${entry.name}T${file.name.replace(".ndjson", "")}:59:59.999Z`);
      if (Number.isFinite(bucketMs)) removeIfOld(path.join(entryPath, file.name), bucketMs);
    }

    if (fs.readdirSync(entryPath).length === 0) fs.rmdirSync(entryPath);
  }

  let removedProcessed = 0;
  const retainedMessageIds = new Set<string>();
  for (const filePath of listStoredMessageFiles()) {
    for (const message of parseFile(filePath)) retainedMessageIds.add(message.messageId);
  }
  for (const id of [...processed]) {
    if (retainedMessageIds.has(id)) continue;
    processed.delete(id);
    removedProcessed += 1;
  }
  if (removedProcessed > 0) {
    fs.mkdirSync(path.dirname(processedFile), { recursive: true });
    fs.writeFileSync(
      processedFile,
      JSON.stringify(Object.fromEntries([...processed].map((id) => [id, true])), null, 2),
      "utf-8",
    );
  }

  if (deletedFiles > 0 || removedProcessed > 0) {
    appLogger.info("Purged old message storage", {
      deletedFiles,
      removedProcessed,
      cutoff: new Date(cutoffMs).toISOString(),
    });
  }

  return { deletedFiles, cutoff: new Date(cutoffMs).toISOString() };
}
