import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import initSqlJs, { type Database, type SqlValue } from "sql.js";
import { config } from "../config.js";

export type AppSettings = {
  summarizationEnabled: boolean;
  summaryLanguage: string;
  whatsappDeliveryEnabled: boolean;
  whatsappDeliveryChatJid: string;
  telegramEnabled: boolean;
  digestCron: string;
  digestTimes: string[];
  digestTimezone: string;
  llmApiUrl: string;
  llmModel: string;
  llmApiKey: string;
  telegramBotToken: string;
  telegramChatIds: string[];
};

export type StoredChat = {
  jid: string;
  name: string;
  type: "group" | "contact" | "unknown";
  subscribed: boolean;
  firstSeen: string;
  lastSeen: string;
  lastMessageAt: string | null;
  messageCount: number;
};

export type StoredEvent = {
  id: number;
  ts: string;
  level: string;
  type: string;
  message: string;
  data: unknown;
};

export type MessageAnchor = {
  chatJid: string;
  messageId: string;
  timestamp: number;
  fromMe: boolean;
  senderJid?: string;
  updatedAt: string;
};

const dbFile = path.join(config.dataDir, "musup.db");
let db: Database | undefined;

function sqlJsWasmPath(file: string): string {
  const currentFile = fileURLToPath(import.meta.url);
  return path.join(path.dirname(currentFile), "../../node_modules/sql.js/dist", file);
}

function saveDb(): void {
  if (!db) throw new Error("Database is not initialized");
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  fs.writeFileSync(dbFile, Buffer.from(db.export()));
}

function getDb(): Database {
  if (!db) throw new Error("Database is not initialized");
  return db;
}

function firstRow(sql: string, params: SqlValue[] = []): Record<string, SqlValue> | undefined {
  const stmt = getDb().prepare(sql, params);
  try {
    return stmt.step() ? stmt.getAsObject() : undefined;
  } finally {
    stmt.free();
  }
}

