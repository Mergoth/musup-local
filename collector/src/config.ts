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
  adminPort: parseInt(process.env.ADMIN_PORT || "8081", 10),
  adminUser: process.env.ADMIN_USER || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || "",
};
