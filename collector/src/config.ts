import dotenv from "dotenv";

dotenv.config();

const dataDir = process.env.DATA_DIR || "./data";

export const config = {
  dataDir,
  authDir: process.env.AUTH_DIR || `${dataDir}/auth`,
  logLevel: process.env.LOG_LEVEL || "silent",
  appLogLevel: process.env.APP_LOG_LEVEL || "info",

  allowedChatJids: (process.env.ALLOWED_CHAT_JIDS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean),
  processorChatJids: (process.env.MUSUP_CHAT_JIDS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean),
  telegramChatIds: [
    process.env.TELEGRAM_CHAT_ID_1,
    process.env.TELEGRAM_CHAT_ID_2,
  ]
    .map((x) => x?.trim())
    .filter(Boolean) as string[],
  chatLabels: (process.env.MUSUP_CHAT_LABELS_CSV || "")
    .split(",")
    .filter((x) => x.includes("="))
    .reduce((acc, curr) => {
      const [k, v] = curr.split("=", 2);
      if (k && v) acc[k.trim()] = v.trim();
      return acc;
    }, {} as Record<string, string>),
  adminPort: parseInt(process.env.ADMIN_PORT || "8081", 10),
  adminUser: process.env.ADMIN_USER || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || "",
};
