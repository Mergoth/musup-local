import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { config } from "#src/config.js";
import { loadAdminConfig, saveAdminConfig } from "#src/adminConfig.js";

test("adminConfig should read and write digestCron correctly", () => {
  const configFile = path.join(config.dataDir, "config.json");
  const originalExists = fs.existsSync(configFile);
  let originalContent = "";
  if (originalExists) {
    originalContent = fs.readFileSync(configFile, "utf-8");
  }

  try {
    const testConfig = {
      allowedChatJids: ["test-jid-1"],
      processorChatJids: ["test-jid-2"],
      chatLabels: { "test-jid-1": "Label 1" },
      telegramChatIds: ["tg-1"],
      digestCron: "0 0 12 * * ?",
    };

    saveAdminConfig(testConfig);

    const loaded = loadAdminConfig();
    assert.strictEqual(loaded.digestCron, "0 0 12 * * ?");
    assert.deepStrictEqual(loaded.allowedChatJids, ["test-jid-1"]);

    // Test default fallback
    fs.writeFileSync(configFile, JSON.stringify({
      allowedChatJids: ["another-jid"],
      // missing digestCron
    }));

    const loadedFallback = loadAdminConfig();
    assert.strictEqual(loadedFallback.digestCron, config.digestCron); // should fall back to default
    assert.deepStrictEqual(loadedFallback.allowedChatJids, ["another-jid"]);

  } finally {
    // Restore
    if (originalExists) {
      fs.writeFileSync(configFile, originalContent, "utf-8");
      loadAdminConfig(); // reload to cache
    } else {
      try { fs.unlinkSync(configFile); } catch {}
    }
  }
});
