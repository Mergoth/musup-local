export type WhatsappConnectionState =
  | "starting"
  | "qr"
  | "open"
  | "close"
  | "logged_out"
  | "error";

type RuntimeState = {
  startedAt: string;
  whatsapp: {
    connection: WhatsappConnectionState;
    lastChangeAt: string;
    latestQr: string | null;
    lastDisconnectStatusCode: number | null;
  };
  counters: {
    detectedChats: number;
    savedMessages: number;
    skippedMessages: number;
  };
  activity: {
    lastDetectedChatAt: string | null;
    lastSavedMessageAt: string | null;
    lastSkippedMessageAt: string | null;
  };
  digest: {
    running: boolean;
    nextScheduledAt: string | null;
    lastStartedAt: string | null;
    lastFinishedAt: string | null;
    lastDurationMs: number | null;
    lastStatus: string | null;
    lastMessageCount: number;
    lastReason: string | null;
    lastError: string | null;
  };
};

const runtimeState: RuntimeState = {
  startedAt: new Date().toISOString(),
  whatsapp: {
    connection: "starting",
    lastChangeAt: new Date().toISOString(),
    latestQr: null,
    lastDisconnectStatusCode: null,
  },
  counters: {
    detectedChats: 0,
    savedMessages: 0,
    skippedMessages: 0,
  },
  activity: {
    lastDetectedChatAt: null,
    lastSavedMessageAt: null,
    lastSkippedMessageAt: null,
  },
  digest: {
    running: false,
    nextScheduledAt: null,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastDurationMs: null,
    lastStatus: null,
    lastMessageCount: 0,
    lastReason: null,
    lastError: null,
  },
};

export function setDigestNextScheduledAt(value: string | null): void {
  runtimeState.digest.nextScheduledAt = value;
}

export function setWhatsappState(
  connection: WhatsappConnectionState,
  options: { qr?: string | null; statusCode?: number | null } = {}
): void {
  runtimeState.whatsapp.connection = connection;
  runtimeState.whatsapp.lastChangeAt = new Date().toISOString();

  if ("qr" in options) runtimeState.whatsapp.latestQr = options.qr ?? null;
  if ("statusCode" in options) {
    runtimeState.whatsapp.lastDisconnectStatusCode = options.statusCode ?? null;
  }
}

export function incrementCounter(name: keyof RuntimeState["counters"]): void {
  runtimeState.counters[name] += 1;
  const now = new Date().toISOString();
  if (name === "detectedChats") runtimeState.activity.lastDetectedChatAt = now;
  if (name === "savedMessages") runtimeState.activity.lastSavedMessageAt = now;
  if (name === "skippedMessages") runtimeState.activity.lastSkippedMessageAt = now;
}

export function markDigestStarted(): void {
  runtimeState.digest.running = true;
  runtimeState.digest.lastStartedAt = new Date().toISOString();
  runtimeState.digest.lastFinishedAt = null;
  runtimeState.digest.lastDurationMs = null;
  runtimeState.digest.lastStatus = "running";
  runtimeState.digest.lastReason = null;
  runtimeState.digest.lastError = null;
}

export function markDigestFinished(result: {
  status: string;
  messageCount: number;
  reason?: string;
}): void {
  const finishedAt = new Date();
  const startedAt = runtimeState.digest.lastStartedAt
    ? new Date(runtimeState.digest.lastStartedAt)
    : finishedAt;

  runtimeState.digest.running = false;
  runtimeState.digest.lastFinishedAt = finishedAt.toISOString();
  runtimeState.digest.lastDurationMs = finishedAt.getTime() - startedAt.getTime();
  runtimeState.digest.lastStatus = result.status;
  runtimeState.digest.lastMessageCount = result.messageCount;
  runtimeState.digest.lastReason = result.reason || null;
  runtimeState.digest.lastError = null;
}

export function markDigestFailed(error: Error): void {
  const finishedAt = new Date();
  const startedAt = runtimeState.digest.lastStartedAt
    ? new Date(runtimeState.digest.lastStartedAt)
    : finishedAt;

  runtimeState.digest.running = false;
  runtimeState.digest.lastFinishedAt = finishedAt.toISOString();
  runtimeState.digest.lastDurationMs = finishedAt.getTime() - startedAt.getTime();
  runtimeState.digest.lastStatus = "error";
  runtimeState.digest.lastReason = null;
  runtimeState.digest.lastError = error.message;
}

export function getRuntimeState(): RuntimeState {
  return {
    ...runtimeState,
    whatsapp: { ...runtimeState.whatsapp },
    counters: { ...runtimeState.counters },
    activity: { ...runtimeState.activity },
    digest: { ...runtimeState.digest },
  };
}

export function getLatestQr(): string | null {
  return runtimeState.whatsapp.latestQr;
}
