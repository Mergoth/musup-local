import fs from "fs";
import type { WhatsappMessage } from "../digest/types.js";
import type { MediaItem } from "./mediaTypes.js";

type MediaTextInput = Pick<MediaItem, "kind" | "status" | "resultText" | "error">;

function baseText(item: MediaTextInput): string {
  const picture = item.kind === "picture";
  const result = item.resultText?.trim();

  switch (item.status) {
    case "done":
      if (result) return picture ? `[picture] ${result}` : `[voice note] ${result}`;
      break;
    case "skipped_view_once":
      return picture ? "[view-once picture]" : "[view-once voice note]";
    case "skipped_too_large":
      return picture ? "[picture too large, skipped]" : "[voice note too long, skipped]";
    case "unavailable":
      return picture ? "[picture, unavailable]" : "[voice note, unavailable]";
  }

  return picture ? "[picture, not described]" : "[voice note, not transcribed]";
}

// Text the digest sees for a media message: the model result or a placeholder, plus any caption.
export function mediaMessageText(item: MediaTextInput, caption?: string): string {
  const text = baseText(item);
  const trimmedCaption = caption?.trim();
  return trimmedCaption ? `${text}\nCaption: ${trimmedCaption}` : text;
}

// Replaces media messages' text with their description/transcript (or a placeholder).
export function applyMediaText(
  messages: WhatsappMessage[],
  items: Map<string, MediaItem>,
): WhatsappMessage[] {
  return messages.map((message) => {
    const item = items.get(message.messageId);
    if (!item) {
      if (message.messageType === "imageMessage" && !message.text) {
        return { ...message, text: "[picture, not described]" };
      }
      if (message.messageType === "audioMessage" && !message.text) {
        return { ...message, text: "[voice note, not transcribed]" };
      }
      return message;
    }

    const sendablePicture = Boolean(
      item.kind === "picture" && item.status === "done" && item.filePath && fs.existsSync(item.filePath),
    );
    return {
      ...message,
      text: mediaMessageText(item, message.text || undefined),
      sendablePicture,
      pictureFilePath: sendablePicture ? item.filePath ?? undefined : undefined,
    };
  });
}
