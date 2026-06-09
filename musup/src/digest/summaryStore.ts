import fs from "fs";
import path from "path";
import { config } from "../config.js";

export type StoredSummary = {
  id: number;
  createdAt: string;
  status: string;
  from: string;
  to: string;
  messageCount: number;
  summary: string;
  reason: string | null;
  error: string | null;
  deliveredToTelegram: boolean;
  deliveredToWhatsapp: boolean;
};

export type SummaryInput = {
  status: string;
  from: string;
  to: string;
  messageCount: number;
  summary?: string;
  reason?: string | null;
  error?: string | null;
  deliveredToTelegram?: boolean;
  deliveredToWhatsapp?: boolean;
};

const summariesDir = path.join(config.dataDir, "summaries");

function utcDateString(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function summaryFilePath(createdAt: string): string {
  return path.join(summariesDir, `${utcDateString(createdAt)}.ndjson`);
}

function parseSummaryLine(line: string): StoredSummary | null {
  try {
    const node = JSON.parse(line) as Record<string, unknown>;
    const createdAt = typeof node.createdAt === "string" ? node.createdAt : "";
    if (!createdAt) return null;

    return {
      id: typeof node.id === "number" ? node.id : Date.parse(createdAt),
      createdAt,
      status: typeof node.status === "string" ? node.status : "unknown",
      from: typeof node.from === "string" ? node.from : "",
      to: typeof node.to === "string" ? node.to : "",
      messageCount: typeof node.messageCount === "number" ? node.messageCount : 0,
      summary: typeof node.summary === "string" ? node.summary : "",
      reason: typeof node.reason === "string" ? node.reason : null,
      error: typeof node.error === "string" ? node.error : null,
      deliveredToTelegram: Boolean(node.deliveredToTelegram),
      deliveredToWhatsapp: Boolean(node.deliveredToWhatsapp),
    };
  } catch {
    return null;
  }
}

function listSummaryFiles(): string[] {
  if (!fs.existsSync(summariesDir)) return [];
  return fs
    .readdirSync(summariesDir)
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(file))
    .map((file) => path.join(summariesDir, file))
    .sort();
}

export function recordSummary(input: SummaryInput): StoredSummary {
  const createdAt = new Date().toISOString();
  const record: StoredSummary = {
    id: Date.now(),
    createdAt,
    status: input.status,
    from: input.from,
    to: input.to,
    messageCount: input.messageCount,
    summary: input.summary || "",
    reason: input.reason || null,
    error: input.error || null,
    deliveredToTelegram: Boolean(input.deliveredToTelegram),
    deliveredToWhatsapp: Boolean(input.deliveredToWhatsapp),
  };

  fs.mkdirSync(summariesDir, { recursive: true });
  fs.appendFileSync(summaryFilePath(createdAt), `${JSON.stringify(record)}\n`, "utf-8");
  return record;
}

export function listSummaries(limit = 50): StoredSummary[] {
  const summaries = listSummaryFiles().flatMap((filePath) =>
    fs
      .readFileSync(filePath, "utf-8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseSummaryLine)
      .filter((item): item is StoredSummary => Boolean(item)),
  );

  return summaries
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, Math.max(1, Math.min(limit, 200)));
}

export function purgeOldSummaries(retentionHours = config.summaryRetentionHours): {
  deletedFiles: number;
  rewrittenFiles: number;
  cutoff: string;
} {
  const safeRetentionHours = Math.max(1, Number.isFinite(retentionHours) ? retentionHours : 36);
  const cutoffMs = Date.now() - safeRetentionHours * 60 * 60 * 1000;
  let deletedFiles = 0;
  let rewrittenFiles = 0;

  for (const filePath of listSummaryFiles()) {
    const records = fs
      .readFileSync(filePath, "utf-8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseSummaryLine)
      .filter((item): item is StoredSummary => Boolean(item));
    const retained = records.filter((item) => Date.parse(item.createdAt) >= cutoffMs);

    if (retained.length === 0) {
      fs.unlinkSync(filePath);
      deletedFiles += 1;
    } else if (retained.length !== records.length) {
      fs.writeFileSync(filePath, retained.map((item) => JSON.stringify(item)).join("\n") + "\n");
      rewrittenFiles += 1;
    }
  }

  return { deletedFiles, rewrittenFiles, cutoff: new Date(cutoffMs).toISOString() };
}
