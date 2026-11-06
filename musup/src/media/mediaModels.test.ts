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

test("transcription test fails on an ungrounded reply", async () => {
  const { checkTestReply } = await import("./mediaModels.js");
  assert.throws(() => checkTestReply("transcription", "yes"), /did not transcribe the test clip/);
  assert.throws(() => checkTestReply("transcription", ""), /did not transcribe the test clip/);
});

test("transcription test passes when the spoken words come back", async () => {
  const { checkTestReply } = await import("./mediaModels.js");
  assert.doesNotThrow(() => checkTestReply("transcription", "The school trip costs five euros."));
  assert.doesNotThrow(() => checkTestReply("transcription", "the school trip costs 5 euros"));
});

test("vision test fails unless the picture's text is read", async () => {
  const { checkTestReply } = await import("./mediaModels.js");
  assert.throws(() => checkTestReply("vision", "A white square."), /did not read the test picture/);
  assert.doesNotThrow(() => checkTestReply("vision", "A label.\nMUSUP TEST\nPrice: 42 EUR"));
});

test("test media carries real content", async () => {
  const { TEST_MP3, TEST_PNG } = await import("./testMedia.js");
  const { ffmpegBinary } = await import("./ffmpeg.js");
  const { spawnSync } = await import("child_process");
  const probe = spawnSync(ffmpegBinary(), ["-hide_banner", "-i", "pipe:0", "-af", "volumedetect", "-f", "null", "-"], {
    input: TEST_MP3,
  });
  const maxVolume = Number(/max_volume: (-?[\d.]+) dB/.exec(probe.stderr.toString())?.[1]);
  assert.ok(maxVolume > -30, `test clip is silent (max ${maxVolume} dB)`);
  assert.equal(TEST_PNG.readUInt32BE(16), 320, "test picture should be 320 px wide");
});

test("audio instruction tells the model to return nothing when there is no speech", () => {
  const instruction = buildAudioMessages(Buffer.from("x"))[0];
  assert.ok(instruction?.type === "text" && /no intelligible speech/i.test(instruction.text));
  assert.ok(instruction?.type === "text" && /never answer/i.test(instruction.text));
});
