import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import P from "pino";
import qrcode from "qrcode-terminal";
import { rmSync } from "fs";
import { config } from "#src/config.js";
import { normalizeMessage } from "#src/normalize.js";
import { appLogger } from "#src/appLogger.js";
import {
  initStore,
  getCachedChatName,
  registerChatName,
  appendMessage,
} from "#src/store.js";
import { setConnectionState, connectionEvents } from "#src/connectionState.js";
import { watchAdminConfig, getAdminConfig } from "#src/adminConfig.js";
import { startAdminServer } from "#src/adminServer.js";

startAdminServer(config.adminPort);

let currentSock: any = null;

watchAdminConfig((cfg) => {
  appLogger.info("Hot-reloaded allowedChatJids", { count: cfg.allowedChatJids.length });
});

// Warn if ALLOWED_CHAT_JIDS env var is set but config.json already exists and overrides it
const { allowedChatJids: configJsonJids } = getAdminConfig();
if (config.allowedChatJids.length > 0) {
  appLogger.info(
    "ALLOWED_CHAT_JIDS env var is set but config.json takes precedence — manage chat filters via the admin UI at http://localhost:8081"
  );
}

function isAllowedChat(chatJid: string): boolean {
  const { allowedChatJids } = getAdminConfig();
  if (allowedChatJids.length === 0) return true;
  return allowedChatJids.includes(chatJid);
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
  currentSock = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      appLogger.info("QR code available — scan at http://localhost:8081 or check terminal");
      qrcode.generate(qr, { small: true });
      setConnectionState({ status: "qr_pending", qr });
    }

    if (connection === "open") {
      appLogger.info("WhatsApp connected");
      setConnectionState({ status: "connected" });
    }

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      appLogger.warn("WhatsApp disconnected", { statusCode, shouldReconnect });
      setConnectionState({ status: "disconnected" });

      if (shouldReconnect) {
        setTimeout(() => {
          startCollector().catch((err) => {
            appLogger.error("Reconnect failed", err);
          });
        }, 5000);
      } else {
        appLogger.error("Logged out. Clearing auth folder.");
        try {
          rmSync(config.authDir, { recursive: true, force: true });
        } catch (err) {
          appLogger.warn("Could not clear auth folder", { err });
        }
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
        appLogger.debug("Message saved", { chatName, chatJid: normalized.chatJid });
      } catch (err) {
        appLogger.error("Failed to save message", { err, chatJid: normalized.chatJid });
      }
    }
  });

}

connectionEvents.on("reconnect", () => {
  appLogger.info("Reconnect triggered from admin UI");
  if (currentSock) {
    currentSock.end(undefined);
  }
});

startCollector().catch((err) => {
  appLogger.error("Fatal collector error", err);
  process.exit(1);
});
