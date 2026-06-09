export type BackfillResult = {
  status: "requested";
  jid: string;
  count: number;
  requestId: string;
  anchorMessageId: string;
  anchorTimestamp: number;
};

export type BackfillHandler = (jid: string, count: number) => Promise<BackfillResult>;

let handler: BackfillHandler | undefined;

export function configureBackfillHandler(nextHandler: BackfillHandler): void {
  handler = nextHandler;
}

// Dormant experimental support: the admin UI no longer exposes backfill because
// Baileys history replay is not reliable for newly subscribed chats right now.
export async function requestChatBackfill(jid: string, count = 50): Promise<BackfillResult> {
  if (!handler) {
    throw new Error("WhatsApp backfill is not ready yet");
  }

  return handler(jid, Math.max(1, Math.min(Math.floor(count), 200)));
}
