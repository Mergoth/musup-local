import type { WhatsappMessage } from "./types.js";

export type SummaryPicture = {
  messageId: string;
  caption: string;
};

// One request aimed at the reader: who asked, who it is for, and what to do (with when/where/what to bring).
export type ActionItem = {
  requestedBy: string;
  audience: string;
  action: string;
};

export type StructuredSummaryChat = {
  chatJid?: string;
  chatName: string;
  actionItems: ActionItem[];
  // Facts the reader should know that ask nothing of them; never a repeat of an action item.
  notes: string[];
  pictures: SummaryPicture[];
};

export type SelectedPicture = SummaryPicture & { filePath: string };

export type StructuredSummary = {
  // The verb between the requester and the action, e.g. "asks" / "просит".
  askedText: string;
  emptySummaryText: string;
  chats: StructuredSummaryChat[];
};

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("LLM returned no JSON object");
  }

  return withoutFence.slice(start, end + 1);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(readString).filter(Boolean);
}

// Models tend to add their own colon or brackets around these; the renderer adds them itself.
function readLabel(value: unknown): string {
  return readString(value)
    .replace(/[\s:：,.\-–—]+$/u, "")
    .replace(/^\((.*)\)$/su, "$1")
    .trim();
}

// Older answers used plain strings; keep them as actions without a requester.
function readActionItems(value: unknown): ActionItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): ActionItem => {
      if (typeof item === "string") return { requestedBy: "", audience: "", action: item.trim() };
      if (!item || typeof item !== "object") return { requestedBy: "", audience: "", action: "" };
      const raw = item as Record<string, unknown>;
      return {
        requestedBy: readLabel(raw.requestedBy),
        audience: readLabel(raw.audience),
        action: readString(raw.action),
      };
    })
    .filter((item) => item.action);
}

function readPictures(value: unknown): SummaryPicture[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({ messageId: readString(item.messageId), caption: readString(item.caption) }))
    .filter((picture) => picture.messageId);
}

export function escapeTelegramHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function parseStructuredSummary(raw: string): StructuredSummary {
  let parsed: unknown;

  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    throw new Error(`LLM returned invalid structured summary: ${error.message}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("LLM returned invalid structured summary: root must be an object");
  }

  const root = parsed as Record<string, unknown>;
  const rawChats = Array.isArray(root.chats) ? root.chats : [];
  const chats = rawChats
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      chatJid: readString(item.chatJid) || undefined,
      chatName: readString(item.chatName) || readString(item.chatLabel) || "Unknown chat",
      actionItems: readActionItems(item.actionItems),
      notes: readStringArray(item.notes),
      pictures: readPictures(item.pictures),
    }))
    // A chat with nothing for the reader is not posted at all.
    .filter((chat) => chat.actionItems.length > 0 || chat.notes.length > 0);

  return {
    askedText: readLabel(root.askedText) || "asks",
    emptySummaryText: readString(root.emptySummaryText) || "No meaningful updates",
    chats,
  };
}

function renderActionItem(item: ActionItem, askedText: string): string {
  const action = escapeTelegramHtml(item.action);
  const audience = escapeTelegramHtml(item.audience);
  if (!item.requestedBy) return `✅ ${audience ? `${audience}: ` : ""}${action}`;
  const requester = `<b>${escapeTelegramHtml(item.requestedBy)}</b> ${escapeTelegramHtml(askedText)}`;
  return `✅ ${requester}${audience ? ` (${audience})` : ""}: ${action}`;
}

export function renderChatBlock(chat: StructuredSummaryChat, askedText: string): string {
  return [
    `<b>${escapeTelegramHtml(chat.chatName)}</b>`,
    ...chat.actionItems.map((item) => renderActionItem(item, askedText)),
    ...chat.notes.map((note) => `ℹ️ ${escapeTelegramHtml(note)}`),
  ].join("\n");
}

// Used for the summaries journal; with no chats nothing is delivered.
export function renderStructuredSummary(summary: StructuredSummary): string {
  if (summary.chats.length === 0) {
    return escapeTelegramHtml(summary.emptySummaryText);
  }

  return summary.chats
    .map((chat) => renderChatBlock(chat, summary.askedText))
    .join("\n\n");
}

// The model may only pick real, still-stored pictures from the chat it is summarising.
export function selectPictures(
  chat: StructuredSummaryChat,
  sendable: Map<string, WhatsappMessage>,
): SelectedPicture[] {
  const selected: SelectedPicture[] = [];
  const seen = new Set<string>();

  for (const picture of chat.pictures) {
    const message = sendable.get(picture.messageId);
    if (!message?.sendablePicture || !message.pictureFilePath || seen.has(picture.messageId)) continue;
    const sameChat = chat.chatJid
      ? message.chatJid === chat.chatJid
      : message.chatLabel === chat.chatName;
    if (!sameChat) continue;

    seen.add(picture.messageId);
    selected.push({ ...picture, filePath: message.pictureFilePath });
  }

  return selected;
}
