import dotenv from "dotenv";
import path from "path";

dotenv.config();

const dataDir = process.env.DATA_DIR || "./data";
const authDir = process.env.AUTH_DIR || path.join(dataDir, "auth");

export const config = {
  dataDir,
  authDir,
  logLevel: process.env.LOG_LEVEL || "silent",
  appLogLevel: process.env.APP_LOG_LEVEL || "info",

  allowedChatJids: (process.env.ALLOWED_CHAT_JIDS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean),

  classroom: {
    credentialsPath: process.env.CLASSROOM_CREDENTIALS_PATH || "",
    tokenPath:
      process.env.CLASSROOM_TOKEN_PATH ||
      path.join(authDir, "classroom-token.json"),
    statePath: path.join(dataDir, "classroom-state.json"),
    pollIntervalMinutes: parseInt(
      process.env.CLASSROOM_POLL_INTERVAL_MINUTES || "30",
      10
    ),
    // How far back to look on the very first poll (7 days)
    initialWindowMs: 7 * 24 * 60 * 60 * 1000,
  },

  ipasen: {
    username: process.env.IPASEN_USERNAME || "",
    password: process.env.IPASEN_PASSWORD || "",
    pollIntervalMinutes: parseInt(
      process.env.IPASEN_POLL_INTERVAL_MINUTES || "60",
      10
    ),
    statePath: path.join(dataDir, "ipasen-state.json"),
  },
};
