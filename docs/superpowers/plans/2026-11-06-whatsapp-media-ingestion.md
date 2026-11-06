# WhatsApp Pictures & Voice Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transcribe voice notes and describe pictures from subscribed WhatsApp chats, feed them into the digest, and let the digest send selected pictures right after each chat's section.

**Architecture:** Media is downloaded at arrival into `DATA_DIR/media/` and tracked in a new sql.js table `media_items`; a single in-process worker turns each item into text via the Vision or Transcription model config. At digest time, message text is replaced/augmented with that text (or a placeholder), the LLM returns per-chat `pictures`, and delivery goes chat by chat (text block, then its pictures) on Telegram and WhatsApp.

**Tech Stack:** TypeScript (ESM, Node 22), Baileys 6.7.x, sql.js, plain JS UI in `public/`, ffmpeg (system binary), `node:test` + `tsx` for tests.

**Spec:** `docs/superpowers/specs/2026-11-06-whatsapp-media-ingestion-design.md`

All paths below are relative to `musup/` unless they start with `docs/`.

## Global Constraints

- Only subscribed chats; media from other chats is never downloaded.
- Voice = `audioMessage` with `ptt: true`. Picture = `imageMessage`. Everything else (video, sticker, document, non-ptt audio) is out of scope.
- View-once media (raw message has `viewOnceMessage`, `viewOnceMessageV2` or `viewOnceMessageV2Extension`) is never downloaded → `[view-once picture]` / `[view-once voice note]`.
- Caps: picture `fileLength` > 10 MB (10 * 1024 * 1024) → `[picture too large, skipped]`; voice `seconds` > 600 → `[voice note too long, skipped]`.
- Placeholders (exact text): `[voice note, not transcribed]`, `[picture, not described]`, `[picture, unavailable]`, `[voice note, unavailable]`, `[voice note too long, skipped]`, `[picture too large, skipped]`, `[view-once picture]`, `[view-once voice note]`.
- Done text: `[voice note] <transcript>`; `[picture] <description>`; a caption, when present, is appended as `\nCaption: <caption>`.
- Media processing never blocks or fails a digest. One retry at digest time, 60 s timeout per item.
- One media item processed at a time (low-RAM VM).
- Model calls: OpenAI-compatible chat completions, `Authorization: Bearer <key>`, result in `choices[0].message.content`. Transcription URL ending in `/audio/transcriptions` (ignoring trailing `/` and query string) → Whisper-style multipart (`file`, `model`), response JSON `{text}` or plain text.
- Settings keys: `visionApiUrl`, `visionModel`, `visionApiKey`, `transcriptionApiUrl`, `transcriptionModel`, `transcriptionApiKey`; default empty. `llm*` stays the Digest config.
- Telegram photo caption ≤ 1024 characters.
- Follow existing patterns: `recordEvent`, `appLogger`, `getSettings`, no new frameworks. Only new runtime dependency allowed: none (ffmpeg is a system binary via `child_process.spawn`).

## Review Focus

1. **The same message arrives twice** (live `notify` and history `append`, or repeated backfill) → downloaded and processed once. Test in Task 3 (`upsertMediaItem` is insert-or-ignore).
2. **The LLM names a picture that isn't a sendable picture of that chat** (made-up id, id from another chat, a voice note's id) → silently ignored. Test in Task 6.
3. **Picture is PNG/WebP, not JPEG** → data URL uses the item's real mimetype. Test in Task 2.
4. **Media with a caption whose processing failed** → the caption still reaches the digest after the placeholder. Test in Task 1.
5. **Telegram caption longer than 1024 chars or containing `<`/`&`** → truncated and HTML-escaped, the photo still goes out. Test in Task 7.

---

### Task 1: Test runner + media text mapping

**Files:**
- Modify: `package.json` (add script `"test": "node --import tsx --test \"src/**/*.test.ts\""`), `tsconfig.json` (add `"exclude": ["src/**/*.test.ts"]` so tests stay out of `dist/`)
- Create: `src/media/mediaTypes.ts`, `src/media/mediaText.ts`
- Test: `src/media/mediaText.test.ts`

