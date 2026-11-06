import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  proto,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import fs from "fs";
import P from "pino";
import { config } from "./config.js";
import { normalizeMessage } from "./normalize.js";
import { appLogger } from "./appLogger.js";
import {
  initStore,
  appendMessage,
} from "./store.js";
import { getLatestMessageForChat, purgeOldMessages } from "./digest/messageStore.js";
import { purgeOldSummaries } from "./digest/summaryStore.js";
import { startDigestScheduler } from "./digest/scheduler.js";
import { ensurePromptTemplates } from "./digest/promptTemplates.js";
import { startServer } from "./server.js";
import {
  getChatName,
  getMessageAnchor,
  getSubscribedChatJids,
  initDatabase,
  purgeOldMessageAnchors,
  recordEvent,
  upsertChat,
  upsertMessageAnchor,
} from "./db/database.js";
import {
  incrementCounter,
  getRuntimeState,
  setWhatsappState,
} from "./runtimeState.js";
import { configureBackfillHandler, recordBackfillHistory } from "./whatsappBackfill.js";
import { configureWhatsappDeliveryHandler } from "./whatsappDelivery.js";
import type { NormalizedMessage } from "./normalize.js";

type MessageSource = "live" | "history";

function shouldStoreMessageText(chatJid: string): boolean {
  const subscribedChatJids = getSubscribedChatJids();
  return subscribedChatJids.includes(chatJid);
}

function isGroupChat(chatJid: string): boolean {
  return chatJid.endsWith("@g.us");
}

function jidToReadableId(jid: string): string {
  return jid
    .replace("@s.whatsapp.net", "")
    .replace("@g.us", "")
    .replace("@lid", "");
}

function clearWhatsappAuth(): void {
  fs.rmSync(config.authDir, { recursive: true, force: true });
}

async function resolveChatName(
  sock: any,
  chatJid: string,
  pushName?: string
): Promise<string> {
  const cached = getChatName(chatJid);
  if (cached) return cached;

  if (isGroupChat(chatJid)) {
    try {
      const metadata = await sock.groupMetadata(chatJid);
      const groupName = metadata?.subject;
      if (groupName) return groupName;
    } catch (err) {
      appLogger.warn("Failed to resolve group name", { chatJid, err });
    }
  }

  const contact = sock.contacts?.[chatJid];
  return (
    contact?.name ||
    contact?.notify ||
    contact?.verifiedName ||
    pushName ||
    jidToReadableId(chatJid)
  );
}

async function saveNormalizedMessage(
  normalized: NormalizedMessage,
  chatName: string,
  source: MessageSource,
): Promise<boolean> {
  upsertChat({
    jid: normalized.chatJid,
    name: chatName,
    type: isGroupChat(normalized.chatJid) ? "group" : "contact",
    messageTimestamp: normalized.timestamp,
  });
  upsertMessageAnchor({
    chatJid: normalized.chatJid,
    messageId: normalized.messageId,
    timestamp: normalized.timestamp,
    fromMe: normalized.fromMe,
    senderJid: normalized.senderJid,
  });
  incrementCounter("detectedChats");

  const skipReason = !shouldStoreMessageText(normalized.chatJid)
    ? "not_subscribed"
    : !normalized.text
      ? "no_text"
      : normalized.timestamp < Date.now() / 1000 - config.messageRetentionHours * 60 * 60
        ? "too_old"
        : null;
  if (skipReason) {
    incrementCounter("skippedMessages");
    if (skipReason !== "not_subscribed") {
      appLogger.info("Message skipped", {
        reason: skipReason,
        source,
        chatName,
        messageType: normalized.messageType,
        timestamp: normalized.timestamp,
      });
    }
    return false;
  }

  try {
    const appended = appendMessage(normalized, chatName);
    if (!appended) return false;
    incrementCounter("savedMessages");

    appLogger.debug("Message saved", {
      source,
      chatName,
      chatJid: normalized.chatJid,
      senderJid: normalized.senderJid,
      fromMe: normalized.fromMe,
      messageType: normalized.messageType,
      text: normalized.text,
    });
    return true;
  } catch (err) {
    appLogger.error("Failed to save message", {
      err,
      chatJid: normalized.chatJid,
    });
    recordEvent("error", "message.save_failed", "Failed to save message", {
      chatJid: normalized.chatJid,
      source,
    });
    return false;
  }
}

