import { appLogger } from "../appLogger.js";
import { getSettings, type AppSettings } from "../db/database.js";

export type LlmConnectionConfig = {
  llmApiUrl: string;
  llmModel: string;
  llmApiKey: string;
};

export type ModelTarget = "digest" | "vision" | "transcription";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "input_audio"; input_audio: { data: string; format: string } };

export type ChatCompletionOptions = {
  timeoutMs?: number;
  // Transcribing silence legitimately yields no text.
  allowEmpty?: boolean;
};

export function getModelConfig(settings: AppSettings, target: ModelTarget): LlmConnectionConfig {
  if (target === "vision") {
    return {
      llmApiUrl: settings.visionApiUrl,
      llmModel: settings.visionModel,
      llmApiKey: settings.visionApiKey,
    };
  }
  if (target === "transcription") {
    return {
      llmApiUrl: settings.transcriptionApiUrl,
      llmModel: settings.transcriptionModel,
      llmApiKey: settings.transcriptionApiKey,
    };
  }
  return { llmApiUrl: settings.llmApiUrl, llmModel: settings.llmModel, llmApiKey: settings.llmApiKey };
}

export function isModelConfigured(cfg: LlmConnectionConfig): boolean {
  return Boolean(cfg.llmApiUrl && cfg.llmModel && cfg.llmApiKey);
}

export async function chatCompletion(
  content: string | ContentPart[],
  settings: LlmConnectionConfig,
  options: ChatCompletionOptions = {},
): Promise<string> {
  if (!settings.llmApiKey) {
    throw new Error("LLM API key is not configured");
  }
  if (!settings.llmApiUrl) {
    throw new Error("LLM API URL is not configured");
  }
  if (!settings.llmModel) {
    throw new Error("LLM model is not configured");
  }

  appLogger.info("Sending prompt to LLM", {
    model: settings.llmModel,
    length: typeof content === "string" ? content.length : undefined,
    parts: typeof content === "string" ? undefined : content.map((part) => part.type),
  });

  const response = await fetch(settings.llmApiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.llmApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: settings.llmModel,
      messages: [{ role: "user", content }],
      max_tokens: 4096,
      temperature: 0.2,
    }),
    signal: options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
  });

  const body = await response.text();

  if (!response.ok) {
    appLogger.error("LLM API error", { status: response.status, body });
    throw new Error(`LLM API failed: status=${response.status}, body=${body}`);
  }

  const json = JSON.parse(body) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = json.choices?.[0]?.message?.content?.trim() || "";

  if (!text && !options.allowEmpty) {
    appLogger.error("LLM response missing content", body);
    throw new Error(`LLM response does not contain text: ${body}`);
  }

  appLogger.info("LLM response received", { length: text.length });
  return text;
}

export async function summarize(prompt: string): Promise<string> {
  const settings = getSettings();
  return chatCompletion(prompt, settings);
}
