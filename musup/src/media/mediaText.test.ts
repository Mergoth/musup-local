import { test } from "node:test";
import assert from "node:assert/strict";
import { mediaMessageText } from "./mediaText.js";

test("done voice note becomes a labelled transcript", () => {
  assert.equal(
    mediaMessageText({ kind: "voice", status: "done", resultText: "Hola, mañana no hay clase", error: null }),
    "[voice note] Hola, mañana no hay clase",
  );
});

test("done picture keeps its caption", () => {
  assert.equal(
    mediaMessageText(
      { kind: "picture", status: "done", resultText: "Flyer: Fotos de Navidad", error: null },
      "mirad esto",
    ),
    "[picture] Flyer: Fotos de Navidad\nCaption: mirad esto",
  );
});

test("failed picture still carries its caption", () => {
  assert.equal(
    mediaMessageText({ kind: "picture", status: "failed", resultText: null, error: "boom" }, "pagar antes del jueves"),
    "[picture, not described]\nCaption: pagar antes del jueves",
  );
});

test("placeholders for every non-done status", () => {
  const cases: Array<[Parameters<typeof mediaMessageText>[0], string]> = [
    [{ kind: "picture", status: "skipped_view_once", resultText: null, error: null }, "[view-once picture]"],
    [{ kind: "voice", status: "skipped_view_once", resultText: null, error: null }, "[view-once voice note]"],
    [{ kind: "picture", status: "skipped_too_large", resultText: null, error: null }, "[picture too large, skipped]"],
    [{ kind: "voice", status: "skipped_too_large", resultText: null, error: null }, "[voice note too long, skipped]"],
    [{ kind: "picture", status: "unavailable", resultText: null, error: null }, "[picture, unavailable]"],
    [{ kind: "voice", status: "unavailable", resultText: null, error: null }, "[voice note, unavailable]"],
    [{ kind: "voice", status: "not_configured", resultText: null, error: null }, "[voice note, not transcribed]"],
    [{ kind: "voice", status: "pending", resultText: null, error: null }, "[voice note, not transcribed]"],
    [{ kind: "picture", status: "done", resultText: "  ", error: null }, "[picture, not described]"],
  ];
  for (const [item, expected] of cases) assert.equal(mediaMessageText(item), expected);
});

test("applyMediaText fills media messages and marks sendable pictures", async () => {
  const fs = await import("fs");
  const os = await import("os");
  const path = await import("path");
  const { applyMediaText } = await import("./mediaText.js");
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "musup-media-")), "p.jpg");
  fs.writeFileSync(file, "img");
  const base = { chatJid: "a@g.us", chatLabel: "2B", fromMe: false, timestamp: 1, messageDateUtc: "" };
  const item = (messageId: string, kind: "picture" | "voice", status: "done" | "failed", filePath: string | null) => ({
    messageId, chatJid: "a@g.us", kind, status, mimeType: "", filePath,
    resultText: status === "done" ? "Flyer" : null, error: null, attempts: 1, createdAt: "", updatedAt: "",
  });
  const out = applyMediaText(
    [
      { ...base, messageId: "ok", messageType: "imageMessage", text: "" },
      { ...base, messageId: "bad", messageType: "imageMessage", text: "ver" },
      { ...base, messageId: "none", messageType: "audioMessage", text: "" },
      { ...base, messageId: "txt", messageType: "conversation", text: "hola" },
    ],
    new Map([
      ["ok", item("ok", "picture", "done", file)],
      ["bad", item("bad", "picture", "failed", null)],
    ]),
  );
  assert.equal(out[0]?.text, "[picture] Flyer");
  assert.equal(out[0]?.sendablePicture, true);
  assert.equal(out[0]?.pictureFilePath, file);
  assert.equal(out[1]?.text, "[picture, not described]\nCaption: ver");
  assert.equal(out[1]?.sendablePicture, false);
  assert.equal(out[2]?.text, "[voice note, not transcribed]");
  assert.equal(out[3]?.text, "hola");
});
