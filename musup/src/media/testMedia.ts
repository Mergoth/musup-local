// Tiny media used by the Settings "Test" buttons to prove an endpoint accepts that media type.

// 1×1 PNG.
export const TEST_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

// ~1 s of silence: 28 MPEG-2 Layer III frames, 16 kHz mono 32 kbps (144 bytes each).
// All-zero side info means "no audio data", which decoders play as silence.
function silentMp3(frames: number): Buffer {
  const frame = Buffer.alloc(144);
  frame.set([0xff, 0xf3, 0x48, 0xc0]);
  return Buffer.concat(Array.from({ length: frames }, () => frame));
}

export const TEST_MP3 = silentMp3(28);
