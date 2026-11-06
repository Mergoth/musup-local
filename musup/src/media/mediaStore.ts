import fs from "fs";
import path from "path";
import type { SqlValue } from "sql.js";
import { config } from "../config.js";
import { appLogger } from "../appLogger.js";
import { allRows, firstRow, getDb, saveDb } from "../db/database.js";
import type { MediaItem, MediaKind, MediaStatus } from "./mediaTypes.js";

export type MediaItemInput = {
  messageId: string;
  chatJid: string;
  kind: MediaKind;
  status: MediaStatus;
  mimeType: string;
  filePath?: string | null;
};

type MediaItemPatch = Partial<Pick<MediaItem, "status" | "resultText" | "error" | "attempts" | "filePath">>;

const columns: Record<keyof MediaItemPatch, string> = {
  status: "status",
  resultText: "result_text",
  error: "error",
  attempts: "attempts",
  filePath: "file_path",
};

export function mediaDir(): string {
  return path.join(config.dataDir, "media");
}

function toMediaItem(row: Record<string, SqlValue>): MediaItem {
  return {
    messageId: String(row.message_id),
    chatJid: String(row.chat_jid),
    kind: row.kind === "voice" ? "voice" : "picture",
    status: String(row.status) as MediaStatus,
    mimeType: String(row.mime_type || ""),
    filePath: row.file_path === null || row.file_path === undefined ? null : String(row.file_path),
    resultText: row.result_text === null || row.result_text === undefined ? null : String(row.result_text),
    error: row.error === null || row.error === undefined ? null : String(row.error),
    attempts: Number(row.attempts || 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function removeFile(filePath: string | null): void {
  if (!filePath) return;
  try {
    fs.rmSync(filePath, { force: true });
  } catch (err) {
    appLogger.warn("Failed to delete media file", { filePath, err });
  }
}

// Insert-or-ignore: returns true only when this message had no media record yet.
export function upsertMediaItem(input: MediaItemInput): boolean {
  const now = new Date().toISOString();
  getDb().run(
    `insert or ignore into media_items
       (message_id, chat_jid, kind, status, mime_type, file_path, attempts, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [input.messageId, input.chatJid, input.kind, input.status, input.mimeType, input.filePath ?? null, now, now],
  );
  const inserted = getDb().getRowsModified() > 0;
  if (inserted) saveDb();
  return inserted;
}

export function getMediaItem(messageId: string): MediaItem | undefined {
  const row = firstRow("select * from media_items where message_id = ?", [messageId]);
  return row ? toMediaItem(row) : undefined;
}

export function getMediaItems(messageIds: string[]): Map<string, MediaItem> {
  const items = new Map<string, MediaItem>();
  for (const messageId of messageIds) {
    const item = getMediaItem(messageId);
    if (item) items.set(messageId, item);
  }
  return items;
}

export function listMediaByStatus(statuses: MediaStatus[]): MediaItem[] {
  if (statuses.length === 0) return [];
  const placeholders = statuses.map(() => "?").join(", ");
  return allRows(
    `select * from media_items where status in (${placeholders}) order by created_at asc`,
    statuses,
  ).map(toMediaItem);
}

export function updateMediaItem(messageId: string, patch: MediaItemPatch): void {
  const entries = (Object.keys(patch) as Array<keyof MediaItemPatch>).filter((key) => patch[key] !== undefined);
  if (entries.length === 0) return;

  const assignments = entries.map((key) => `${columns[key]} = ?`).join(", ");
  const values = entries.map((key) => patch[key] as SqlValue);
  getDb().run(`update media_items set ${assignments}, updated_at = ? where message_id = ?`, [
    ...values,
    new Date().toISOString(),
    messageId,
  ]);
  saveDb();
}

export function deleteMediaFile(messageId: string): void {
  const item = getMediaItem(messageId);
  if (!item?.filePath) return;
  removeFile(item.filePath);
  updateMediaItem(messageId, { filePath: null });
}

// Drops records (and files) whose message is no longer retained.
export function purgeMediaItems(keepMessageIds: Set<string>): number {
  const stale = allRows("select message_id, file_path from media_items").filter(
    (row) => !keepMessageIds.has(String(row.message_id)),
  );
  if (stale.length === 0) return 0;

  for (const row of stale) {
    removeFile(row.file_path === null || row.file_path === undefined ? null : String(row.file_path));
    getDb().run("delete from media_items where message_id = ?", [String(row.message_id)]);
  }
  saveDb();
  return stale.length;
}

// Files left behind by a crash between download and bookkeeping.
export function purgeOrphanMediaFiles(): number {
  if (!fs.existsSync(mediaDir())) return 0;
  const owned = new Set(
    allRows("select file_path from media_items where file_path is not null").map((row) =>
      path.resolve(String(row.file_path)),
    ),
  );
  let removed = 0;
  for (const file of fs.readdirSync(mediaDir())) {
    const filePath = path.resolve(mediaDir(), file);
    if (owned.has(filePath)) continue;
    removeFile(filePath);
    removed += 1;
  }
  return removed;
}
