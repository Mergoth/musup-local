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
};
