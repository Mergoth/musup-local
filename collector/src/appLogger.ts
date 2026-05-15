import { config } from "./config.js";

type AppLogLevel = "debug" | "info" | "warn" | "error";

const levelPriority: Record<AppLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const currentLevel =
  config.appLogLevel in levelPriority
    ? (config.appLogLevel as AppLogLevel)
    : "info";

function shouldLog(level: AppLogLevel): boolean {
  return levelPriority[level] >= levelPriority[currentLevel];
}

export const appLogger = {
  debug(message: string, data?: unknown) {
    if (shouldLog("debug")) console.log(message, data ?? "");
  },

  info(message: string, data?: unknown) {
    if (shouldLog("info")) console.log(message, data ?? "");
  },

  warn(message: string, data?: unknown) {
    if (shouldLog("warn")) console.warn(message, data ?? "");
  },

  error(message: string, data?: unknown) {
    if (shouldLog("error")) console.error(message, data ?? "");
  },
};
