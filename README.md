# musup

Self-hosted WhatsApp digest bot. Links to your WhatsApp account, silently reads the groups and contacts you choose, and sends you AI-written summaries on a schedule — to Telegram, back to WhatsApp, or both. Runs as a single Docker container with a web-based admin UI, no cloud accounts required.

## Install

```bash
git clone <repo-url> musup && cd musup
docker compose up -d --build
```

Podman also works (`podman compose up -d --build`).

Data (auth session, messages, summaries, settings) is stored in `./data`. To move it — e.g. on a NAS — edit the volume in `compose.yml`:

```yaml
- /volume1/docker/musup/data:/data
```

Open the admin UI: **http://localhost:8787**

## Configuration

### 1. Link WhatsApp

Open the **Monitor** tab → scan the QR code with WhatsApp → **Linked Devices → Link a Device**.

Once connected the status changes to *open* and the app starts collecting messages from all chats.

### 2. Pick chats to summarise

Go to the **Chats** tab. New chats appear as messages arrive. Toggle **Subscribed** for each group or contact you want included in digests.

### 3. Configure the LLM

Go to **Settings → LLM**. Provide an OpenAI-compatible endpoint and API key (works with OpenAI, Anthropic via proxy, Ollama, etc.). Hit **Test** to verify the connection.

Set the **Summary language** — the language summaries will be written in, regardless of the source language of the messages.

### 4. Set the digest schedule

In **Settings → Schedule**, enter the times you want digests sent each day (24 h format, your local timezone), for example `08:00`, `14:00`, `21:00`.

### 5. Set up delivery

Enable one or both delivery channels in **Settings**:

**Telegram**
- Create a bot via [@BotFather](https://t.me/BotFather) and copy the token.
- Get the chat ID(s) you want to receive digests (personal chat, group, channel).
- Enter the token and chat IDs, then hit **Test**.

**WhatsApp**
- Enter the JID of the chat that should receive digests (e.g. a personal note-to-self or a group). The JID is shown in the Chats tab.
- Hit **Test** to send a test message.

### 6. Enable summarisation

Go to **Settings → Summarisation** and toggle it on. Summaries will now be generated and delivered at the scheduled times.

You can trigger a digest immediately at any time from the Monitor tab or via the API.

## Prompt customisation

The default prompt template lives in `collector/prompts/summary.md`. To customise it without losing the default, edit it through **Settings → Prompt** in the UI (stored in `data/prompts/summary.md`). Use `{{summaryLanguage}}` to inject the configured language.

## API

The same port exposes a REST API for scripting or home-automation integration.

```
GET  /health                              # liveness probe
GET  /api/status                          # WhatsApp state, uptime, counters
GET  /api/qr                              # current QR code as SVG (when not linked)

GET  /api/chats                           # all detected chats + subscription state
PUT  /api/chats/:jid/subscription         # {"subscribed": true/false}

GET  /api/settings                        # current settings (tokens redacted)
PUT  /api/settings                        # update any settings field

GET  /api/prompts/summary                 # active prompt template
PUT  /api/prompts/summary                 # update prompt template
POST /api/prompts/summary/reset           # restore shipped default
POST /api/prompts/summary/prune           # delete custom override (revert to default)

GET  /api/events                          # recent event log
GET  /api/summaries                       # summary journal

POST /jobs/whatsapp-summary               # trigger digest immediately

POST /api/settings/test-llm              # test LLM connection
POST /api/settings/test-telegram         # send Telegram test message
POST /api/settings/test-whatsapp         # send WhatsApp test message

POST /api/messages/mark-unprocessed      # re-queue messages for next digest
POST /api/messages/purge                 # delete stored message logs
POST /api/summaries/purge                # delete summary journal
```

Example — subscribe a chat:

```bash
curl -X PUT \
  -H 'Content-Type: application/json' \
  -d '{"subscribed": true}' \
  http://localhost:8787/api/chats/120363421703374121%40g.us/subscription
```

Example — trigger a digest:

```bash
curl -X POST http://localhost:8787/jobs/whatsapp-summary
```

## Day-to-day

```bash
docker compose logs -f musup          # live logs
docker compose up -d --build musup    # rebuild after code changes
docker compose down                   # stop
```

## Storage layout

| Path | Contents | Retention |
|------|----------|-----------|
| `data/musup.db` | Settings, chats, subscriptions, event log | permanent |
| `data/messages/YYYY-MM-DD/HH.ndjson` | Raw message logs | 24 h |
| `data/summaries/YYYY-MM-DD.ndjson` | Summary journal | 36 h |
| `data/prompts/` | Custom prompt overrides | permanent |
| `data/auth/` | WhatsApp session credentials | permanent |

## Credits

Original idea and implementation by **Andrii Artemenko**. The cloud (GCP) version is a three-service pipeline:
[musup-collector](https://github.com/ArtemenkoAndrii/musup-collector) ·
[musup-firestore-pump](https://github.com/ArtemenkoAndrii/musup-firestore-pump) ·
[musup-processor](https://github.com/ArtemenkoAndrii/musup-processor)

This repo is a local/NAS adaptation that replaces GCP infrastructure with local files and Docker Compose.