function allRows(sql: string, params: SqlValue[] = []): Record<string, SqlValue>[] {
  const stmt = getDb().prepare(sql, params);
  const rows: Record<string, SqlValue>[] = [];
  try {
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

function getSetting(key: string): string | undefined {
  const row = firstRow("select value from settings where key = ?", [key]);
  return typeof row?.value === "string" ? row.value : undefined;
}

function hasSetting(key: string): boolean {
  return Boolean(firstRow("select key from settings where key = ?", [key]));
}

function setSettingValue(key: string, value: string): void {
  getDb().run(
    `
      insert into settings (key, value, updated_at)
      values (?, ?, ?)
      on conflict(key) do update set
        value = excluded.value,
        updated_at = excluded.updated_at
    `,
    [key, value, new Date().toISOString()]
  );
}

function seedSetting(key: string, value: string): void {
  getDb().run(
    "insert or ignore into settings (key, value, updated_at) values (?, ?, ?)",
    [key, value, new Date().toISOString()]
  );
}

function parseJsonArray(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function cronToTimes(cron: string): string[] {
  const parts = cron.trim().split(/\s+/);
  const minute = Number(parts[1]);
  const hours = String(parts[2] || "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 23);

  if (!Number.isInteger(minute) || minute < 0 || minute > 59 || hours.length === 0) {
    return ["09:00", "18:00"];
  }

  return hours
    .sort((a, b) => a - b)
    .map((hour) => `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
}

function timesToCron(times: string[]): string {
  const normalized = times
    .filter((time) => /^\d{2}:\d{2}$/.test(time))
    .sort();
  const safeTimes = normalized.length > 0 ? normalized : ["09:00", "18:00"];
  const firstMinute = Number(safeTimes[0].slice(3, 5));
  const hours = safeTimes
    .filter((time) => Number(time.slice(3, 5)) === firstMinute)
    .map((time) => Number(time.slice(0, 2)));

  return `0 ${firstMinute} ${hours.join(",")} * * ?`;
}

function validateDigestTimezone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
  } catch {
    throw new Error("Digest timezone must be a valid IANA timezone");
  }
}

export async function initDatabase(): Promise<void> {
  const SQL = await initSqlJs({ locateFile: sqlJsWasmPath });
  const existing = fs.existsSync(dbFile) ? fs.readFileSync(dbFile) : undefined;
  db = existing ? new SQL.Database(existing) : new SQL.Database();

  getDb().exec(`
    create table if not exists settings (
      key text primary key,
      value text not null,
      updated_at text not null
    );

    create table if not exists chats (
      jid text primary key,
      name text not null,
      type text not null default 'unknown',
      subscribed integer not null default 0,
      first_seen text not null,
      last_seen text not null,
      last_message_at text,
      message_count integer not null default 0
    );

    create table if not exists events (
      id integer primary key autoincrement,
      ts text not null,
      level text not null,
      type text not null,
      message text not null,
      data text
    );

    create table if not exists message_anchors (
      chat_jid text primary key,
      message_id text not null,
      timestamp integer not null,
      from_me integer not null default 0,
      sender_jid text,
      updated_at text not null
    );

    create index if not exists idx_chats_subscribed on chats(subscribed);
    create index if not exists idx_events_ts on events(ts);
    create index if not exists idx_message_anchors_timestamp on message_anchors(timestamp);
  `);

  const shouldResetScheduleForTimezone = !hasSetting("digestTimezone");

  seedSetting("summarizationEnabled", "false");
  seedSetting("summaryLanguage", "Russian");
  seedSetting("whatsappDeliveryEnabled", "false");
  seedSetting("whatsappDeliveryChatJid", "");
  seedSetting("telegramEnabled", "false");
  seedSetting("digestCron", config.digestCron);
  seedSetting("digestTimes", JSON.stringify(cronToTimes(config.digestCron)));
  seedSetting("digestTimezone", config.digestTimezone);
  seedSetting("llmApiUrl", config.llmApiUrl);
  seedSetting("llmModel", config.llmModel);
  seedSetting("llmApiKey", config.llmApiKey);
  seedSetting("telegramBotToken", config.telegramBotToken || "");
  seedSetting("telegramChatIds", JSON.stringify(config.telegramChatIds));
  if (shouldResetScheduleForTimezone) {
    const defaultTimes = ["09:00", "18:00"];
    setSettingValue("digestTimes", JSON.stringify(defaultTimes));
    setSettingValue("digestCron", timesToCron(defaultTimes));
    setSettingValue("digestTimezone", config.digestTimezone);
  }
  saveDb();
}

export function getSettings(): AppSettings {
  return {
    summarizationEnabled: getSetting("summarizationEnabled") === "true",
    summaryLanguage: getSetting("summaryLanguage") || "Russian",
    whatsappDeliveryEnabled: getSetting("whatsappDeliveryEnabled") === "true",
    whatsappDeliveryChatJid: getSetting("whatsappDeliveryChatJid") || "",
    telegramEnabled: getSetting("telegramEnabled") === "true",
    digestCron: getSetting("digestCron") || config.digestCron,
    digestTimes: parseJsonArray(getSetting("digestTimes")),
    digestTimezone: getSetting("digestTimezone") || config.digestTimezone,
    llmApiUrl: getSetting("llmApiUrl") || config.llmApiUrl,
    llmModel: getSetting("llmModel") || config.llmModel,
    llmApiKey: getSetting("llmApiKey") || "",
    telegramBotToken: getSetting("telegramBotToken") || "",
    telegramChatIds: parseJsonArray(getSetting("telegramChatIds")),
  };
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const nextWhatsappDeliveryEnabled =
    typeof patch.whatsappDeliveryEnabled === "boolean"
      ? patch.whatsappDeliveryEnabled
      : getSetting("whatsappDeliveryEnabled") === "true";
  const nextWhatsappDeliveryChatJid =
    typeof patch.whatsappDeliveryChatJid === "string"
      ? patch.whatsappDeliveryChatJid
      : getSetting("whatsappDeliveryChatJid") || "";

  if (nextWhatsappDeliveryEnabled && !nextWhatsappDeliveryChatJid) {
    throw new Error("WhatsApp delivery target is required when WhatsApp delivery is enabled");
  }
  validateWhatsappDeliveryTarget(nextWhatsappDeliveryChatJid);

  if (typeof patch.summarizationEnabled === "boolean") {
    setSettingValue("summarizationEnabled", String(patch.summarizationEnabled));
  }
  if (typeof patch.summaryLanguage === "string") {
    setSettingValue("summaryLanguage", patch.summaryLanguage);
  }
  if (typeof patch.whatsappDeliveryEnabled === "boolean") {
    setSettingValue("whatsappDeliveryEnabled", String(patch.whatsappDeliveryEnabled));
  }
  if (typeof patch.whatsappDeliveryChatJid === "string") {
    setSettingValue("whatsappDeliveryChatJid", patch.whatsappDeliveryChatJid);
  }
  if (typeof patch.telegramEnabled === "boolean") {
    setSettingValue("telegramEnabled", String(patch.telegramEnabled));
  }
  if (typeof patch.digestCron === "string") setSettingValue("digestCron", patch.digestCron);
  if (Array.isArray(patch.digestTimes)) {
    setSettingValue("digestTimes", JSON.stringify(patch.digestTimes));
  }
  if (typeof patch.digestTimezone === "string") {
    validateDigestTimezone(patch.digestTimezone);
    setSettingValue("digestTimezone", patch.digestTimezone);
  }
  if (typeof patch.llmApiUrl === "string") setSettingValue("llmApiUrl", patch.llmApiUrl);
  if (typeof patch.llmModel === "string") setSettingValue("llmModel", patch.llmModel);
  if (typeof patch.llmApiKey === "string") setSettingValue("llmApiKey", patch.llmApiKey);
  if (typeof patch.telegramBotToken === "string") {
    setSettingValue("telegramBotToken", patch.telegramBotToken);
  }
  if (Array.isArray(patch.telegramChatIds)) {
    setSettingValue("telegramChatIds", JSON.stringify(patch.telegramChatIds));
  }

  saveDb();
  return getSettings();
}

export function validateWhatsappDeliveryTarget(jid: string): void {
  if (!jid) return;

  const row = firstRow("select subscribed from chats where jid = ?", [jid]);
  if (!row) {
    throw new Error("WhatsApp delivery target must be a known chat");
  }
  if (Number(row.subscribed || 0) === 1) {
    throw new Error("WhatsApp delivery target cannot be a subscribed source chat");
  }
}

export function upsertChat(input: {
  jid: string;
  name: string;
  type: StoredChat["type"];
  messageTimestamp?: number;
  preserveExistingActivity?: boolean;
}): void {
  const now = new Date().toISOString();
  const messageAt = input.messageTimestamp
    ? new Date(input.messageTimestamp * 1000).toISOString()
    : null;

  getDb().run(
    `
      insert into chats (jid, name, type, first_seen, last_seen, last_message_at, message_count)
      values (?, ?, ?, ?, ?, ?, ?)
      on conflict(jid) do update set
        name = excluded.name,
        type = excluded.type,
        last_seen = excluded.last_seen,
        last_message_at = coalesce(excluded.last_message_at, chats.last_message_at),
        message_count = case
          when ? = 1 then chats.message_count
          else chats.message_count + excluded.message_count
        end
    `,
    [
      input.jid,
      input.name,
      input.type,
      now,
      now,
      messageAt,
      messageAt ? 1 : 0,
      input.preserveExistingActivity ? 1 : 0,
    ]
  );
  saveDb();
}

export function listChats(): StoredChat[] {
  return allRows(
    `
      select jid, name, type, subscribed, first_seen, last_seen, last_message_at, message_count
      from chats
      order by subscribed desc, last_seen desc, name collate nocase asc
    `
  ).map((row) => ({
    jid: String(row.jid || ""),
    name: String(row.name || ""),
    type: row.type === "group" || row.type === "contact" ? row.type : "unknown",
    subscribed: Number(row.subscribed || 0) === 1,
    firstSeen: String(row.first_seen || ""),
    lastSeen: String(row.last_seen || ""),
    lastMessageAt: typeof row.last_message_at === "string" ? row.last_message_at : null,
    messageCount: Number(row.message_count || 0),
  }));
}

export function getChatName(jid: string): string | undefined {
  const row = firstRow("select name from chats where jid = ?", [jid]);
  return typeof row?.name === "string" ? row.name : undefined;
}

export function setChatSubscribed(jid: string, subscribed: boolean): StoredChat | undefined {
  if (subscribed && getSetting("whatsappDeliveryChatJid") === jid) {
    throw new Error("A WhatsApp delivery target cannot also be a subscribed source chat");
  }

  getDb().run("update chats set subscribed = ?, last_seen = ? where jid = ?", [
    subscribed ? 1 : 0,
    new Date().toISOString(),
    jid,
  ]);
  saveDb();

  return listChats().find((chat) => chat.jid === jid);
}

export function getSubscribedChatJids(): string[] {
  return allRows("select jid from chats where subscribed = 1 order by jid").map((row) =>
    String(row.jid || "")
  );
}

export function upsertMessageAnchor(input: {
  chatJid: string;
  messageId: string;
  timestamp: number;
  fromMe: boolean;
  senderJid?: string;
}): void {
  if (!input.chatJid || !input.messageId || !Number.isFinite(input.timestamp)) return;

  getDb().run(
    `
      insert into message_anchors (
        chat_jid,
        message_id,
        timestamp,
        from_me,
        sender_jid,
        updated_at
      )
      values (?, ?, ?, ?, ?, ?)
      on conflict(chat_jid) do update set
        message_id = case
          when excluded.timestamp >= message_anchors.timestamp then excluded.message_id
          else message_anchors.message_id
        end,
        timestamp = max(message_anchors.timestamp, excluded.timestamp),
        from_me = case
          when excluded.timestamp >= message_anchors.timestamp then excluded.from_me
          else message_anchors.from_me
        end,
        sender_jid = case
          when excluded.timestamp >= message_anchors.timestamp then excluded.sender_jid
          else message_anchors.sender_jid
        end,
        updated_at = excluded.updated_at
    `,
    [
      input.chatJid,
      input.messageId,
      Math.floor(input.timestamp),
      input.fromMe ? 1 : 0,
      input.senderJid || null,
      new Date().toISOString(),
    ],
  );
  saveDb();
}

export function getMessageAnchor(chatJid: string): MessageAnchor | undefined {
  const row = firstRow(
    `
      select chat_jid, message_id, timestamp, from_me, sender_jid, updated_at
      from message_anchors
      where chat_jid = ?
    `,
    [chatJid],
  );

  if (!row) return undefined;
  return {
    chatJid: String(row.chat_jid || ""),
    messageId: String(row.message_id || ""),
    timestamp: Number(row.timestamp || 0),
    fromMe: Number(row.from_me || 0) === 1,
    senderJid: typeof row.sender_jid === "string" ? row.sender_jid : undefined,
    updatedAt: String(row.updated_at || ""),
  };
}

export function purgeOldMessageAnchors(retentionHours = config.messageRetentionHours): number {
  const cutoff = Math.floor(Date.now() / 1000 - Math.max(1, retentionHours) * 60 * 60);
  getDb().run("delete from message_anchors where timestamp < ?", [cutoff]);
  saveDb();
  const row = firstRow("select changes() as deleted");
  return Number(row?.deleted || 0);
}

export function recordEvent(
  level: "debug" | "info" | "warn" | "error",
  type: string,
  message: string,
  data?: unknown
): void {
  getDb().run("insert into events (ts, level, type, message, data) values (?, ?, ?, ?, ?)", [
    new Date().toISOString(),
    level,
    type,
    message,
    data === undefined ? null : JSON.stringify(data),
  ]);

  const maxRows = 500;
  getDb().run(
    "delete from events where id not in (select id from events order by id desc limit ?)",
    [maxRows]
  );
  saveDb();
}

export function listEvents(limit = 50): StoredEvent[] {
  return allRows(
    "select id, ts, level, type, message, data from events order by id desc limit ?",
    [Math.max(1, Math.min(limit, 200))]
  ).map((row) => {
    let data: unknown = null;
    if (typeof row.data === "string" && row.data) {
      try {
        data = JSON.parse(row.data);
      } catch {
        data = row.data;
      }
    }

    return {
      id: Number(row.id || 0),
      ts: String(row.ts || ""),
      level: String(row.level || ""),
      type: String(row.type || ""),
      message: String(row.message || ""),
      data,
    };
  });
}
