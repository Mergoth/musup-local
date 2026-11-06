import fs from "fs";
import path from "path";
import type { WAMessage } from "@whiskeysockets/baileys";
import { appLogger } from "../appLogger.js";
import { recordEvent } from "../db/database.js";
import type { NormalizedMessage } from "../normalize.js";
import { mediaDir, updateMediaItem, upsertMediaItem } from "./mediaStore.js";
import { MAX_PICTURE_BYTES, MAX_VOICE_SECONDS } from "./mediaTypes.js";

export type MediaDownloader = (message: WAMessage) => Promise<Buffer>;

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

  if (!upsertMediaItem({ ...base, status: "pending" })) return false;

  try {
    const data = await download(message);
    fs.mkdirSync(mediaDir(), { recursive: true });
    const filePath = path.join(mediaDir(), `${normalized.messageId}.${extensionFor(media.mimeType)}`);
    fs.writeFileSync(filePath, data);
    updateMediaItem(normalized.messageId, { filePath });
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
