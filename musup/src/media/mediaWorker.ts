import fs from "fs";
import { appLogger } from "../appLogger.js";
import { getSettings, recordEvent } from "../db/database.js";
import { getModelConfig, isModelConfigured } from "../digest/llmClient.js";
import { transcodeToMp3 } from "./ffmpeg.js";
import { describeImage, transcribeAudio } from "./mediaModels.js";
import {
  deleteMediaFile,
  getMediaItem,
  listMediaByStatus,
  purgeOrphanMediaFiles,
  updateMediaItem,
} from "./mediaStore.js";
import type { MediaItem, MediaKind } from "./mediaTypes.js";
import { withTimeout } from "./timeout.js";

export type WorkerDeps = {
  describeImage: typeof describeImage;
  transcribeAudio: typeof transcribeAudio;
  transcodeToMp3: typeof transcodeToMp3;
};

const defaultDeps: WorkerDeps = { describeImage, transcribeAudio, transcodeToMp3 };
const BACKGROUND_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 2;
const DIGEST_BUDGET_MS = 120_000;

const inFlight = new Map<string, Promise<MediaItem | undefined>>();
const notConfiguredReported = new Set<MediaKind>();
let queue: Promise<unknown> = Promise.resolve();

async function runModel(item: MediaItem, filePath: string, deps: WorkerDeps, timeoutMs: number): Promise<string> {
  const settings = getSettings();
  const data = fs.readFileSync(filePath);
  if (item.kind === "picture") {
    return deps.describeImage(data, item.mimeType, getModelConfig(settings, "vision"), { timeoutMs });
  }
  const mp3 = await deps.transcodeToMp3(data);
  return deps.transcribeAudio(mp3, getModelConfig(settings, "transcription"), { timeoutMs });
}

async function processNow(messageId: string, deps: WorkerDeps, timeoutMs: number): Promise<MediaItem | undefined> {
  const item = getMediaItem(messageId);
  if (!item || !["pending", "failed", "not_configured"].includes(item.status)) return item;

  const target = item.kind === "picture" ? "vision" : "transcription";
  if (!isModelConfigured(getModelConfig(getSettings(), target))) {
    updateMediaItem(messageId, { status: "not_configured" });
    if (!notConfiguredReported.has(item.kind)) {
      notConfiguredReported.add(item.kind);
      recordEvent("info", "media.not_configured", `Skipping ${item.kind} media: ${target} model is not configured`);
    }
    return getMediaItem(messageId);
  }

  if (!item.filePath || !fs.existsSync(item.filePath)) {
    updateMediaItem(messageId, { status: "unavailable", filePath: null });
    return getMediaItem(messageId);
  }

  try {
    const text = await withTimeout(runModel(item, item.filePath, deps, timeoutMs), timeoutMs);
    updateMediaItem(messageId, { status: "done", resultText: text, error: null });
    if (item.kind === "voice") deleteMediaFile(messageId);
    appLogger.info("Media processed", { messageId, kind: item.kind, length: text.length });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    updateMediaItem(messageId, { status: "failed", error: error.message, attempts: item.attempts + 1 });
    appLogger.warn("Media processing failed", { messageId, kind: item.kind, error: error.message });
    recordEvent("warn", "media.process_failed", "Failed to process WhatsApp media", {
      messageId,
      kind: item.kind,
      attempts: item.attempts + 1,
      error: error.message,
    });
  }
  return getMediaItem(messageId);
}

// One item at a time; a second request for the same item joins the first.
export function processMediaItem(
  messageId: string,
  deps: WorkerDeps = defaultDeps,
  opts: { timeoutMs?: number } = {},
): Promise<MediaItem | undefined> {
  const existing = inFlight.get(messageId);
  if (existing) return existing;

  const run = processNow(messageId, deps, opts.timeoutMs ?? BACKGROUND_TIMEOUT_MS).finally(() => {
    inFlight.delete(messageId);
  });
  inFlight.set(messageId, run);
  return run;
}

export function enqueueMedia(messageId: string): void {
  queue = queue
    .then(() => {
      const item = getMediaItem(messageId);
      if (item?.status === "pending") return processMediaItem(messageId);
      return undefined;
    })
    .catch((err) => appLogger.error("Media queue error", { messageId, err }));
}

export function startMediaWorker(): void {
  // A download interrupted by a restart can't be resumed: the WhatsApp message is gone.
  for (const item of listMediaByStatus(["downloading"])) {
    updateMediaItem(item.messageId, { status: "unavailable", error: "Interrupted by restart" });
  }
  const orphans = purgeOrphanMediaFiles();
  if (orphans > 0) appLogger.info("Removed orphan media files", { orphans });
  for (const item of listMediaByStatus(["pending"])) enqueueMedia(item.messageId);
}

// Digest-time catch-up: one more try for anything not done yet, within one overall budget
// so a slow model can't make the digest late. Never throws.
export async function ensureMediaProcessed(
  messageIds: string[],
  timeoutMs = 60_000,
  deps: WorkerDeps = defaultDeps,
  budgetMs = DIGEST_BUDGET_MS,
): Promise<void> {
  const deadline = Date.now() + budgetMs;
  for (const messageId of messageIds) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      appLogger.warn("Digest-time media catch-up ran out of time", { budgetMs });
      return;
    }
    const item = getMediaItem(messageId);
    if (!item) continue;
    const retry =
      item.status === "pending" ||
      item.status === "not_configured" ||
      (item.status === "failed" && item.attempts < MAX_ATTEMPTS);
    if (!retry) continue;

    try {
      const itemTimeoutMs = Math.min(timeoutMs, remaining);
      await withTimeout(processMediaItem(messageId, deps, { timeoutMs: itemTimeoutMs }), itemTimeoutMs + 1_000);
    } catch (err) {
      appLogger.warn("Digest-time media processing gave up", { messageId, err });
    }
  }
}
