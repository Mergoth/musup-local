import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAudioMessages, buildVisionMessages, isWhisperUrl } from "./mediaModels.js";
import { getModelConfig } from "../digest/llmClient.js";
import type { AppSettings } from "../db/database.js";

test("vision request uses the picture's real mimetype", () => {
  const parts = buildVisionMessages(Buffer.from("x"), "image/webp");
  const imagePart = parts[1];
  assert.equal(imagePart?.type, "image_url");
  assert.ok(imagePart?.type === "image_url" && imagePart.image_url.url.startsWith("data:image/webp;base64,"));
});

test("audio request sends base64 mp3 as input_audio", () => {
  assert.deepEqual(buildAudioMessages(Buffer.from("x"))[1], {
    type: "input_audio",
    input_audio: { data: "eA==", format: "mp3" },
  });
});

test("whisper endpoint detection", () => {
  assert.equal(isWhisperUrl("https://api.openai.com/v1/audio/transcriptions"), true);
  assert.equal(isWhisperUrl("https://api.openai.com/v1/audio/transcriptions/"), true);
  assert.equal(isWhisperUrl("https://x.example/v1/audio/transcriptions?api-version=1"), true);
  assert.equal(isWhisperUrl("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"), false);
  assert.equal(isWhisperUrl(""), false);
});

test("getModelConfig maps each target to its settings", () => {
  const settings = {
    llmApiUrl: "d-url", llmModel: "d-model", llmApiKey: "d-key",
    visionApiUrl: "v-url", visionModel: "v-model", visionApiKey: "v-key",
    transcriptionApiUrl: "t-url", transcriptionModel: "t-model", transcriptionApiKey: "t-key",
  } as AppSettings;
  assert.deepEqual(getModelConfig(settings, "digest"), { llmApiUrl: "d-url", llmModel: "d-model", llmApiKey: "d-key" });
  assert.deepEqual(getModelConfig(settings, "vision"), { llmApiUrl: "v-url", llmModel: "v-model", llmApiKey: "v-key" });
  assert.deepEqual(getModelConfig(settings, "transcription"), { llmApiUrl: "t-url", llmModel: "t-model", llmApiKey: "t-key" });
});
