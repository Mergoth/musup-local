import { config } from "../config.js";
import { appLogger } from "../appLogger.js";
import { loadMessages, markProcessed } from "./messageStore.js";
import { buildPrompt } from "./promptBuilder.js";
import { summarize } from "./llmClient.js";
import { sendTelegramMessage, sendTelegramPhoto } from "./telegramClient.js";
import {
  sendWhatsappImage,
  sendWhatsappText,
  telegramHtmlToWhatsappText,
} from "../whatsappDelivery.js";
import { deliverDigest, type DeliveryTarget } from "./digestDelivery.js";
import type { DigestResult } from "./types.js";
import { parseStructuredSummary, renderStructuredSummary } from "./structuredSummary.js";
import { purgeOldMessages } from "./messageStore.js";
import { ensureMediaProcessed } from "../media/mediaWorker.js";
import { deleteMediaFile, getMediaItems } from "../media/mediaStore.js";
import { applyMediaText } from "../media/mediaText.js";
import { purgeOldSummaries, recordSummary } from "./summaryStore.js";
import { getSettings, purgeOldMessageAnchors, recordEvent } from "../db/database.js";
import {
  markDigestFailed,
  markDigestFinished,
  markDigestStarted,
} from "../runtimeState.js";

function safeRecordSummary(input: Parameters<typeof recordSummary>[0]): void {
  try {
    recordSummary(input);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    appLogger.error("Failed to record summary journal entry", error);
    recordEvent("error", "summary.record_failed", "Failed to record summary journal entry", {
      message: error.message,
    });
  }
}

export async function runDigest(): Promise<DigestResult> {
  markDigestStarted();
  const now = new Date();
  const settings = getSettings();
  const from = new Date(now.getTime() - config.messageRetentionHours * 60 * 60 * 1000);

  try {
    if (!settings.summarizationEnabled) {
      const result: DigestResult = {
        status: "disabled",
        messageCount: 0,
        from: from.toISOString(),
        to: now.toISOString(),
        reason: "Summarization is disabled",
      };
      appLogger.info("Digest skipped because summarization is disabled");
      recordEvent("info", "digest.disabled", "Digest skipped because summarization is disabled");
      safeRecordSummary(result);
      markDigestFinished(result);
      return result;
    }

    const missing = [
      !settings.llmApiKey ? "LLM API key" : null,
      !settings.llmApiUrl ? "LLM API URL" : null,
      !settings.llmModel ? "LLM model" : null,
      settings.telegramEnabled && !settings.telegramBotToken ? "Telegram bot token" : null,
      settings.telegramEnabled && settings.telegramChatIds.length === 0 ? "Telegram chat ID" : null,
      settings.whatsappDeliveryEnabled && !settings.whatsappDeliveryChatJid
        ? "WhatsApp delivery target"
        : null,
    ].filter((value): value is string => Boolean(value));

    if (missing.length > 0) {
      throw new Error(`Cannot run digest. Missing: ${missing.join(", ")}`);
    }

    appLogger.info("Running digest", {
      from: from.toISOString(),
      to: now.toISOString(),
    });
    recordEvent("info", "digest.started", "Digest run started", {
      from: from.toISOString(),
      to: now.toISOString(),
      retentionHours: config.messageRetentionHours,
    });

    const loadedMessages = loadMessages(
      Math.floor(from.getTime() / 1000),
      Math.floor(now.getTime() / 1000)
    );
    const messageIds = loadedMessages.map((message) => message.messageId);
    await ensureMediaProcessed(messageIds);
    const messages = applyMediaText(loadedMessages, getMediaItems(messageIds));

    if (messages.length === 0) {
      appLogger.info("No new messages in window");
      const result: DigestResult = {
        status: "no_messages",
        messageCount: 0,
        from: from.toISOString(),
        to: now.toISOString(),
      };
      recordEvent("info", "digest.no_messages", "Digest found no new messages", {
        from: from.toISOString(),
        to: now.toISOString(),
      });
      safeRecordSummary(result);
      markDigestFinished(result);
      return result;
    }

    const prompt = buildPrompt(messages, from, now);
    const rawSummary = await summarize(prompt);
    const structured = parseStructuredSummary(rawSummary);
    const summary = renderStructuredSummary(structured);

    const targets: DeliveryTarget[] = [];
    if (settings.telegramEnabled) {
      targets.push({
        name: "telegram",
        sendText: (html) => sendTelegramMessage(html),
        sendPhoto: (photo, caption) => sendTelegramPhoto(photo, caption),
      });
    } else {
      recordEvent("info", "telegram.skipped", "Telegram delivery skipped because it is disabled");
    }
    if (settings.whatsappDeliveryEnabled) {
      const jid = settings.whatsappDeliveryChatJid;
      targets.push({
        name: "whatsapp",
        sendText: async (html) => {
          await sendWhatsappText(jid, telegramHtmlToWhatsappText(html));
        },
        sendPhoto: async (photo, caption) => {
          await sendWhatsappImage(jid, photo, caption);
        },
      });
    } else {
      recordEvent("info", "whatsapp.delivery_skipped", "WhatsApp delivery skipped because it is disabled");
    }

    const delivery = await deliverDigest(structured, messages, targets);
    if (targets.length > 0 && structured.chats.length > 0 && delivery.deliveredChats === 0) {
      throw new Error("Digest delivery failed for every chat");
    }
    if (settings.whatsappDeliveryEnabled) {
      recordEvent("info", "whatsapp.delivery_sent", "WhatsApp digest delivered", {
        jid: settings.whatsappDeliveryChatJid,
      });
    }

    // Chats that failed stay unprocessed so the next digest retries them, pictures included.
    const processed = messages.filter((message) => !delivery.failedChatJids.has(message.chatJid));
    markProcessed(processed.map((message) => message.messageId));
    for (const message of processed) {
      if (message.messageType === "imageMessage") deleteMediaFile(message.messageId);
    }

    appLogger.info("Digest complete", {
      messageCount: processed.length,
      failedChats: delivery.failedChatJids.size,
      pictures: delivery.sentPictures.length,
    });
    recordEvent("info", "digest.complete", "Digest completed", {
      messageCount: processed.length,
      failedChats: delivery.failedChatJids.size,
      picturesSent: delivery.sentPictures.length,
      deliveredToTelegram: settings.telegramEnabled,
      deliveredToWhatsapp: settings.whatsappDeliveryEnabled,
    });
    const result: DigestResult = {
      status: "ok",
      messageCount: processed.length,
      from: from.toISOString(),
      to: now.toISOString(),
      summary,
      deliveredToTelegram: settings.telegramEnabled,
      deliveredToWhatsapp: settings.whatsappDeliveryEnabled,
      pictures: delivery.sentPictures,
    };
    safeRecordSummary(result);
    markDigestFinished(result);
    return result;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    recordEvent("error", "digest.error", "Digest failed", { message: error.message });
    safeRecordSummary({
      status: "error",
      messageCount: 0,
      from: from.toISOString(),
      to: now.toISOString(),
      error: error.message,
    });
    markDigestFailed(error);
    throw error;
  } finally {
    try {
      purgeOldMessages();
      purgeOldSummaries();
      purgeOldMessageAnchors();
    } catch (purgeErr) {
      const error = purgeErr instanceof Error ? purgeErr : new Error(String(purgeErr));
      appLogger.warn("Failed to purge old digest storage", { message: error.message });
    }
  }
}
