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
