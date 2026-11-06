import { appLogger } from "../appLogger.js";
import {
  chatCompletion,
  type ContentPart,
  type LlmConnectionConfig,
  type ModelTarget,
} from "../digest/llmClient.js";
import { TEST_MP3, TEST_PNG } from "./testMedia.js";

const VISION_INSTRUCTION =
  "Describe this image for someone who cannot see it. Answer in the language of the text in the image (or English if there is none). First line: what the image is. Then transcribe all readable text verbatim. Then list key facts: dates, times, prices, places, phone numbers, deadlines, people. No commentary.";

const AUDIO_INSTRUCTION =
  "Transcribe this voice message verbatim in its original language. Output only the transcript.";

export type ModelCallOptions = { timeoutMs?: number };

export function buildVisionMessages(image: Buffer, mimeType: string): ContentPart[] {
  return [
    { type: "text", text: VISION_INSTRUCTION },
    { type: "image_url", image_url: { url: `data:${mimeType};base64,${image.toString("base64")}` } },
  ];
}

export function buildAudioMessages(mp3: Buffer): ContentPart[] {
  return [
    { type: "text", text: AUDIO_INSTRUCTION },
    { type: "input_audio", input_audio: { data: mp3.toString("base64"), format: "mp3" } },
  ];
}

export function isWhisperUrl(url: string): boolean {
  if (!url) return false;
  const pathOnly = url.split(/[?#]/)[0]?.replace(/\/+$/, "") || "";
  return pathOnly.endsWith("/audio/transcriptions");
}

export async function describeImage(
  image: Buffer,
  mimeType: string,
  cfg: LlmConnectionConfig,
  opts: ModelCallOptions = {},
): Promise<string> {
  return chatCompletion(buildVisionMessages(image, mimeType), cfg, opts);
}

async function whisperTranscription(
  mp3: Buffer,
  cfg: LlmConnectionConfig,
  opts: ModelCallOptions,
): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(mp3)], { type: "audio/mpeg" }), "voice.mp3");
  form.append("model", cfg.llmModel);

  appLogger.info("Sending audio to transcription API", { model: cfg.llmModel, bytes: mp3.length });
  const response = await fetch(cfg.llmApiUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.llmApiKey}` },
    body: form,
    signal: opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined,
  });
  const body = await response.text();

  if (!response.ok) {
    appLogger.error("Transcription API error", { status: response.status, body });
    throw new Error(`Transcription API failed: status=${response.status}, body=${body}`);
  }

  try {
    const json = JSON.parse(body) as { text?: unknown };
    return typeof json.text === "string" ? json.text.trim() : "";
  } catch {
    return body.trim();
  }
}

export async function transcribeAudio(
  mp3: Buffer,
  cfg: LlmConnectionConfig,
  opts: ModelCallOptions = {},
): Promise<string> {
  if (!cfg.llmApiUrl || !cfg.llmModel || !cfg.llmApiKey) {
    throw new Error("Transcription model is not configured");
  }
  if (isWhisperUrl(cfg.llmApiUrl)) return whisperTranscription(mp3, cfg, opts);
  return chatCompletion(buildAudioMessages(mp3), cfg, { ...opts, allowEmpty: true });
}

export async function testModel(
  target: ModelTarget,
  cfg: LlmConnectionConfig,
): Promise<{ ok: true; latencyMs: number; model: string; text: string }> {
  const startedAt = Date.now();
  let text: string;

  if (target === "vision") {
    text = await describeImage(TEST_PNG, "image/png", cfg);
  } else if (target === "transcription") {
    text = (await transcribeAudio(TEST_MP3, cfg)) || "(empty transcript, audio accepted)";
  } else {
    text = await chatCompletion("Reply with exactly this text: musup-local-ok", cfg);
  }

  return { ok: true, latencyMs: Date.now() - startedAt, model: cfg.llmModel, text };
}
