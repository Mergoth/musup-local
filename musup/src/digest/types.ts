export type WhatsappMessage = {
  messageId: string;
  chatJid: string;
  chatLabel: string;
  senderJid?: string;
  fromMe: boolean;
  timestamp: number;
  messageDateUtc: string;
  messageType: string;
  text: string;
};

export type DigestResult = {
  status: "ok" | "no_messages" | "disabled" | "error";
  messageCount: number;
  from: string;
  to: string;
  summary?: string;
  reason?: string;
  error?: string;
  deliveredToTelegram?: boolean;
  deliveredToWhatsapp?: boolean;
};
