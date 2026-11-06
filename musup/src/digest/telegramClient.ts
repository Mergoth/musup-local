import { appLogger } from "../appLogger.js";
import { getSettings } from "../db/database.js";
import { escapeTelegramHtml } from "./structuredSummary.js";

const TELEGRAM_CAPTION_LIMIT = 1024;

export type TelegramConnectionConfig = {
  telegramBotToken: string;
  telegramChatIds: string[];
};

function findSafeSplitIndex(text: string, maxLength: number): number {
  const candidate = text.slice(0, maxLength);

  const paragraphBreak = candidate.lastIndexOf("\n\n");
  if (paragraphBreak > maxLength * 0.5) return paragraphBreak;

  const lineBreak = candidate.lastIndexOf("\n");
  if (lineBreak > maxLength * 0.5) return lineBreak;

  const sentenceEnd = Math.max(
    candidate.lastIndexOf(". "),
    candidate.lastIndexOf("! "),
    candidate.lastIndexOf("? ")
  );
  if (sentenceEnd > maxLength * 0.5) return sentenceEnd + 1;

  return maxLength;
}

export function splitForTelegram(text: string, maxLength = 3900): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text.trim();

  while (remaining.length > maxLength) {
    const splitIndex = findSafeSplitIndex(remaining, maxLength);
    const chunk = remaining.slice(0, splitIndex).trim();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(splitIndex).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

async function sendChunk(text: string, botToken: string, chatId: string): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  const body = await response.text();

  if (!response.ok) {
    appLogger.error("Telegram API failed", { chatId, status: response.status, body });
    throw new Error(`Telegram API failed for chatId=${chatId}: status=${response.status}`);
  }
}

// Escapes first, then cuts on whole characters/entities so the caption stays valid HTML.
export function telegramPhotoCaption(text: string): string {
  const escaped = escapeTelegramHtml(text);
  if (escaped.length <= TELEGRAM_CAPTION_LIMIT) return escaped;

  let caption = "";
  for (const char of Array.from(text)) {
    const unit = escapeTelegramHtml(char);
    if (caption.length + unit.length > TELEGRAM_CAPTION_LIMIT - 1) break;
    caption += unit;
  }
  return `${caption}…`;
}

export async function sendTelegramPhoto(photo: Buffer, caption: string): Promise<void> {
  const { telegramBotToken: botToken, telegramChatIds: chatIds } = getSettings();
  if (!botToken || chatIds.length === 0) {
    throw new Error("Telegram bot token or chat IDs are not configured");
  }

  for (const chatId of chatIds) {
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("photo", new Blob([new Uint8Array(photo)]), "picture.jpg");
    if (caption) {
      form.append("caption", telegramPhotoCaption(caption));
      form.append("parse_mode", "HTML");
    }

    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
      method: "POST",
      body: form,
    });
    if (!response.ok) {
      const body = await response.text();
      appLogger.error("Telegram sendPhoto failed", { chatId, status: response.status, body });
      throw new Error(`Telegram sendPhoto failed for chatId=${chatId}: status=${response.status}`);
    }
  }
}

export async function sendTelegramMessage(text: string): Promise<void> {
  const settings = getSettings();
  await sendTelegramMessageWithConfig(text, settings);
}

export async function sendTelegramMessageWithConfig(
  text: string,
  settings: TelegramConnectionConfig
): Promise<void> {
  const botToken = settings.telegramBotToken;
  const chatIds = settings.telegramChatIds;

  if (!botToken || chatIds.length === 0) {
    throw new Error("Telegram bot token or chat IDs are not configured");
  }

  const chunks = splitForTelegram(text);
  appLogger.info("Sending Telegram message", {
    chunks: chunks.length,
    recipients: chatIds.length,
  });

  for (const chatId of chatIds) {
    for (const chunk of chunks) {
      await sendChunk(chunk, botToken, chatId);
    }
  }
}

export async function testTelegramConnection(settings: TelegramConnectionConfig): Promise<{
  ok: true;
  recipients: number;
}> {
  await sendTelegramMessageWithConfig("musup-local Telegram test: OK", settings);
  return {
    ok: true,
    recipients: settings.telegramChatIds.length,
  };
}
