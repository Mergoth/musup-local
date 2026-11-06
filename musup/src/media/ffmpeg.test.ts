import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "child_process";
import { ffmpegBinary, transcodeToMp3 } from "./ffmpeg.js";

test("uses the bundled ffmpeg binary", () => {
  assert.notEqual(ffmpegBinary(), "ffmpeg");
});

test("converts an Ogg/Opus voice note to MP3", async () => {
  // One second of tone encoded the way WhatsApp sends voice notes.
  const ogg = execFileSync(ffmpegBinary(), [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
    "-c:a", "libopus", "-f", "ogg", "pipe:1",
  ]);
  const mp3 = await transcodeToMp3(ogg);
  assert.ok(mp3.length > 1000);
  // MP3 frame sync or an ID3 tag at the start.
  assert.ok(mp3.subarray(0, 3).toString() === "ID3" || (mp3[0] === 0xff && (mp3[1]! & 0xe0) === 0xe0));
});

test("rejects input that isn't audio", async () => {
  await assert.rejects(transcodeToMp3(Buffer.from("not audio")), /ffmpeg exited/);
});
