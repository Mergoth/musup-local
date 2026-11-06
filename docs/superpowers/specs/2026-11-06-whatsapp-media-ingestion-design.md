# WhatsApp pictures & voice notes in the digest — design

Date: 2026-11-06 · Status: builder-checked, awaiting user approval

## Why

musup's main use is school/parent group chats. A lot of the real information there arrives as
**voice notes** from parents and **pictures** — mostly screenshots and flyers full of text
(a school-trip authorisation: date, €5, pay-by deadline; an AMPA Christmas-photo flyer: dates,
prices, booking phone). Today musup stores only text and captions, so a caption-less picture or a
voice note is invisible to the digest (`saveNormalizedMessage` skips it as `no_text`).

Success: a voice note's content and a flyer's dates/prices/deadlines show up in the digest as if
someone had typed them, and the flyer itself arrives next to its chat's section when it's worth
keeping.

## Goals

1. **Voice notes** (WhatsApp `audioMessage` with `ptt: true`) in subscribed chats are transcribed;
   the transcript enters the digest input as that sender's message, marked as a voice note.
2. **Pictures** (`imageMessage`) in subscribed chats are described by a vision model; the
   description copies out visible text and key facts (dates, prices, phone numbers, deadlines,
   names). The digest input gets the description plus any caption, marked as a picture.
3. The digest model decides **per picture** whether to send the picture itself with the digest
   (a flyer, timetable or form you'd act on or keep) or just use its facts (screenshot of a chat,
   meme). The rule lives in the editable prompt.
4. **Three model configurations** — Digest, Vision, Transcription — each with endpoint, model,
   API key and a Test button.
5. Digest delivery becomes **one message per chat**, with that chat's chosen pictures sent right
   after its section, on Telegram and on WhatsApp.

## Non-goals

- Videos, stickers, documents/PDFs, non-voice audio files (`audioMessage` without `ptt`).
- Media from non-subscribed chats (never downloaded).
- User-editable vision/transcription prompts (hard-coded for now).
- Translating transcripts/descriptions at ingest — they stay in the original language; the digest
  translates as it does for text.

## Anti-goals

- **A digest that fails or is late because a media model is slow, down or misconfigured.** Media
  processing must never block or fail the digest; worst case a message becomes a placeholder.
- Runaway API spend from a stray long audio or huge image (size caps below).
- Keeping media longer than needed.

## Decided by the user

- **Settings UI: tabs** (Digest / Vision / Transcription), one configuration visible at a time.
  Each field (endpoint, model, API key) has a **"⇉ copy to all"** button that copies its value into
  the same field of the other two configurations (client-side; keys are already sent to the
  authenticated UI in plain text today). The existing LLM block becomes the Digest tab. Under the
  fields: Test and Save buttons for the active tab, test result line below (same as today's LLM
  block). Mockup (gitignored, local only): `.superpowers/brainstorm/*/content/model-settings.html`,
  option A — the description here is complete; nothing else was agreed beyond it.
- **Pictures placement: option B** — digest split per chat; each chat's section is followed by that
  chat's selected pictures (each with a short caption saying what it is / why it matters).
- User will run on **OCI or GCP** models. GCP means **Google AI Studio (Gemini API) with a static
  API key** — no Vertex/OAuth/service-account auth.
- **Transcription supports two request shapes**, chosen automatically by the endpoint URL: a URL
  ending in `/audio/transcriptions` → Whisper-style multipart upload (`file`, `model`; response
  `text` or JSON `{text}`), anything else → chat completions with an `input_audio` part. Same
  Bearer key auth for both.
- **View-once** pictures and voice notes (wrapped in `viewOnceMessage*`, which
  `normalizeMessageContent` unwraps — detect on the raw message) are **never downloaded**; they
  enter the digest as `[view-once picture]` / `[view-once voice note]`.
- Size caps, placeholders, out-of-scope list: accepted as proposed (below).

## Behaviour

### Ingestion (at arrival)

In `saveNormalizedMessage` (src/index.ts), for subscribed chats, live **and** history/backfill:

- `imageMessage` → download via Baileys `downloadMediaMessage` (with `reuploadRequest:
  sock.updateMediaMessage` so older media can be re-fetched). Skip if `fileLength` > 10 MB.
- `audioMessage` with `ptt` → download. Skip if `seconds` > 600.
- The message is saved even with no text (today it would be dropped as `no_text`), with a media
  record linked by `messageId`.
- If download fails (expired history media, network) → media status `unavailable`.
- Too-old messages (`too_old`) are still skipped before any download.

Downloaded bytes go to `DATA_DIR/media/<messageId>.<ext>`. A media record (new sql.js table
`media_items`; schema left to builder) holds at least: messageId, chatJid, kind (`picture` |
`voice`), mime type, file path, status (`pending` | `done` | `failed` | `unavailable` |
`skipped_too_large` | `not_configured`), result text, error, attempts, timestamps.

### Processing (background, after arrival)

A small in-process worker processes `pending` items one at a time (no parallelism needed),
triggered after each download and on startup.

- **Voice:** transcode Ogg/Opus → MP3 (mono, low bitrate) with ffmpeg, then call the
  Transcription config: chat completions with an `input_audio` content part (`format: "mp3"`) and
  a fixed instruction (transcribe verbatim in the original language, no commentary), or — when the
  URL ends in `/audio/transcriptions` — a Whisper-style multipart upload of the MP3. Result =
  transcript. Delete the audio file after success.
- **Picture:** call the Vision config's chat-completions endpoint with an `image_url` content part
  (base64 `data:` URL) and a fixed instruction: in the original language of the picture, give a
  one-line description of what it is, then transcribe all readable text, then list key facts
  (dates, times, prices, places, phone numbers, deadlines, people). Keep the file (it may be sent).