**Interfaces:**
- Produces (`mediaTypes.ts`):
  ```ts
  export type MediaKind = "picture" | "voice";
  export type MediaStatus = "pending" | "done" | "failed" | "unavailable"
    | "skipped_too_large" | "skipped_view_once" | "not_configured";
  export type MediaItem = {
    messageId: string; chatJid: string; kind: MediaKind; status: MediaStatus;
    mimeType: string; filePath: string | null; resultText: string | null;
    error: string | null; attempts: number; createdAt: string; updatedAt: string;
  };
  export const MAX_PICTURE_BYTES = 10 * 1024 * 1024;
  export const MAX_VOICE_SECONDS = 600;
  ```
- Produces (`mediaText.ts`): `mediaMessageText(item: Pick<MediaItem,"kind"|"status"|"resultText"|"error">, caption?: string): string` — follows the done/placeholder rules in Global Constraints. `status: "skipped_too_large"` maps to the "too large/too long" placeholder; `unavailable` maps to the `, unavailable` placeholder; `pending`/`failed`/`not_configured` map to `not transcribed`/`not described`.

- [ ] **Step 1: Write failing tests** in `src/media/mediaText.test.ts` using `node:test` and `node:assert/strict`:
  - `done voice` → `mediaMessageText({kind:"voice",status:"done",resultText:"Hola, mañana no hay clase",error:null})` equals `"[voice note] Hola, mañana no hay clase"`.
  - `done picture with caption` → `"[picture] Flyer: Fotos de Navidad…\nCaption: mirad esto"`.
  - `failed picture keeps caption` → `{kind:"picture",status:"failed"}`, caption `"pagar antes del jueves"` → `"[picture, not described]\nCaption: pagar antes del jueves"`.
  - one assertion per remaining placeholder in Global Constraints (view-once, too large, too long, unavailable ×2, not_configured voice).
- [ ] **Step 2: Run** `cd musup && npm install && npm test` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `mediaTypes.ts` and `mediaText.ts`.
- [ ] **Step 4: Run** `npm test` — Expected: all pass. Also `npm run build` — Expected: no errors.
- [ ] **Step 5: Commit** `feat(media): media types and digest text mapping`.

### Task 2: Model configs, model clients, Test endpoint

**Files:**
- Modify: `src/db/database.ts` (`AppSettings` + seed/get/update for the six keys), `src/server.ts` (`cleanSettingsPatch`, test route), `src/digest/llmClient.ts`
- Create: `src/media/mediaModels.ts`, `src/media/ffmpeg.ts`, `src/media/testMedia.ts`
- Test: `src/media/mediaModels.test.ts`

**Interfaces:**
- Produces (`llmClient.ts`): `export type ModelTarget = "digest" | "vision" | "transcription";` `export function getModelConfig(settings: AppSettings, target: ModelTarget): LlmConnectionConfig` (maps to `llm*` / `vision*` / `transcription*`); `export function isModelConfigured(cfg: LlmConnectionConfig): boolean`; `chatCompletion` is exported and accepts `content: string | ContentPart[]` and optional `{ timeoutMs?: number }` (AbortSignal.timeout). Existing callers keep passing a string.
- Produces (`mediaModels.ts`):
  - `buildVisionMessages(image: Buffer, mimeType: string): ContentPart[]` — text instruction + `{type:"image_url", image_url:{url:"data:<mimeType>;base64,..."}}`.
  - `buildAudioMessages(mp3: Buffer): ContentPart[]` — text instruction + `{type:"input_audio", input_audio:{data, format:"mp3"}}`.
  - `isWhisperUrl(url: string): boolean`.
  - `describeImage(image: Buffer, mimeType: string, cfg: LlmConnectionConfig, opts?: {timeoutMs?: number}): Promise<string>`.
  - `transcribeAudio(mp3: Buffer, cfg: LlmConnectionConfig, opts?: {timeoutMs?: number}): Promise<string>` — Whisper multipart via `FormData` + `Blob` (`file` named `voice.mp3`, `model`) when `isWhisperUrl`, else chat with `buildAudioMessages`.
  - `testModel(target: ModelTarget, cfg: LlmConnectionConfig): Promise<{ok:true; latencyMs:number; model:string; text:string}>` — digest: existing text ping; vision: `describeImage` on `TEST_PNG`; transcription: `transcribeAudio` on `TEST_MP3`.
