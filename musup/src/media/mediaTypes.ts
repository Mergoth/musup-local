export type MediaKind = "picture" | "voice";

export type MediaStatus =
  | "pending"
  | "done"
  | "failed"
  | "unavailable"
  | "skipped_too_large"
  | "skipped_view_once"
  | "not_configured";

export type MediaItem = {
  messageId: string;
  chatJid: string;
  kind: MediaKind;
  status: MediaStatus;
  mimeType: string;
  filePath: string | null;
  resultText: string | null;
  error: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
};

export const MAX_PICTURE_BYTES = 10 * 1024 * 1024;
export const MAX_VOICE_SECONDS = 600;
