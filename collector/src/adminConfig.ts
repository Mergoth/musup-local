import fs from "fs";
import path from "path";
import { appLogger } from "#src/appLogger.js";
import { config } from "#src/config.js";

export interface AdminConfig {
  allowedChatJids: string[];
  processorChatJids: string[];
  chatLabels: Record<string, string>;
  telegramChatIds: string[];
}

const configFile = path.join(config.dataDir, "config.json");

const defaults: AdminConfig = {
  allowedChatJids: [...config.allowedChatJids],
  processorChatJids: [...config.processorChatJids],
  chatLabels: { ...config.chatLabels },
  telegramChatIds: [...config.telegramChatIds],
};

let cached: AdminConfig = { ...defaults };

/**
 * Read config.json from disk, merge with defaults, and apply type guards.
 * If a field is present but has the wrong type, the default value is used.
 */
function readFromDisk(): AdminConfig {
  const raw = fs.readFileSync(configFile, "utf-8");
  const parsed: unknown = JSON.parse(raw);
  const obj = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};

  const allowedChatJids = Array.isArray(obj.allowedChatJids)
    ? (obj.allowedChatJids as string[])
    : defaults.allowedChatJids;
  const processorChatJids = Array.isArray(obj.processorChatJids)
    ? (obj.processorChatJids as string[])
    : defaults.processorChatJids;
  const telegramChatIds = Array.isArray(obj.telegramChatIds)
    ? (obj.telegramChatIds as string[])
    : defaults.telegramChatIds;
  const chatLabels =
    typeof obj.chatLabels === "object" && obj.chatLabels !== null && !Array.isArray(obj.chatLabels)
      ? (obj.chatLabels as Record<string, string>)
      : defaults.chatLabels;

  return { allowedChatJids, processorChatJids, telegramChatIds, chatLabels };
}

export function loadAdminConfig(): AdminConfig {
  if (!fs.existsSync(configFile)) {
    saveAdminConfig(defaults);
    return { ...defaults };
  }
  try {
    cached = readFromDisk();
  } catch (err) {
    appLogger.warn("Failed to read config.json, using defaults", { err });
    cached = { ...defaults };
  }
  return { ...cached };
}

export function saveAdminConfig(cfg: AdminConfig): void {
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2), "utf-8");
  // Store a shallow copy so callers cannot mutate our cached state
  cached = { ...cfg };
}

export function getAdminConfig(): AdminConfig {
  // Return a shallow copy to prevent callers from silently mutating cached state
  return { ...cached };
}

export function watchAdminConfig(onChange: (cfg: AdminConfig) => void): void {
  // Eagerly load so cached is populated before any watch event fires
  loadAdminConfig();
  // NOTE: fs.watch may not fire on NFS/CIFS (network) mounts such as those
  // commonly found on NAS devices. On such mounts, manual reload via the
  // admin API is the fallback.
  fs.watch(configFile, () => {
    try {
      const next = readFromDisk();
      cached = next;
      appLogger.info("Reloaded config.json", { allowedChatJids: next.allowedChatJids.length });
      onChange({ ...next });
    } catch (err) {
      appLogger.warn("Failed to reload config.json on change", { err });
    }
  });
}
