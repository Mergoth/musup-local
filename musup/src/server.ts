import http from "http";
import fs from "fs";
import path from "path";
import { config } from "./config.js";
import { appLogger } from "./appLogger.js";
import { runDigest } from "./digest/digestService.js";
import { markExistingMessagesUnprocessed, purgeOldMessages } from "./digest/messageStore.js";
import {
  getDefaultPromptTemplate,
  getPromptTemplate,
  getPromptTemplateVersion,
  listPromptVersions,
  prunePromptVersions,
  resetPromptTemplate,
  updatePromptTemplate,
} from "./digest/promptTemplates.js";
import { listSummaries, purgeOldSummaries } from "./digest/summaryStore.js";
import { requestChatBackfill } from "./whatsappBackfill.js";
import { testWhatsappDelivery } from "./whatsappDelivery.js";
import { refreshDigestScheduler } from "./digest/scheduler.js";
import { testLlmConnection, type LlmConnectionConfig } from "./digest/llmClient.js";
import {
  testTelegramConnection,
  type TelegramConnectionConfig,
} from "./digest/telegramClient.js";
import {
  getSettings,
  listChats,
  listEvents,
  recordEvent,
  setChatSubscribed,
  updateSettings,
  validateWhatsappDeliveryTarget,
  type AppSettings,
} from "./db/database.js";
import { getLatestQr, getRuntimeState } from "./runtimeState.js";
import QRCode from "qrcode";

const publicDir = path.join(process.cwd(), "public");
const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  body: Record<string, unknown>
): void {
  const json = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

function sendSvg(res: http.ServerResponse, statusCode: number, svg: string): void {
  res.writeHead(statusCode, {
    "Content-Type": "image/svg+xml",
    "Content-Length": Buffer.byteLength(svg),
    "Cache-Control": "no-store",
  });
  res.end(svg);
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.destroy(new Error("Request body is too large"));
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function cleanSettingsPatch(input: unknown): Partial<AppSettings> {
  if (!input || typeof input !== "object") return {};
  const raw = input as Record<string, unknown>;
  const patch: Partial<AppSettings> = {};

  if (typeof raw.summarizationEnabled === "boolean") {
    patch.summarizationEnabled = raw.summarizationEnabled;
  }
  if (typeof raw.summaryLanguage === "string") patch.summaryLanguage = raw.summaryLanguage;
  if (typeof raw.whatsappDeliveryEnabled === "boolean") {
    patch.whatsappDeliveryEnabled = raw.whatsappDeliveryEnabled;
  }
  if (typeof raw.whatsappDeliveryChatJid === "string") {
    patch.whatsappDeliveryChatJid = raw.whatsappDeliveryChatJid;
  }
  if (typeof raw.telegramEnabled === "boolean") patch.telegramEnabled = raw.telegramEnabled;
  if (typeof raw.digestCron === "string") patch.digestCron = raw.digestCron;
  if (Array.isArray(raw.digestTimes)) {
    patch.digestTimes = raw.digestTimes.filter(
      (value): value is string => typeof value === "string"
    );
  }
  if (typeof raw.digestTimezone === "string") patch.digestTimezone = raw.digestTimezone;
  if (typeof raw.llmApiUrl === "string") patch.llmApiUrl = raw.llmApiUrl;
  if (typeof raw.llmModel === "string") patch.llmModel = raw.llmModel;
  if (typeof raw.llmApiKey === "string") patch.llmApiKey = raw.llmApiKey;
  if (typeof raw.telegramBotToken === "string") {
    patch.telegramBotToken = raw.telegramBotToken;
  }
  if (Array.isArray(raw.telegramChatIds)) {
    patch.telegramChatIds = raw.telegramChatIds.filter(
      (value): value is string => typeof value === "string"
    );
  }

  return patch;
}

function cleanLlmTestConfig(input: unknown): LlmConnectionConfig {
  if (!input || typeof input !== "object") {
    throw new Error("Expected LLM test settings");
  }

  const raw = input as Record<string, unknown>;
  return {
    llmApiUrl: typeof raw.llmApiUrl === "string" ? raw.llmApiUrl.trim() : "",
    llmModel: typeof raw.llmModel === "string" ? raw.llmModel.trim() : "",
    llmApiKey: typeof raw.llmApiKey === "string" ? raw.llmApiKey : "",
  };
}

function cleanTelegramTestConfig(input: unknown): TelegramConnectionConfig {
  if (!input || typeof input !== "object") {
    throw new Error("Expected Telegram test settings");
  }

  const raw = input as Record<string, unknown>;
  return {
    telegramBotToken:
      typeof raw.telegramBotToken === "string" ? raw.telegramBotToken.trim() : "",
    telegramChatIds: Array.isArray(raw.telegramChatIds)
      ? raw.telegramChatIds.filter((value): value is string => typeof value === "string")
      : [],
  };
}

function getUrl(req: http.IncomingMessage): URL {
  return new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
}

function sendFile(res: http.ServerResponse, filePath: string): void {
  const ext = path.extname(filePath);
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": contentTypes[ext] || "application/octet-stream",
    "Content-Length": body.length,
    "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=60",
  });
  res.end(body);
}

