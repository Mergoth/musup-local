# musup-local — AI assistant context

## What this project is

WhatsApp group chat monitor that runs entirely on a home NAS via Docker Compose.
It captures group messages, stores them in local files, and sends AI-generated
summaries to Telegram on a configurable schedule.

**No cloud infrastructure.** No GCP, no Firestore, no Pub/Sub. The only external
services are an LLM API (Gemini via OpenAI-compatible endpoint) and the Telegram
Bot API.

## Repository layout

```
musup-local/
├── collector/          # TypeScript / Node.js — WhatsApp → local files
├── processor/          # Kotlin / Micronaut  — files → LLM → Telegram
├── data/               # runtime data volume (Docker mount, git-ignored)
│   ├── auth/           # Baileys WhatsApp session (never delete while running)
│   ├── chats.json      # JID → chat name registry, written by collector
│   ├── messages/       # YYYY-MM-DD.ndjson raw message logs (one line per msg)
│   └── processed.json  # dedup index of message IDs already sent in a digest
├── docker-compose.yml
├── .env                # secrets (LLM_API_KEY, TELEGRAM_BOT_TOKEN, …)
└── .env.example
```

## Data flow

```
WhatsApp groups
     │
     ▼
collector (Baileys)
  • receives messages via WebSocket
  • normalises each message to a flat struct
  • registers JID → name in data/chats.json regardless of allow-list
  • filters by ALLOWED_CHAT_JIDS (collector env var)
  • appends allowed messages to data/messages/YYYY-MM-DD.ndjson
     │
     ▼
processor (Micronaut / Kotlin)
  • reads ndjson files on Quartz cron (managed via Admin UI, defaults to 06:00 & 19:00 UTC)
  • filters by musup.chat-jids (can differ from collector allow-list)
  • builds a prompt and calls LLM API (Gemini, OpenAI-compat)
  • sends Telegram HTML summary to configured chat IDs
  • marks processed message IDs in data/processed.json
```

## Key configuration

### Collector (`docker-compose.yml` environment or `.env`)

| Variable | Purpose |
|---|---|
| `ALLOWED_CHAT_JIDS` | Comma-separated JIDs to forward; **empty = all chats** |
| `DATA_DIR` | Shared volume path (default `/data`) |
| `COLLECTOR_PORT` | Port for the Admin UI (default `8081`) |
| `PROCESSOR_PORT` | Port for the Processor manual trigger (default `8080`) |

### Processor (`application.yml` or env overrides)

| Key | Env override | Purpose |
|---|---|---|
| `musup.chat-jids` | `MUSUP_CHAT_JIDS` | JIDs to include in digest |
| `musup.chat-labels-csv` | `MUSUP_CHAT_LABELS_CSV` | `jid=Label` pairs |
| `musup.digest-cron` | `MUSUP_DIGEST_CRON` | Quartz cron (UTC, 6 fields; overridden by config.json) |
| `musup.digest-window-hours` | `MUSUP_DIGEST_WINDOW_HOURS` | Look-back window |
| `musup.llm-api-key` | `LLM_API_KEY` | Gemini / OpenAI key |
| `musup.telegram-bot-token` | `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `musup.telegram-chat-ids` | `TELEGRAM_CHAT_ID_1`, `_2` | Recipient chat IDs |

## Build & run

```bash
# First time: compile processor (requires JDK 17+)
cd processor && ./gradlew clean installDist && cd ..

docker compose build
docker compose up -d

# Scan WhatsApp QR (first run only)
docker compose logs -f collector

# Manual digest trigger (replace 8080 with PROCESSOR_PORT if changed)
curl -X POST http://localhost:8080/jobs/whatsapp-summary
```

## Finding a group JID

Start the collector, send any message to the group, then check `data/chats.json`.
The JID is the key (e.g. `120363421703374121@g.us`).

## Deploy

```bash
# Deploy only the processor (most common)
bash deploy.sh processor

# Deploy everything
bash deploy.sh all
```

Requires `deploy.local.sh` (git-ignored). Copy from `deploy.local.sh.example`.

The NAS JVM takes ~90 seconds to start. Don't assume the processor is ready
immediately after `docker compose up -d`. Poll the logs or wait before triggering.

Manual digest trigger on NAS (after processor is up, replace 8080 with PROCESSOR_PORT if changed):
```bash
ssh -p <PORT> <USER>@<HOST> "curl -s -X POST http://localhost:8080/jobs/whatsapp-summary"
```

## Tech stack

| Component | Runtime | Key libraries |
|---|---|---|
| collector | Node.js 20 | Baileys (WhatsApp WS), TypeScript |
| processor | JVM 17 (GraalVM) | Micronaut 4, Jackson, Quartz |

## Claude notes

- **Never use `run_in_background: true` with `logs -f` or polling `until` loops** —
  they spawn orphaned terminal sessions that persist after the task is done.
  Use synchronous commands for log tailing, or tail with `--tail=N` (no `-f`).
- **The `/health` endpoint does not exist** — don't poll it for readiness.
  Use `docker logs` and look for "Startup completed" instead.
- **MessageStore timestamp filter is exclusive on the upper bound** (`timestamp >= toTs`
  is skipped). Fake test messages need `timestamp = now - 120` or similar to land
  inside the window.
- **`deploy.local.sh.example` must never contain real values** — usernames, hostnames,
  ports, paths. Placeholders only.
