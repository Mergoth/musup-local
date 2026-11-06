FROM node:22-bookworm-slim

# ffmpeg converts WhatsApp voice notes (Ogg/Opus) to MP3 for transcription.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY public ./public
COPY prompts ./prompts

RUN npm run build
RUN npm prune --omit=dev

ENV NODE_ENV=production

EXPOSE 8787

CMD ["node", "dist/index.js"]