async function startCollector() {
  initStore();

  const logger = P({ level: config.logLevel });

  appLogger.info("Starting WhatsApp collector", {
    authDir: config.authDir,
  });

  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    syncFullHistory: config.whatsappSyncFullHistory,
    shouldSyncHistoryMessage: (message) =>
      message.syncType === proto.HistorySync.HistorySyncType.ON_DEMAND ||
      config.whatsappSyncFullHistory,
  });

  configureBackfillHandler(async (jid, count) => {
    if (getRuntimeState().whatsapp.connection !== "open") {
      throw new Error("WhatsApp must be connected before requesting backfill");
    }

    const anchor = getMessageAnchor(jid) || getLatestMessageForChat(jid);
    if (!anchor) {
      throw new Error(
        "Backfill needs at least one detected message from this chat as an anchor. Wait for any new message in the chat, then try again."
      );
    }

    const requestId = await sock.fetchMessageHistory(
      count,
      {
        remoteJid: anchor.chatJid,
        id: anchor.messageId,
        fromMe: anchor.fromMe,
        participant: anchor.senderJid,
      },
      anchor.timestamp,
    );

    recordEvent("info", "backfill.requested", "WhatsApp chat backfill requested", {
      jid,
      count,
      requestId,
      anchorMessageId: anchor.messageId,
      anchorTimestamp: anchor.timestamp,
    });

    return {
      status: "requested",
      jid,
      count,
      requestId,
      anchorMessageId: anchor.messageId,
      anchorTimestamp: anchor.timestamp,
      requestedAt: new Date().toISOString(),
    };
  });

  configureWhatsappDeliveryHandler(async (jid, text) => {
    const result = await sock.sendMessage(jid, { text });
    return {
      jid,
      messageId: result?.key?.id || undefined,
    };
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      setWhatsappState("qr", { qr });
      recordEvent("info", "whatsapp.qr", "WhatsApp QR code refreshed");
      appLogger.info("WhatsApp QR code refreshed — open the web UI to scan");
    }

    if (connection === "open") {
      setWhatsappState("open", { qr: null, statusCode: null });
      recordEvent("info", "whatsapp.open", "WhatsApp connected");
      appLogger.info("WhatsApp connected");
    }

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      setWhatsappState(shouldReconnect ? "close" : "logged_out", { statusCode });
      recordEvent("warn", "whatsapp.close", "WhatsApp disconnected", {
        statusCode,
        shouldReconnect,
      });

      appLogger.warn("WhatsApp disconnected", { statusCode, shouldReconnect });

      if (shouldReconnect) {
        setTimeout(() => {
          startCollector().catch((err) => {
            appLogger.error("Reconnect failed", err);
          });
        }, 5000);
      } else {
        appLogger.error("Logged out. Clearing WhatsApp auth and requesting a new QR.");
        recordEvent("error", "whatsapp.logged_out", "WhatsApp logged out");
        clearWhatsappAuth();
        setWhatsappState("starting", { qr: null, statusCode });
        setTimeout(() => {
          startCollector().catch((err) => {
            appLogger.error("Failed to restart collector after logout", err);
          });
        }, 1000);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify" && type !== "append") return;

    for (const message of messages) {
      const normalized = normalizeMessage(message);
      if (!normalized) continue;
      if (normalized.chatJid === "status@broadcast") continue;

      const chatName = await resolveChatName(
        sock,
        normalized.chatJid,
        message.pushName ?? undefined
      );
      await saveNormalizedMessage(normalized, chatName, type === "append" ? "history" : "live");
    }
  });

  sock.ev.on("messaging-history.set", async ({ messages, syncType, peerDataRequestSessionId }) => {
    let saved = 0;

    for (const message of messages) {
      const normalized = normalizeMessage(message);
      if (!normalized) continue;
      if (normalized.chatJid === "status@broadcast") continue;

      const chatName = await resolveChatName(
        sock,
        normalized.chatJid,
        message.pushName ?? undefined,
      );
      if (await saveNormalizedMessage(normalized, chatName, "history")) saved += 1;
    }

    const backfill = recordBackfillHistory(peerDataRequestSessionId, messages.length, saved);
    if (messages.length > 0 || backfill) {
      recordEvent("info", "backfill.history_received", "WhatsApp history messages received", {
        received: messages.length,
        saved,
        syncType,
        requestId: peerDataRequestSessionId,
        jid: backfill?.jid,
      });
    }
  });
}

await initDatabase();
ensurePromptTemplates();
purgeOldMessages();
purgeOldSummaries();
purgeOldMessageAnchors();
recordEvent("info", "app.start", "musup-local app started");

startCollector().catch((err) => {
  setWhatsappState("error");
  recordEvent("error", "collector.fatal", "Fatal collector error", {
    message: err instanceof Error ? err.message : String(err),
  });
  appLogger.error("Fatal collector error", err);
  process.exit(1);
});

startServer();
startDigestScheduler();
