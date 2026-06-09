import dotenv from "dotenv";

dotenv.config();

const dataDir = process.env.DATA_DIR || "./data";

export const config = {
  dataDir,
  authDir: process.env.AUTH_DIR || `${dataDir}/auth`,
  logLevel: process.env.LOG_LEVEL || "silent",
  appLogLevel: process.env.APP_LOG_LEVEL || "info",

  digestCron: "0 0 9,18 * * ?",
  digestTimezone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  messageRetentionHours: 24,
  summaryRetentionHours: 36,
  whatsappSyncFullHistory: process.env.WHATSAPP_SYNC_FULL_HISTORY === "true",

  llmApiUrl: "http://localhost:11434/v1/chat/completions",
  llmModel: "llama3.2",
  llmApiKey: "",

  telegramBotToken: "",
  telegramChatIds: [] as string[],

  port: Number(process.env.PORT || 8787),
};
