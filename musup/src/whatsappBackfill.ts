export type BackfillResult = {
  status: "requested" | "received" | "failed";
  jid: string;
  count: number;
  requestId: string;
  anchorMessageId: string;
  anchorTimestamp: number;
  requestedAt: string;
  receivedAt?: string;
  receivedMessages?: number;
  savedMessages?: number;
  error?: string;
};

export type BackfillHandler = (jid: string, count: number) => Promise<BackfillResult>;

let handler: BackfillHandler | undefined;
const requests = new Map<string, BackfillResult>();

export function configureBackfillHandler(nextHandler: BackfillHandler): void {
  handler = nextHandler;
}

export async function requestChatBackfill(jid: string, count = 50): Promise<BackfillResult> {
  if (!handler) {
    throw new Error("WhatsApp backfill is not ready yet");
  }

  const result = await handler(jid, Math.max(1, Math.min(Math.floor(count), 50)));
  rememberBackfillRequest(result);
  return result;
}

export function rememberBackfillRequest(result: BackfillResult): void {
  requests.set(result.requestId, result);
  pruneBackfillRequests();
}

export function recordBackfillHistory(
  requestId: string | null | undefined,
  receivedMessages: number,
  savedMessages: number,
): BackfillResult | undefined {
  if (!requestId) return undefined;
  const existing = requests.get(requestId);
  if (!existing) return undefined;

  const next: BackfillResult = {
    ...existing,
    status: "received",
    receivedAt: new Date().toISOString(),
    receivedMessages,
    savedMessages,
  };
  requests.set(requestId, next);
  return next;
}

export function failBackfillRequest(
  requestId: string,
  error: string,
): BackfillResult | undefined {
  const existing = requests.get(requestId);
  if (!existing) return undefined;
  const next: BackfillResult = {
    ...existing,
    status: "failed",
    receivedAt: new Date().toISOString(),
    error,
  };
  requests.set(requestId, next);
  return next;
}

export function listBackfillRequests(): BackfillResult[] {
  return [...requests.values()].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

function pruneBackfillRequests(): void {
  const sorted = listBackfillRequests();
  for (const stale of sorted.slice(50)) {
    requests.delete(stale.requestId);
  }
}
