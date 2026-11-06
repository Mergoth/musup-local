import fs from "fs";
import { appLogger } from "../appLogger.js";
import { recordEvent } from "../db/database.js";
import {
  escapeTelegramHtml,
  renderChatBlock,
  selectPictures,
  type StructuredSummary,
  type SummaryPicture,
} from "./structuredSummary.js";
import type { WhatsappMessage } from "./types.js";

// A delivery channel. Text arrives as Telegram HTML; each target converts as it needs.
export type DeliveryTarget = {
  name: string;
  sendText: (html: string) => Promise<void>;
  sendPhoto: (photo: Buffer, caption: string) => Promise<void>;
};

export type DeliveryOutcome = {
  deliveredChats: number;
  failedChatJids: Set<string>;
  sentPictures: SummaryPicture[];
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Chat by chat: its text block to every target, then its pictures. A failed chat is
// reported so its messages stay unprocessed; a failed picture is only logged.
export async function deliverDigest(
  summary: StructuredSummary,
  messages: WhatsappMessage[],
  targets: DeliveryTarget[],
  readFile: (filePath: string) => Buffer = (filePath) => fs.readFileSync(filePath),
): Promise<DeliveryOutcome> {
  const outcome: DeliveryOutcome = { deliveredChats: 0, failedChatJids: new Set(), sentPictures: [] };

  if (summary.chats.length === 0) {
    const text = escapeTelegramHtml(summary.emptySummaryText);
    for (const target of targets) await target.sendText(text);
    return outcome;
  }

  const byId = new Map(messages.map((message) => [message.messageId, message]));

  for (const chat of summary.chats) {
    const block = renderChatBlock(chat, summary.noActionRequiredText);

    try {
      for (const target of targets) await target.sendText(block);
    } catch (err) {
      const chatJids = chat.chatJid
        ? [chat.chatJid]
        : messages.filter((message) => message.chatLabel === chat.chatName).map((message) => message.chatJid);
      for (const jid of chatJids) outcome.failedChatJids.add(jid);
      appLogger.error("Digest chat delivery failed", { chatName: chat.chatName, error: errorMessage(err) });
      recordEvent("error", "digest.chat_delivery_failed", "Failed to deliver a chat's digest", {
        chatName: chat.chatName,
        error: errorMessage(err),
      });
      continue;
    }
    outcome.deliveredChats += 1;

    for (const picture of selectPictures(chat, byId)) {
      let sent = false;
      try {
        const photo = readFile(picture.filePath);
        for (const target of targets) {
          try {
            await target.sendPhoto(photo, picture.caption);
            sent = true;
          } catch (err) {
            recordEvent("warn", "digest.picture_delivery_failed", "Failed to send a digest picture", {
              messageId: picture.messageId,
              target: target.name,
              error: errorMessage(err),
            });
          }
        }
      } catch (err) {
        recordEvent("warn", "digest.picture_delivery_failed", "Failed to read a digest picture", {
          messageId: picture.messageId,
          error: errorMessage(err),
        });
      }
      if (sent) outcome.sentPictures.push({ messageId: picture.messageId, caption: picture.caption });
    }
  }

  return outcome;
}
