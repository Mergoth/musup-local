import { test } from "node:test";
import assert from "node:assert/strict";
import { telegramPhotoCaption } from "./telegramClient.js";
import { renderChatBlock } from "./structuredSummary.js";

test("long captions are cut to Telegram's 1024-character limit", () => {
  const caption = telegramPhotoCaption("a".repeat(2000));
  assert.ok(caption.length <= 1024);
  assert.ok(caption.endsWith("…"));
});

test("captions are HTML-escaped", () => {
  assert.equal(telegramPhotoCaption("Precio <16€> & más"), "Precio &lt;16€&gt; &amp; más");
});

test("truncation never leaves half an HTML entity", () => {
  const caption = telegramPhotoCaption("&".repeat(400));
  assert.ok(caption.length <= 1024);
  assert.match(caption, /^(&amp;)+…$/);
});

test("a chat block has its name and a no-action line", () => {
  const block = renderChatBlock(
    { chatName: "Clase 2B", discussed: ["Excursión"], conclusions: [], actionItems: [], pictures: [] },
    "No action required",
  );
  assert.match(block, /^<b>Clase 2B<\/b>/);
  assert.match(block, /✅ No action required/);
  assert.match(block, /• Excursión/);
});
