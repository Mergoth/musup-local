export type WhatsappDeliveryResult = {
  jid: string;
  messageId?: string;
};

export type WhatsappDeliveryHandler = (
  jid: string,
  text: string,
) => Promise<WhatsappDeliveryResult>;

let handler: WhatsappDeliveryHandler | undefined;

export function configureWhatsappDeliveryHandler(nextHandler: WhatsappDeliveryHandler): void {
  handler = nextHandler;
}

export async function sendWhatsappText(
  jid: string,
  text: string,
): Promise<WhatsappDeliveryResult> {
  if (!handler) {
    throw new Error("WhatsApp delivery is not ready yet");
  }
  if (!jid) {
    throw new Error("WhatsApp delivery target is not configured");
  }
  if (!text.trim()) {
    throw new Error("WhatsApp delivery text is empty");
  }

  return handler(jid, text);
}

export function telegramHtmlToWhatsappText(text: string): string {
  return text
    .replace(/<\/?(b|i|u|code)>/gi, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

export async function testWhatsappDelivery(jid: string): Promise<{
  ok: true;
  jid: string;
  messageId?: string;
}> {
  const result = await sendWhatsappText(jid, "musup-local WhatsApp delivery test: OK");
  return {
    ok: true,
    ...result,
  };
}
