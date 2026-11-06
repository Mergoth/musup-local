import fs from "fs";
import path from "path";
import type { WAMessage } from "@whiskeysockets/baileys";
import { appLogger } from "../appLogger.js";
import { recordEvent } from "../db/database.js";
import type { NormalizedMessage } from "../normalize.js";
import { mediaDir, updateMediaItem, upsertMediaItem } from "./mediaStore.js";
import { MAX_PICTURE_BYTES, MAX_VOICE_SECONDS } from "./mediaTypes.js";
import { withTimeout } from "./timeout.js";

export type MediaDownloader = (message: WAMessage) => Promise<Buffer>;

// Baileys' download (and its re-upload request for expired media) has no timeout of its own.
const DOWNLOAD_TIMEOUT_MS = 60_000;
let downloads: Promise<unknown> = Promise.resolve();

// Message ids come from the sender; keep them from steering the file path.
function safeFileName(messageId: string): string {
  return messageId.replace(/[^A-Za-z0-9_-]/g, "_") || "media";
}

function extensionFor(mimeType: string): string {
  const type = mimeType.split(";")[0]?.trim().toLowerCase() || "";
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "audio/ogg") return "ogg";
  return "bin";
}

// Records and downloads a picture or voice note. Returns true when a new file is ready to process.
export async function ingestMedia(
  message: WAMessage,
  normalized: NormalizedMessage,
  download: MediaDownloader,
  opts: { timeoutMs?: number } = {},
): Promise<boolean> {
  const media = normalized.media;
  if (!media) return false;

  const base = {
    messageId: normalized.messageId,
    chatJid: normalized.chatJid,
    kind: media.kind,
    mimeType: media.mimeType,
  };

  if (media.viewOnce) {
    upsertMediaItem({ ...base, status: "skipped_view_once" });
    return false;
  }

  const tooLarge =
    media.kind === "picture"
      ? (media.fileLength ?? 0) > MAX_PICTURE_BYTES
      : (media.seconds ?? 0) > MAX_VOICE_SECONDS;
  if (tooLarge) {
    upsertMediaItem({ ...base, status: "skipped_too_large" });
    return false;
  }

  if (!upsertMediaItem({ ...base, status: "downloading" })) return false;

  try {
    const data = await withTimeout(download(message), opts.timeoutMs ?? DOWNLOAD_TIMEOUT_MS);
    fs.mkdirSync(mediaDir(), { recursive: true });
    const filePath = path.join(
      mediaDir(),
      `${safeFileName(normalized.messageId)}.${extensionFor(media.mimeType)}`,
    );
    fs.writeFileSync(filePath, data);
    updateMediaItem(normalized.messageId, { status: "pending", filePath });
    return true;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    appLogger.warn("Media download failed", { messageId: normalized.messageId, error: error.message });
    updateMediaItem(normalized.messageId, { status: "unavailable", error: error.message });
    recordEvent("warn", "media.download_failed", "Failed to download WhatsApp media", {
      messageId: normalized.messageId,
      chatJid: normalized.chatJid,
      kind: media.kind,
      error: error.message,
    });
    return false;
  }
}

// Downloads run one at a time in the background so media never holds up saving messages.
export function scheduleMediaIngest(
  message: WAMessage,
  normalized: NormalizedMessage,
  download: MediaDownloader,
  onReady: (messageId: string) => void,
): void {
  downloads = downloads
    .then(async () => {
      if (await ingestMedia(message, normalized, download)) onReady(normalized.messageId);
    })
    .catch((err) => appLogger.error("Failed to ingest media", { err, messageId: normalized.messageId }));
}
