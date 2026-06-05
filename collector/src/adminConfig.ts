import fs from "fs";
import path from "path";
import { appLogger } from "./appLogger.js";
import { config } from "./config.js";

export interface AdminConfig {
  allowedChatJids: string[];
  processorChatJids: string[];
  chatLabels: Record<string, string>;
  telegramChatIds: string[];
}

const configFile = path.join(config.dataDir, "config.json");

const defaults: AdminConfig = {
  allowedChatJids: config.allowedChatJids,
  processorChatJids: [],
  chatLabels: {},
  telegramChatIds: [],
};

let cached: AdminConfig = { ...defaults };

export function loadAdminConfig(): AdminConfig {
  if (!fs.existsSync(configFile)) {
    saveAdminConfig(defaults);
    return { ...defaults };
  }
  try {
    const raw = fs.readFileSync(configFile, "utf-8");
    cached = { ...defaults, ...JSON.parse(raw) };
  } catch (err) {
    appLogger.warn("Failed to read config.json, using defaults", { err });
    cached = { ...defaults };
  }
  return cached;
}

export function saveAdminConfig(cfg: AdminConfig): void {
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2), "utf-8");
  cached = cfg;
}

export function getAdminConfig(): AdminConfig {
  return cached;
}

export function watchAdminConfig(onChange: (cfg: AdminConfig) => void): void {
  loadAdminConfig();
  fs.watch(configFile, () => {
    try {
      const raw = fs.readFileSync(configFile, "utf-8");
      const next: AdminConfig = { ...defaults, ...JSON.parse(raw) };
      cached = next;
      appLogger.info("Reloaded config.json", { allowedChatJids: next.allowedChatJids.length });
      onChange(next);
    } catch (err) {
      appLogger.warn("Failed to reload config.json on change", { err });
    }
  });
}