- Produces (`ffmpeg.ts`): `transcodeToMp3(input: Buffer): Promise<Buffer>` — `spawn("ffmpeg", ["-hide_banner","-loglevel","error","-i","pipe:0","-ac","1","-ar","16000","-b:a","32k","-f","mp3","pipe:1"])`; reject with stderr on non-zero exit.
- Produces (`testMedia.ts`): `TEST_PNG: Buffer` (a small base64-embedded PNG showing readable text is ideal; a 1×1 PNG is acceptable), `TEST_MP3: Buffer` (≈1 s of silence, base64-embedded, generated once with ffmpeg: `ffmpeg -f lavfi -i anullsrc=r=16000:cl=mono -t 1 -b:a 32k out.mp3`).
- Fixed instructions (exact copy):
  - Vision: `Describe this image for someone who cannot see it. Answer in the language of the text in the image (or English if there is none). First line: what the image is. Then transcribe all readable text verbatim. Then list key facts: dates, times, prices, places, phone numbers, deadlines, people. No commentary.`
  - Audio (chat mode): `Transcribe this voice message verbatim in its original language. Output only the transcript.`
- Server: `POST /api/settings/test-llm` accepts optional `target` (default `"digest"`) plus the same `llmApiUrl/llmModel/llmApiKey` body keys; calls `testModel`. Events keep the existing names and add `target` to their data.

