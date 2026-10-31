import { appLogger } from "../appLogger.js";
import { getSettings } from "../db/database.js";

export type LlmConnectionConfig = {
  llmApiUrl: string;
  llmModel: string;
  llmApiKey: string;
};

async function chatCompletion(prompt: string, settings: LlmConnectionConfig): Promise<string> {
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
    length: prompt.length,
  });

  const response = await fetch(settings.llmApiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.llmApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: settings.llmModel,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 4096,
      temperature: 0.2,
    }),
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

  if (!text) {
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

export async function testLlmConnection(settings: LlmConnectionConfig): Promise<{
  ok: true;
  latencyMs: number;
  model: string;
  text: string;
}> {
  const startedAt = Date.now();
  const text = await chatCompletion(
    'Reply with exactly this text: musup-local-ok',
    settings
  );

  return {
    ok: true,
    latencyMs: Date.now() - startedAt,
    model: settings.llmModel,
    text,
  };
}
