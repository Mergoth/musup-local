# musup-local

WhatsApp group message monitor that runs entirely on a local NAS via Docker Compose. Captures messages, stores them in plain files, and sends AI-generated summaries to Telegram on a configurable schedule. No cloud infrastructure required — only an LLM API key.

## Architecture

```
WhatsApp ──► collector (Node.js) ──► ./data/messages/YYYY-MM-DD.ndjson
                                              │
                               processor (Kotlin) reads on schedule
                                              │
                                         LLM API ──► Telegram
```

**Local files:**

| Path | Purpose |
|------|---------|
| `data/auth/` | WhatsApp session (Baileys) — persists across restarts |
| `data/messages/YYYY-MM-DD.ndjson` | Raw messages, one JSON line per message, rotated daily |
| `data/chats.json` | JID → chat name map, built automatically |
| `data/processed.json` | Dedup index — message IDs already included in a sent summary |

## First-time setup

### 1. Configure secrets

```bash
cp .env.example .env
# edit .env and fill in LLM_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID_1
```

### 2. Configure groups and schedule

Edit `processor/src/main/resources/application.yml`:

```yaml
musup:
  # Which groups to summarise (empty = all captured chats)
  chat-jids:
    - "120363421703374121@g.us"

  # Human-readable labels shown in the summary
  chat-labels-csv: "120363421703374121@g.us=Class 3B"

  # Quartz cron in UTC (default: 06:00 and 19:00 UTC)
  digest-cron: "0 0 6,19 * * ?"

  # Hours to look back on each run
  digest-window-hours: 13
```

> **Finding group JIDs:** start the collector, send a message to the group, then inspect `data/chats.json` — the JID appears as a key.

You can also override any `musup.*` setting via environment variables using Micronaut's convention: `MUSUP_CHAT_JIDS`, `MUSUP_DIGEST_CRON`, `MUSUP_LLM_MODEL`, etc. See `.env.example` for examples.

### 3. Build and start

The processor must be compiled before `docker compose build`. Requires JDK 22+.

```bash
cd processor && ./gradlew clean installDist && cd ..
docker compose build
docker compose up -d
```

### 4. Scan the WhatsApp QR code

```bash
docker compose logs -f collector
```

Scan the displayed QR with WhatsApp → **Linked Devices → Link a device**. The session is saved to `data/auth/` and reconnects automatically on restart.

## Running

```bash
# Start everything
docker compose up -d

# Follow logs
docker compose logs -f

# Manual digest trigger (without waiting for schedule)
curl -X POST http://localhost:8080/jobs/whatsapp-summary

# Rebuild after code changes
cd processor && ./gradlew clean installDist && cd ..
docker compose up -d --build processor
```

## Updating

```bash
# Collector (Node.js — no local build needed)
docker compose up -d --build collector

# Processor (Kotlin — must compile first)
cd processor && ./gradlew clean installDist && cd ..
docker compose up -d --build processor
```

## Using a different LLM

Set `LLM_API_URL` and `LLM_API_KEY` in `.env`. Any OpenAI-compatible endpoint works:

| Provider | URL |
|----------|-----|
| OpenAI | `https://api.openai.com/v1/chat/completions` |
| Groq | `https://api.groq.com/openai/v1/chat/completions` |
| Together AI | `https://api.together.xyz/v1/chat/completions` |
| Gemini (OpenAI compat) | `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` |