- [ ] **Step 1: Write failing tests** in `src/media/mediaModels.test.ts`:
  - `buildVisionMessages(Buffer.from("x"), "image/webp")[1].image_url.url` starts with `"data:image/webp;base64,"`.
  - `buildAudioMessages(Buffer.from("x"))[1]` deep-equals `{type:"input_audio", input_audio:{data:"eA==", format:"mp3"}}`.
  - `isWhisperUrl` true for `https://api.openai.com/v1/audio/transcriptions`, `…/audio/transcriptions/`, `…/audio/transcriptions?api-version=1`; false for `…/chat/completions`.
  - `getModelConfig(settings, "vision")` returns `{llmApiUrl: settings.visionApiUrl, llmModel: settings.visionModel, llmApiKey: settings.visionApiKey}` (build a plain `AppSettings` literal; don't touch the DB).
- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces above; extend settings in `database.ts` and `server.ts` following the `llmApiUrl` lines exactly.
- [ ] **Step 4: Run** `npm test && npm run build` — Expected: pass. Manual: `echo test | ffmpeg -version` exists locally (`brew install ffmpeg` if not).
- [ ] **Step 5: Commit** `feat(media): vision/transcription model configs and clients`.

### Task 3: Media store

**Files:**
- Modify: `src/db/database.ts` (table + index in `initDatabase`)
- Create: `src/media/mediaStore.ts`
- Test: `src/media/mediaStore.test.ts`

**Interfaces:**
- Table:
  ```sql
  create table if not exists media_items (
    message_id text primary key, chat_jid text not null, kind text not null,
    status text not null, mime_type text not null default '', file_path text,
    result_text text, error text, attempts integer not null default 0,
    created_at text not null, updated_at text not null);
  create index if not exists idx_media_items_status on media_items(status);
  ```
- Produces (`mediaStore.ts`), all synchronous, each write ends with `saveDb()` (export `saveDb`/`getDb` from `database.ts` if not already):
  - `mediaDir(): string` → `path.join(config.dataDir, "media")`.
  - `upsertMediaItem(input: {messageId; chatJid; kind; status; mimeType; filePath?: string|null}): boolean` — insert-or-ignore; returns `true` only if inserted.
  - `getMediaItem(messageId: string): MediaItem | undefined`, `getMediaItems(messageIds: string[]): Map<string, MediaItem>`.
  - `listMediaByStatus(statuses: MediaStatus[]): MediaItem[]` (oldest first).
  - `updateMediaItem(messageId: string, patch: Partial<Pick<MediaItem,"status"|"resultText"|"error"|"attempts"|"filePath">>): void`.
  - `deleteMediaFile(messageId: string): void` — unlink file if present, set `file_path` null.
  - `purgeMediaItems(keepMessageIds: Set<string>): number` — delete rows (and files) whose message is no longer retained.

- [ ] **Step 1: Write failing tests**: in the test file set `process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(),"musup-test-"))` **before** dynamically importing `../db/database.js` and `./mediaStore.js`; `await initDatabase()`.
  - `upsertMediaItem` same messageId twice → first `true`, second `false`; row unchanged.
  - `updateMediaItem(id,{status:"done",resultText:"x"})` then `getMediaItem(id).status === "done"`.
  - `deleteMediaFile` removes a file written to `mediaDir()` and nulls `filePath`.
  - `purgeMediaItems(new Set(["keep"]))` removes everything except `keep`, returns count.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run build` — Expected: pass.
- [ ] **Step 5: Commit** `feat(media): media_items store`.

### Task 4: Ingestion (classify + download)

**Files:**
- Modify: `src/normalize.ts`, `src/index.ts` (`saveNormalizedMessage`, both `messages.upsert` and `messaging-history.set` handlers), `src/store.ts` (no change to record shape needed beyond allowing empty text)
- Create: `src/media/mediaIngest.ts`
- Test: `src/normalize.test.ts`

**Interfaces:**
- Produces (`normalize.ts`): `NormalizedMessage` gains `media?: MediaInfo` where
  `export type MediaInfo = { kind: MediaKind; mimeType: string; viewOnce: boolean; fileLength?: number; seconds?: number };`
  and `export function classifyMedia(message: WAMessage): MediaInfo | undefined` — `imageMessage` → picture; `audioMessage` with `ptt` → voice; else undefined. `viewOnce` is read from the **raw** `message.message` before `normalizeMessageContent`. `fileLength` may be a Long — convert with `Number()`.
- Produces (`mediaIngest.ts`): `ingestMedia(message: WAMessage, normalized: NormalizedMessage, download: (m: WAMessage) => Promise<Buffer>): Promise<void>` —
  - view-once → `upsertMediaItem` status `skipped_view_once`, no download.
  - over cap → `skipped_too_large`, no download.
  - else if `upsertMediaItem(... status "pending")` returned `false` → return (already known).
  - download → write `mediaDir()/<messageId>.<ext>` (`ext` from mimetype: jpeg→jpg, png, webp, ogg; default `bin`) → `enqueueMedia(messageId)` (Task 5). Download error → status `unavailable`, `recordEvent("warn","media.download_failed",…)`.
- `index.ts`: skip reason `no_text` applies only when `!normalized.text && !normalized.media`. After a successful `appendMessage`, call `ingestMedia(message, normalized, (m) => downloadMediaMessage(m, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage }) as Promise<Buffer>)`. Pass the raw `WAMessage` into `saveNormalizedMessage` for that. Wrap in try/catch — ingestion errors must not stop message saving.
- `messageStore.parseMessageLine`: keep lines with empty `text` when `messageType` is `imageMessage` or `audioMessage`.

- [ ] **Step 1: Write failing tests** in `src/normalize.test.ts` with hand-built `WAMessage` objects:
  - `{message:{imageMessage:{mimetype:"image/jpeg", fileLength: 2048}}}` → `{kind:"picture", mimeType:"image/jpeg", viewOnce:false, fileLength:2048}`.
  - `{message:{audioMessage:{mimetype:"audio/ogg; codecs=opus", ptt:true, seconds:42}}}` → voice, `seconds:42`.
  - `audioMessage` with `ptt:false` → `undefined`.
  - `{message:{viewOnceMessageV2:{message:{imageMessage:{mimetype:"image/jpeg"}}}}}` → picture with `viewOnce:true`.
  - `videoMessage` / `stickerMessage` → `undefined`.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement** `classifyMedia`, `ingestMedia`, the `index.ts` and `messageStore.ts` changes.
- [ ] **Step 4: Run** `npm test && npm run build` — Expected: pass.
- [ ] **Step 5: Commit** `feat(media): download pictures and voice notes from subscribed chats`.

### Task 5: Media worker

**Files:**
- Create: `src/media/mediaWorker.ts`
- Modify: `src/index.ts` (call `startMediaWorker()` after `initDatabase()`)
- Test: `src/media/mediaWorker.test.ts`

**Interfaces:**
- Produces:
  - `processMediaItem(messageId: string, deps?: WorkerDeps, opts?: {timeoutMs?: number}): Promise<MediaItem | undefined>` — no-op unless status is `pending` or `failed`. Reads config via `getModelConfig(getSettings(), kind==="picture"?"vision":"transcription")`; not configured → `not_configured` (one `recordEvent("info","media.not_configured",…)` per process lifetime per kind). File missing → `unavailable`. Voice: `transcodeToMp3` → `transcribeAudio` → `done`, then `deleteMediaFile`. Picture: `describeImage` → `done` (keep file). Error → `failed`, `attempts+1`, error message saved, `recordEvent("warn","media.process_failed",…)`.
  - `type WorkerDeps = { describeImage; transcribeAudio; transcodeToMp3 }` (defaults to the real ones; tests inject fakes).
  - `enqueueMedia(messageId: string): void` — pushes onto a single serial promise chain.
  - `startMediaWorker(): void` — enqueues all `pending` items.
  - `ensureMediaProcessed(messageIds: string[], timeoutMs = 60_000): Promise<void>` — for items with status `pending`, or `failed` with `attempts < 2`, runs `processMediaItem` serially with the timeout; never throws.
- `ensureMediaProcessed` and `processMediaItem` treat `not_configured` like `pending` (the config may have been added since), without counting it as an attempt.

- [ ] **Step 1: Write failing tests** (temp `DATA_DIR` as in Task 3; write settings via `updateSettings`; inject fake deps):
  - picture, vision configured, fake `describeImage` returns `"Flyer"` → status `done`, `resultText "Flyer"`, file still exists.
  - voice, fake transcode+transcribe → `done`, file deleted.
  - vision not configured → `not_configured`, fake not called.
  - fake throws → `failed`, `attempts 1`; `ensureMediaProcessed([id])` retries once → `attempts 2`; a third `ensureMediaProcessed` does not call the fake.
  - `ensureMediaProcessed` with a fake that never resolves and `timeoutMs: 50` resolves and leaves status `failed`.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run build` — Expected: pass.