- If the relevant config is incomplete → status `not_configured` (no error event spam; one info
  event is fine).
- On failure → `failed`, attempts += 1, `recordEvent("warn", "media.process_failed", …)`.

Both calls use the same OpenAI-compatible request/response shape as `llmClient.chatCompletion`
(Bearer key, `choices[0].message.content`). Verified against Gemini's OpenAI-compat docs:
chat completions accept `input_audio` (base64 + format) and `image_url` parts. OCI Generative AI
exposes an OpenAI-compatible endpoint too; support for audio there depends on the model the user
picks — that's on configuration, not code.

### Digest

At digest time (`runDigest`), before building the prompt:

- Any media for the loaded messages still `pending` or `failed` with attempts < 2 gets **one**
  more processing attempt, with a short per-item timeout (builder's call, ~60s). Whatever is not
  `done` afterwards becomes a placeholder. The digest proceeds regardless.
- `loadMessages`/`parseMessageLine` must accept media messages with empty text.
- Message text given to the prompt:
  - voice done: `[voice note] <transcript>`
  - picture done: `[picture] <description>` + `\nCaption: <caption>` if any
  - otherwise placeholders: `[voice note, not transcribed]`, `[picture, not described]`,
    `[picture, unavailable]`, `[voice note too long, skipped]`, `[picture too large, skipped]`
- Pictures whose file is still on disk are marked in the structured input as sendable (e.g.
  `"picture": { "sendable": true }`) so the model only picks real ones.
- Structured output contract gains, per chat:
  `"pictures": [{ "messageId": "...", "caption": "short reason/label in summary language" }]`
  The hard-coded contract carries the schema **and a baseline rule** (include a picture only if
  it's something the reader would act on or keep — flyer, timetable, form, schedule, price list;
  omit it when the text already captures it), so installs with an edited prompt still behave.
  Match pictures by `messageId` against that chat's sendable pictures; ignore anything else.
  *(Claude's call.)*
- Default prompt (`prompts/summary.json`) gets a sentence about voice notes and pictures in
  `instructions`, and `perChatTemplate` repeats/refines the picture rule so the user can tune it.
  `isLegacyDefaultPrompt` should treat the previous default as legacy so existing installs pick up
  the new default (only when the user hadn't edited it).

### Delivery (option B)

- Render each chat block separately (reuse `renderStructuredSummary` logic per chat).
- **Telegram:** for each recipient: chat block via existing `sendMessage` (still split at 3900),
  then each selected picture via `sendPhoto` (multipart upload, caption ≤ 1024 chars, HTML-escaped).
- **WhatsApp:** chat block as text, then each picture via `sock.sendMessage(jid, { image: buffer,
  caption })` — extend the delivery handler in `whatsappDelivery.ts` with an image variant.
- Empty summary stays a single message.
- A failed picture send logs an event and continues; it doesn't fail the digest.
- **Partial failure of text blocks** *(Claude's call)*: deliver chat by chat. If a chat's text
  block fails for any target, record an error event, continue with the other chats, and leave
  that chat's messages unprocessed so the next digest retries them (its picture files are kept).
  Chats delivered to all enabled targets are marked processed. The digest result is `ok` if at
  least one chat was delivered, `error` if none. Some duplication on retry for multi-recipient
  setups is accepted.
- Summary journal records sent pictures (messageIds + captions) and the Summaries page shows e.g.
  "📷 2 pictures sent" per entry.

### Retention

- Audio files: deleted right after successful transcription; otherwise with the message.
- Picture files: deleted once their message is marked processed by a digest (sent or not), or when
  `purgeOldMessages` removes the message's NDJSON bucket — whichever first.
- `media_items` rows: purged alongside messages (same cutoffs). Descriptions/transcripts survive
  as long as the message does, so "reset processed" re-digests still have the text (but can't
  resend already-deleted pictures — acceptable).

### Settings

- New settings keys (same key/value table, same seeding pattern): `visionApiUrl`, `visionModel`,
  `visionApiKey`, `transcriptionApiUrl`, `transcriptionModel`, `transcriptionApiKey`.
  Empty by default. Existing `llm*` keys are the Digest config — no migration.
- `GET/PUT /api/settings` carry the new fields; Test endpoint generalised to
  `POST /api/settings/test-llm` with a `target: "digest" | "vision" | "transcription"` (or separate
  routes — builder's call). Test for vision/transcription = a minimal real request: a tiny embedded
  image / a ~1s embedded audio clip, so it proves the endpoint accepts that media type.
- Monitor/status: counters for media processed / failed are nice-to-have.

### Docker

`Dockerfile` installs ffmpeg. Debian's `ffmpeg` package pulls many libraries; prefer the smallest
option that decodes Opus and encodes MP3 (e.g. `apt-get install --no-install-recommends ffmpeg`,
or the `ffmpeg-static` npm package). Expected growth was estimated at 30–50 MB; if the chosen
route is much larger, note it in the PR.

## Constraints

- TypeScript/Node 22, ESM, Baileys 6.7.x, sql.js, plain `public/` JS UI — follow existing
  patterns (no new frameworks).
- Must run on the Oracle Always Free VM (low RAM): process one media item at a time, stream/
  buffer sizes bounded by the caps.
- There are no tests in the repo today. Add focused unit tests with `node:test` via `tsx` for the
  pure parts (prompt text assembly, output parsing of `pictures`, per-chat rendering, placeholder
  mapping, retention decisions).

## Left to the builder

- `media_items` schema, worker structure, exact timeouts, file naming.
- Exact wording of the fixed vision/transcription instructions and prompt additions.
- Whether test endpoints are one route with a target or three.
- Small embedded test image/audio for Test buttons.
