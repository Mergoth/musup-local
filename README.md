<h1 align="center">musup</h1>

<p align="center">
  <b>Your noisy WhatsApp groups, summarised by AI — delivered to Telegram or WhatsApp.</b><br/>
  Self-hosted. One container. Runs on your NAS, a home server, or a free cloud VM.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white" alt="Docker"/>
  <img src="https://img.shields.io/badge/LLM-OpenAI--compatible-412991" alt="OpenAI-compatible"/>
  <a href="https://ko-fi.com/Mergoth"><img src="https://img.shields.io/badge/Ko--fi-support-FF5E5B?logo=ko-fi&logoColor=white" alt="Ko-fi"/></a>
</p>

---

## Why

School chats, house committees, family groups — hundreds of messages a day, three of which matter. **musup** links to your WhatsApp as a device, quietly reads the chats you pick, and sends you a short digest on your schedule.

```
WhatsApp chats ──▶ musup (NAS / server / cloud VM) ──▶ LLM ──▶ Telegram / WhatsApp digest
```

- 🔒 **Private** — messages stay on a host you control; only the digest prompt goes to the LLM you choose
- ☁️ **Runs anywhere** — anything with Docker: Synology/QNAP, a Raspberry Pi, Oracle Cloud Always Free, any VPS
- 🧠 **Any LLM** — OpenAI, Gemini, Ollama, or anything OpenAI-compatible
- 🌍 **Any language** — summaries in your language, whatever the chat speaks
- 🖥️ **Web UI** — link, pick chats, schedule, edit the prompt; no config files

## Install

```bash
git clone https://github.com/Mergoth/musup-local.git musup && cd musup
docker compose up -d --build
```

Open **http://localhost:8787** and set an admin password. Data lives in `./data`; change the volume in `compose.yml` to move it, e.g. on a NAS.

The same works on any cloud VM or VPS with Docker. For Oracle Cloud there's a ready-made script:

<details open>
<summary><b>Deploy to an Oracle Cloud Always Free VM</b></summary>

```bash
cp scripts/oracle/deploy.local.sh.example scripts/oracle/deploy.local.sh   # host, user, SSH key
scripts/oracle/deploy.sh setup    # once: Docker + swap
scripts/oracle/deploy.sh          # build, ship, restart
scripts/oracle/deploy.sh tunnel   # UI at http://localhost:8787 via SSH
```

</details>

## Use

1. **Whatsapp** → scan the QR in WhatsApp → *Linked Devices*, then subscribe the chats you care about.
2. **Config** → LLM endpoint + API key and summary language.
3. **Config** → digest times, e.g. `08:00`, `21:00` (local time).
4. **Config** → Telegram bot token + chat IDs, and/or a WhatsApp delivery chat.
5. **Config** → enable summarisation. Done — digests land in **Summaries** too.

Need one now? **Monitor → Test trigger**, or `POST /jobs/whatsapp-summary`.

<details>
<summary><b>REST API</b></summary>

All routes except `/health` and `/api/auth/*` need the `musup_session` cookie.

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/auth/login` | Log in, set cookie |
| `GET` | `/api/status` | WhatsApp state, counters |
| `GET` / `PUT` | `/api/chats`, `/api/chats/:jid/subscription` | List / subscribe chats |
| `POST` | `/api/chats/:jid/backfill` | Best-effort history backfill |
| `GET` / `PUT` | `/api/settings` | Read / update settings |
| `GET` / `PUT` | `/api/prompts/summary` | Prompt template |
| `GET` | `/api/summaries`, `/api/events` | Summary journal, event log |
| `POST` | `/jobs/whatsapp-summary` | Trigger a digest |

```bash
curl -c jar -H 'Content-Type: application/json' -d '{"password":"…"}' http://localhost:8787/api/auth/login
curl -b jar -X POST http://localhost:8787/jobs/whatsapp-summary
```

</details>

<details>
<summary><b>Storage</b></summary>

| Path | Contents | Kept |
|---|---|---|
| `data/musup.db` | Settings, chats, events | forever |
| `data/messages/` | Raw messages (NDJSON) | 24 h after summary, 7 d otherwise |
| `data/summaries/` | Digest journal | 36 h |
| `data/prompts/` | Custom prompt | forever |
| `data/auth/` | WhatsApp session | until logout |

</details>

## Credits

Original idea and GCP implementation by **[Andrii Artemenko](https://github.com/ArtemenkoAndrii)** — [collector](https://github.com/ArtemenkoAndrii/musup-collector) · [firestore-pump](https://github.com/ArtemenkoAndrii/musup-firestore-pump) · [processor](https://github.com/ArtemenkoAndrii/musup-processor).

**Maintainers:** [Oleksandr Nogai](https://github.com/onogai) · [Vlad](https://github.com/Mergoth)