- [ ] **Step 5: Commit** `feat(media): serial worker for describing and transcribing media`.

### Task 6: Digest input and picture selection

**Files:**
- Modify: `src/digest/types.ts`, `src/digest/promptBuilder.ts`, `src/digest/structuredSummary.ts`, `prompts/summary.json`, `src/digest/promptTemplates.ts` (`isLegacyDefaultPrompt`), `src/digest/digestService.ts` (call `ensureMediaProcessed` + `applyMediaText` before `buildPrompt`)
- Test: `src/digest/structuredSummary.test.ts`, `src/digest/promptBuilder.test.ts`

**Interfaces:**
- Produces (`types.ts`): `WhatsappMessage` gains `sendablePicture?: boolean`.
- Produces (`src/media/mediaText.ts`): `applyMediaText(messages: WhatsappMessage[], items: Map<string, MediaItem>): WhatsappMessage[]` — for messages with an item, `text = mediaMessageText(item, originalText || undefined)`, `sendablePicture = kind==="picture" && status==="done" && filePath && fs.existsSync(filePath)`; media messages with no item get `[picture, not described]` / `[voice note, not transcribed]` by `messageType`.
- `promptBuilder`: each structured message gets `"picture": {"sendable": true}` when `sendablePicture`. Contract JSON shape gains per chat `"pictures": [{"messageId": "...", "caption": "short label in the summary language"}]` and rules:
  - `- "pictures" may only contain messageIds of messages in that chat marked "picture": {"sendable": true}.`
  - `- Include a picture only if the reader would act on it or keep it (flyer, timetable, form, schedule, price list). Omit it when the text already captures everything. Usually 0-2 per chat.`
  - `- Messages starting with [voice note] are transcripts of voice messages; [picture] are descriptions of images. Use their facts like any other message.`
- `structuredSummary`: `StructuredSummaryChat` gains `pictures: { messageId: string; caption: string }[]`; `parseStructuredSummary` reads it (drops entries without a string messageId). New `export function selectPictures(chat: StructuredSummaryChat, sendable: Map<string, WhatsappMessage>): {messageId:string; caption:string; filePath:string}[]` — keeps only ids whose message is sendable **and** `message.chatJid === chat.chatJid` (fallback: chatName match when `chatJid` missing), de-duplicated.
- `prompts/summary.json`: append to `instructions`: `Voice notes arrive as transcripts and pictures as descriptions; treat them as messages from their sender.` Append to `perChatTemplate`: `- pictures worth forwarding: flyers, timetables, forms, price lists the reader would act on or keep`. Bump nothing else. `isLegacyDefaultPrompt`: also true when the template equals the **previous** `summary.json` sections exactly (keep a copy of the old four strings as a constant).

