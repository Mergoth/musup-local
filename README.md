# musup-local

<p align="center">
  <a href="https://ko-fi.com/Mergoth">
    <img src="https://img.shields.io/badge/☕ Buy me a coffee-%23FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white" alt="Ko-fi"/>
  </a>
</p>

WhatsApp group monitor — captures messages, sends AI summaries to Telegram on a schedule. Runs entirely on a local NAS via Docker Compose.

## Setup

**1. Secrets**
```bash
cp .env.example .env
# fill in: LLM_API_KEY, LLM_API_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID_1
```

**2. Groups & schedule** — edit `.env` or `processor/src/main/resources/application.yml`:
```
MUSUP_CHAT_JIDS=120363421703374121@g.us,…
MUSUP_CHAT_LABELS_CSV=120363421703374121@g.us=Family
MUSUP_DIGEST_CRON=0 0 6,19 * * ?   # UTC
MUSUP_DIGEST_WINDOW_HOURS=13
```
> To find a group JID: start the collector, send a message, check `data/chats.json`.

**3. Build & start** *(requires JDK 22+)*
```bash
cd processor && ./gradlew installDist && cd ..
docker compose build && docker compose up -d
```

**4. Link WhatsApp**
```bash
docker compose logs -f collector   # scan the QR in WhatsApp → Linked Devices
```

## Deploy to NAS

```bash
cp deploy.local.sh.example deploy.local.sh
# fill in NAS_USER, NAS_HOST, NAS_PORT, NAS_DIR, REMOTE_DOCKER

bash deploy.sh processor   # or: all | collector
```

## Day-to-day

```bash
# Trigger digest immediately
curl -X POST http://localhost:8080/jobs/whatsapp-summary

# Rebuild after code changes
cd processor && ./gradlew installDist && cd ..
docker compose up -d --build processor
```

## Credits

Original idea and implementation by **Andrii Artemenko**. The cloud (GCP) version of this system consists of 3 services:
- [musup-collector](https://github.com/ArtemenkoAndrii/musup-collector) - reads from WhatsApp on behalf of user
- [musup-firestore-pump](https://github.com/ArtemenkoAndrii/musup-firestore-pump) — Pub/Sub → Firestore
- [musup-processor](https://github.com/ArtemenkoAndrii/musup-processor) — reads Firestore (last 24 h), summarises with LLM, sends to Telegram

This repo is a local/NAS adaptation that replaces GCP infrastructure with local files and Docker Compose.
