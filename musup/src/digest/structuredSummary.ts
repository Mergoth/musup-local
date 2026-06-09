export type StructuredSummaryChat = {
  chatJid?: string;
  chatName: string;
  discussed: string[];
  conclusions: string[];
  actionItems: string[];
};

export type StructuredSummary = {
  noActionRequiredText: string;
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

function escapeTelegramHtml(value: string): string {
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
      discussed: readStringArray(item.discussed),
      conclusions: readStringArray(item.conclusions),
      actionItems: readStringArray(item.actionItems),
    }))
    .filter(
      (chat) =>
        chat.chatName ||
        chat.discussed.length > 0 ||
        chat.conclusions.length > 0 ||
        chat.actionItems.length > 0,
    );

  return {
    noActionRequiredText: readString(root.noActionRequiredText) || "No action required",
    emptySummaryText: readString(root.emptySummaryText) || "No meaningful updates",
    chats,
  };
}

function renderBulletList(items: string[], marker: string): string[] {
  return items.map((item) => `${marker} ${escapeTelegramHtml(item)}`);
}

export function renderStructuredSummary(summary: StructuredSummary): string {
  if (summary.chats.length === 0) {
    return escapeTelegramHtml(summary.emptySummaryText);
  }

  const blocks = summary.chats.map((chat) => {
    const lines = [`<b>${escapeTelegramHtml(chat.chatName)}</b>`];

    lines.push("", "<b>Discussed</b>");
    lines.push(...(chat.discussed.length > 0 ? renderBulletList(chat.discussed, "•") : ["• -"]));

    lines.push("", "<b>Conclusions</b>");
    lines.push(...(chat.conclusions.length > 0 ? renderBulletList(chat.conclusions, "•") : ["• -"]));

    lines.push("", "<b>Action items</b>");
    lines.push(
      ...(chat.actionItems.length > 0
        ? renderBulletList(chat.actionItems, "✅")
        : [`✅ ${escapeTelegramHtml(summary.noActionRequiredText)}`]),
    );

    return lines.join("\n");
  });

  return blocks.join("\n\n");
}