- [ ] **Step 1: Write failing tests**:
  - `parseStructuredSummary('{"chats":[{"chatJid":"a@g.us","chatName":"2B","discussed":[],"conclusions":[],"actionItems":[],"pictures":[{"messageId":"m1","caption":"Flyer"},{"caption":"no id"}]}]}').chats[0].pictures` deep-equals `[{messageId:"m1",caption:"Flyer"}]`.
  - `selectPictures` with chat `a@g.us` and pictures `m1` (sendable, chat a), `m2` (sendable, chat b), `m3` (voice), `m4` (unknown), `m1` again → returns only `m1` once.
  - `buildStructuredInput` (export it for the test) marks a sendable message with `picture: {sendable: true}` and not a voice note.
  - `applyMediaText` on an `imageMessage` with caption `"ver"` and failed item → text `"[picture, not described]\nCaption: ver"`, `sendablePicture` false.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement.** In `runDigest`, after `loadMessages`: `await ensureMediaProcessed(ids)`, then `applyMediaText(messages, getMediaItems(ids))`.
- [ ] **Step 4: Run** `npm test && npm run build` — Expected: pass.
- [ ] **Step 5: Commit** `feat(digest): include media text and let the model pick pictures`.

### Task 7: Per-chat delivery with pictures

**Files:**
- Modify: `src/digest/structuredSummary.ts` (per-chat render), `src/digest/telegramClient.ts`, `src/whatsappDelivery.ts`, `src/index.ts` (delivery handler), `src/digest/digestService.ts`, `src/digest/summaryStore.ts`, `src/digest/types.ts`
- Test: `src/digest/delivery.test.ts`