function tryServeStatic(url: URL, res: http.ServerResponse): boolean {
  const routePath = url.pathname === "/" ? "/index.html" : url.pathname;
  const relativePath = decodeURIComponent(routePath).replace(/^\/+/, "");
  const filePath = path.resolve(publicDir, relativePath);

  if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath)) return false;
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return false;

  sendFile(res, filePath);
  return true;
}

export function startServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    const url = getUrl(req);

    if (req.method === "POST" && url.pathname === "/jobs/whatsapp-summary") {
      appLogger.info("Manual digest trigger via HTTP");

      try {
        const result = await runDigest();
        recordEvent("info", "digest.manual", "Manual digest requested", result);
        sendJson(res, 200, result);
      } catch (err) {
        appLogger.error("Manual digest failed", err);
        const error = err instanceof Error ? err : new Error(String(err));
        sendJson(res, 500, {
          status: "error",
          error: error.message,
        });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/messages/mark-unprocessed") {
      try {
        const result = markExistingMessagesUnprocessed();
        recordEvent(
          "info",
          "messages.marked_unprocessed",
          "Existing messages marked as unprocessed",
          result,
        );
        sendJson(res, 200, { status: "ok", ...result });
      } catch (err) {
        appLogger.error("Failed to mark messages as unprocessed", err);
        const error = err instanceof Error ? err : new Error(String(err));
        sendJson(res, 500, { status: "error", error: error.message });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { status: "ok" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/status") {
      const settings = getSettings();
      const runtime = getRuntimeState();
      const chats = listChats();
      sendJson(res, 200, {
        status: "ok",
        runtime,
        qrAvailable: Boolean(getLatestQr()),
        summarizationEnabled: settings.summarizationEnabled,
        uptimeSeconds: Math.floor(
          (Date.now() - new Date(runtime.startedAt).getTime()) / 1000
        ),
        chatStats: {
          total: chats.length,
          subscribed: chats.filter((chat) => chat.subscribed).length,
          groups: chats.filter((chat) => chat.type === "group").length,
          contacts: chats.filter((chat) => chat.type === "contact").length,
        },
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/settings") {
      sendJson(res, 200, getSettings());
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/prompts/summary") {
      const version = Number(url.searchParams.get("version") || 0);
      sendJson(res, 200, {
        template: Number.isInteger(version) && version > 0
          ? getPromptTemplateVersion(version)
          : getPromptTemplate(),
        defaults: getDefaultPromptTemplate(),
        versions: listPromptVersions(),
      });
      return;
    }

    if (req.method === "PUT" && url.pathname === "/api/prompts/summary") {
      try {
        const template = updatePromptTemplate(await readJsonBody(req));
        recordEvent("info", "prompt.updated", "Summary prompt template updated", {
          version: template.version,
        });
        sendJson(res, 200, { template, versions: listPromptVersions() });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        sendJson(res, 400, { status: "error", error: error.message });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/prompts/summary/reset") {
      try {
        const template = resetPromptTemplate();
        recordEvent("info", "prompt.reset", "Summary prompt template reset", {
          version: template.version,
        });
        sendJson(res, 200, { template, versions: listPromptVersions() });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        sendJson(res, 400, { status: "error", error: error.message });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/prompts/summary/prune") {
      try {
        const result = prunePromptVersions(10);
        recordEvent("info", "prompt.pruned", "Summary prompt versions pruned", {
          deleted: result.deleted,
        });
        sendJson(res, 200, { ...result, template: getPromptTemplate() });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        sendJson(res, 400, { status: "error", error: error.message });
      }
      return;
    }

    if (req.method === "PUT" && url.pathname === "/api/settings") {
      try {
        const patch = cleanSettingsPatch(await readJsonBody(req));
        const settings = updateSettings(patch);
        if ("digestCron" in patch || "digestTimes" in patch || "digestTimezone" in patch) {
          refreshDigestScheduler("settings.saved");
        }
        recordEvent("info", "settings.updated", "Settings updated", Object.keys(patch));
        sendJson(res, 200, settings);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        sendJson(res, 400, { status: "error", error: error.message });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/settings/test-llm") {
      try {
        const result = await testLlmConnection(cleanLlmTestConfig(await readJsonBody(req)));
        recordEvent("info", "settings.llm_test", "LLM test succeeded", {
          model: result.model,
          latencyMs: result.latencyMs,
        });
        sendJson(res, 200, result);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        recordEvent("warn", "settings.llm_test_failed", "LLM test failed", {
          error: error.message,
        });
        sendJson(res, 400, {
          ok: false,
          error: error.message,
        });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/settings/test-telegram") {
      try {
        const result = await testTelegramConnection(
          cleanTelegramTestConfig(await readJsonBody(req))
        );
        recordEvent("info", "settings.telegram_test", "Telegram test succeeded", {
          recipients: result.recipients,
        });
        sendJson(res, 200, result);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        recordEvent("warn", "settings.telegram_test_failed", "Telegram test failed", {
          error: error.message,
        });
        sendJson(res, 400, {
          ok: false,
          error: error.message,
        });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/settings/test-whatsapp") {
      try {
        const body = await readJsonBody(req);
        const jid =
          body && typeof body === "object" && typeof (body as { jid?: unknown }).jid === "string"
            ? (body as { jid: string }).jid.trim()
            : "";
        validateWhatsappDeliveryTarget(jid);
        const result = await testWhatsappDelivery(jid);
        recordEvent("info", "settings.whatsapp_test", "WhatsApp delivery test succeeded", {
          jid: result.jid,
          messageId: result.messageId,
        });
        sendJson(res, 200, result);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        recordEvent("warn", "settings.whatsapp_test_failed", "WhatsApp delivery test failed", {
          error: error.message,
        });
        sendJson(res, 400, {
          ok: false,
          error: error.message,
        });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/chats") {
      sendJson(res, 200, { chats: listChats() });
      return;
    }

    const subscriptionMatch = url.pathname.match(/^\/api\/chats\/([^/]+)\/subscription$/);
    if (req.method === "PUT" && subscriptionMatch) {
      try {
        const jid = decodeURIComponent(subscriptionMatch[1] || "");
        const body = await readJsonBody(req);
        const subscribed =
          body && typeof body === "object" && "subscribed" in body
            ? Boolean((body as { subscribed: unknown }).subscribed)
            : false;
        const chat = setChatSubscribed(jid, subscribed);

        if (!chat) {
          sendJson(res, 404, { status: "not_found" });
          return;
        }

        recordEvent("info", "chat.subscription", "Chat subscription updated", {
          jid,
          subscribed,
        });
        sendJson(res, 200, chat);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        sendJson(res, 400, { status: "error", error: error.message });
      }
      return;
    }

    // Dormant endpoint: kept for local experiments, but intentionally not linked
    // from the admin UI while WhatsApp history backfill is unreliable.
    const backfillMatch = url.pathname.match(/^\/api\/chats\/([^/]+)\/backfill$/);
    if (req.method === "POST" && backfillMatch) {
      try {
        const jid = decodeURIComponent(backfillMatch[1] || "");
        const body = await readJsonBody(req);
        const count =
          body && typeof body === "object" && typeof (body as { count?: unknown }).count === "number"
            ? Number((body as { count: number }).count)
            : 50;
        const result = await requestChatBackfill(jid, count);
        sendJson(res, 200, result);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        recordEvent("error", "backfill.request_failed", "Backfill request failed", {
          message: error.message,
        });
        sendJson(res, 400, { status: "error", error: error.message });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      const limit = Number(url.searchParams.get("limit") || 50);
      sendJson(res, 200, { events: listEvents(limit) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/summaries") {
      const limit = Number(url.searchParams.get("limit") || 50);
      sendJson(res, 200, { summaries: listSummaries(limit) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/messages/purge") {
      const result = purgeOldMessages();
      recordEvent("info", "messages.purged", "Old message files purged", result);
      sendJson(res, 200, { status: "ok", ...result });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/summaries/purge") {
      const result = purgeOldSummaries();
      recordEvent("info", "summaries.purged", "Old summary files purged", result);
      sendJson(res, 200, { status: "ok", ...result });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/qr") {
      const qr = getLatestQr();
      if (!qr) {
        sendJson(res, 404, { status: "not_available" });
        return;
      }

      sendSvg(res, 200, await QRCode.toString(qr, { type: "svg", margin: 2 }));
      return;
    }

    if (req.method === "GET" && tryServeStatic(url, res)) {
      return;
    }

    sendJson(res, 404, { status: "not_found" });
  });

  server.listen(config.port, () => {
    appLogger.info("HTTP server listening", { port: config.port });
  });

  return server;
}
