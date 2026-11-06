import { spawn } from "child_process";

// WhatsApp voice notes are Ogg/Opus; model APIs reliably accept MP3.
export function transcodeToMp3(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-i", "pipe:0",
      "-ac", "1", "-ar", "16000", "-b:a", "32k",
      "-f", "mp3", "pipe:1",
    ]);
    const out: Buffer[] = [];
    const err: Buffer[] = [];

    proc.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    proc.on("error", (error) => reject(new Error(`ffmpeg could not start: ${error.message}`)));
    proc.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`ffmpeg exited with ${code}: ${Buffer.concat(err).toString().trim()}`));
    });
    proc.stdin.on("error", () => {
      // ffmpeg may close stdin early on bad input; the close handler reports it.
    });
    proc.stdin.end(input);
  });
}