**Interfaces:**
- `structuredSummary`: `renderChatBlock(chat: StructuredSummaryChat, noActionRequiredText: string): string` (body of today's per-chat map); `renderStructuredSummary` reuses it (journal text unchanged).
- `telegramClient`: `telegramPhotoCaption(text: string): string` — HTML-escape, then truncate to 1024 chars total with `…`, never cutting inside an entity. `sendTelegramPhoto(file: Buffer, caption: string): Promise<void>` — `sendPhoto` multipart (`FormData`: `chat_id`, `photo` Blob, `caption`, `parse_mode: "HTML"`) to every configured chat id.
- `whatsappDelivery`: handler type becomes `(jid: string, payload: { text: string } | { image: Buffer; caption: string }) => Promise<WhatsappDeliveryResult>`; add `sendWhatsappImage(jid: string, image: Buffer, caption: string)`. `index.ts` handler passes `payload` straight to `sock.sendMessage(jid, payload)`.
- `digestService` delivery loop (replaces the single send):
  ```
  for each chat in parsed.chats:
    block = renderChatBlock(...)
    try: send block to Telegram (if enabled) and WhatsApp (if enabled)
    catch: recordEvent("error","digest.chat_delivery_failed",{chatName, error}); failedChats.add(chat.chatJid); continue
    for pic in selectPictures(chat, sendableById):
      try: send photo to each enabled target with pic.caption
           sentPictures.push(pic)
      catch: recordEvent("warn","digest.picture_delivery_failed",{messageId, error})
  if parsed.chats is empty: send emptySummaryText once as today.
  ```
  Mark processed: all loaded messages except those whose `chatJid` is in `failedChats`. For the processed messages, `deleteMediaFile` every picture item. Result: `status "ok"` if `parsed.chats.length === 0` or at least one chat delivered, else throw (existing error path). Chats in the LLM output that have no chatJid can't be matched to messages: treat their failure as failing no messages (log only).
- `DigestResult`/`SummaryInput`/`StoredSummary` gain `pictures?: {messageId: string; caption: string}[]`; journal persists it.

- [ ] **Step 1: Write failing tests**:
  - `telegramPhotoCaption("a".repeat(2000)).length <= 1024` and ends with `…`.
  - `telegramPhotoCaption("Precio <16€> & más")` equals `"Precio &lt;16€&gt; &amp; más"`.
  - `telegramPhotoCaption("&".repeat(400))` (escaped length 2000) ≤ 1024 and does not end with a partial `&am`.
  - `renderChatBlock` for a chat with no action items contains `✅ No action required` (pass that string) and the chat name in `<b>`.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run build` — Expected: pass.
- [ ] **Step 5: Commit** `feat(digest): deliver per chat with selected pictures`.

### Task 8: Retention for media

**Files:**
- Modify: `src/digest/messageStore.ts` (`purgeOldMessages`)
- Test: extend `src/media/mediaStore.test.ts`

**Interfaces:**
- Consumes: `purgeMediaItems(keep: Set<string>)` from Task 3.
- `purgeOldMessages` already builds `retainedMessageIds` after deleting buckets; call `purgeMediaItems(retainedMessageIds)` there and include `purgedMedia` in its log line. Also on startup remove files in `mediaDir()` with no row (orphans from a crash) — add `purgeOrphanMediaFiles(): number` to `mediaStore.ts`, called from `startMediaWorker`.

- [ ] **Step 1: Write failing test**: a file `orphan.jpg` in `mediaDir()` with no row is removed by `purgeOrphanMediaFiles()` (returns 1); a file belonging to a row survives.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run build` — Expected: pass.
- [ ] **Step 5: Commit** `feat(media): purge media with expired messages`.

### Task 9: Settings UI (tabs + copy to all) and Summaries picture count

**Files:**
- Modify: `public/index.html` (Model settings article), `public/app.js`, `public/styles.css`

**Interfaces:**
- Consumes: settings fields from Task 2; `target` on `/api/settings/test-llm`; `pictures` on summaries from Task 7.
- HTML: inside the existing "Model settings" article, above the fields, a tab row `<div class="model-tabs" role="tablist">` with three `<button role="tab" data-model-target="digest|vision|transcription">` labelled **Digest**, **Vision**, **Transcription**. One set of three inputs (keep ids `llm-api-url`, `llm-model`, `llm-api-key`); each `setting-row` gets a trailing `<button type="button" class="secondary-button copy-to-all" data-field="url|model|key">⇉ copy to all</button>`. Small hint under the tabs per tab: Digest "Writes the summary.", Vision "Describes pictures. Leave empty to skip pictures.", Transcription "Transcribes voice notes. Use a chat endpoint, or a URL ending in /audio/transcriptions for Whisper-style APIs. Leave empty to skip voice notes."
- JS: keep an in-memory draft `{digest:{url,model,key}, vision:{…}, transcription:{…}}` loaded from settings. Switching tabs stores the visible inputs into the draft and loads the next one. "Copy to all" writes the current input's value into that field for all three drafts and marks Save dirty. Save sends all nine fields. Test sends the active tab's values with `target`. Result text prefix: `Digest:` / `Vision:` / `Transcription:`.
- Summaries list: when `summary.pictures?.length`, add a `<span class="type-badge">📷 N</span>` next to the messages badge.
- No automated test (plain JS UI); verify manually in Step 2.

- [ ] **Step 1: Implement** the HTML/JS/CSS above (tabs must fit at 375 px width).
- [ ] **Step 2: Verify manually**: `cd musup && DATA_DIR=./tmp-data npm run dev`, open http://localhost:8787 → Config: switch tabs, values persist per tab; "copy to all" on the key fills all three; Save → reload → values intact; Test on each tab hits `/api/settings/test-llm` with the right `target` (check Network tab). Remove `tmp-data` afterwards.
- [ ] **Step 3: Commit** `feat(ui): tabbed model settings with copy to all`.

### Task 10: Docker image and docs

**Files:**
- Modify: `musup/Dockerfile`, `README.md` (repo root), `musup/.dockerignore` if needed

- [ ] **Step 1:** In the Dockerfile add, before `WORKDIR`: `RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*`.
- [ ] **Step 2: Verify:** `docker build -t musup-media musup && docker run --rm --entrypoint ffmpeg musup-media -version` — Expected: version line. Record `docker image ls musup-media` size before/after for the PR description.
- [ ] **Step 3:** README: in **Use**, add a step "**Config → Models** → optional Vision and Transcription models for pictures and voice notes (e.g. Gemini via AI Studio: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`)". One bullet under **Why**: "🖼️🎙️ Reads pictures and voice notes too — flyers get described, voice notes transcribed."
- [ ] **Step 4: Commit** `build: ffmpeg in image; docs for media models`.

### Task 11: End-to-end check

- [ ] **Step 1:** `npm test && npm run build` — all pass.
- [ ] **Step 2:** With real AI Studio keys in the UI, a linked WhatsApp and one subscribed test chat: send a voice note and the flyer image from the spec; within a minute the Monitor log shows no `media.process_failed`; trigger **Monitor → Test trigger**; the Telegram digest shows the chat section with the transcript facts, followed by the flyer with a caption; the Summaries entry shows "📷 1"; `DATA_DIR/media/` no longer contains those files.
