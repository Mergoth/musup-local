import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import P from "pino";
import qrcode from "qrcode-terminal";
import { config } from "./config.js";
import { normalizeMessage } from "./normalize.js";
import { appLogger } from "./appLogger.js";
import {
  initStore,
  getCachedChatName,
  registerChatName,
  appendMessage,
} from "./store.js";
import { startClassroomPoller } from "./sources/classroom.js";
import { startIpasenPoller } from "./sources/ipasen.js";

function isAllowedChat(chatJid: string): boolean {
  if (config.allowedChatJids.length === 0) return true;
  return config.allowedChatJids.includes(chatJid);
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

async function resolveChatName(
  sock: any,
  chatJid: string,
  pushName?: string
): Promise<string> {
  const cached = getCachedChatName(chatJid);
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

async function startCollector() {
  initStore();

  const logger = P({ level: config.logLevel });

  appLogger.info("Starting WhatsApp collector", {
    authDir: config.authDir,
    allowedChatsCount: config.allowedChatJids.length,
  });

  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    syncFullHistory: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      appLogger.info("\nScan this QR with WhatsApp Linked Devices:\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      appLogger.info("WhatsApp connected");
    }

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      appLogger.warn("WhatsApp disconnected", { statusCode, shouldReconnect });

      if (shouldReconnect) {
        setTimeout(() => {
          startCollector().catch((err) => {
            appLogger.error("Reconnect failed", err);
          });
        }, 5000);
      } else {
        appLogger.error("Logged out. Delete auth folder and scan QR again.");
        process.exit(1);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const message of messages) {
      const normalized = normalizeMessage(message);
      if (!normalized) continue;
      if (normalized.chatJid === "status@broadcast") continue;

      // Resolve and persist the JID → name mapping for every seen chat,
      // regardless of whether it is in the allow-list. This keeps chats.json
      // complete so the user can look up JIDs when configuring ALLOWED_CHAT_JIDS.
      const chatName = await resolveChatName(
        sock,
        normalized.chatJid,
        message.pushName ?? undefined
      );
      registerChatName(normalized.chatJid, chatName);

      if (!isAllowedChat(normalized.chatJid)) continue;
      if (!normalized.text) continue;

      try {
        appendMessage(normalized, chatName);

        appLogger.debug("Message saved", {
          chatName,
          chatJid: normalized.chatJid,
          senderJid: normalized.senderJid,
          fromMe: normalized.fromMe,
          messageType: normalized.messageType,
          text: normalized.text,
        });
      } catch (err) {
        appLogger.error("Failed to save message", {
          err,
          chatJid: normalized.chatJid,
        });
      }
    }
  });
}

startCollector().catch((err) => {
  appLogger.error("Fatal collector error", err);
  process.exit(1);
});

startClassroomPoller();
startIpasenPoller();
