import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import fs from "fs";
import crypto from "crypto";
import { config } from "../config.js";
import { appendMessage, registerChatName } from "../store.js";
import { appLogger } from "../appLogger.js";
import type { NormalizedMessage } from "../normalize.js";

type ClassroomState = Record<string, string>; // courseId → ISO timestamp of last poll

interface CredentialsFile {
  installed?: { client_id: string; client_secret: string; redirect_uris: string[] };
  web?: { client_id: string; client_secret: string; redirect_uris: string[] };
}

function loadAuth(): OAuth2Client | null {
  const { credentialsPath, tokenPath } = config.classroom;
  if (!credentialsPath || !fs.existsSync(credentialsPath)) return null;
  if (!fs.existsSync(tokenPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(credentialsPath, "utf-8")) as CredentialsFile;
    const creds = raw.installed ?? raw.web;
    if (!creds) throw new Error("Invalid credentials.json format");

    const client = new google.auth.OAuth2(
      creds.client_id,
      creds.client_secret,
      creds.redirect_uris[0]
    );

    const token = JSON.parse(fs.readFileSync(tokenPath, "utf-8"));
    client.setCredentials(token);

    // Persist refreshed tokens automatically
    client.on("tokens", (tokens) => {
      const current = JSON.parse(fs.readFileSync(tokenPath, "utf-8"));
      fs.writeFileSync(tokenPath, JSON.stringify({ ...current, ...tokens }, null, 2));
    });

    return client;
  } catch (err) {
    appLogger.warn("Google Classroom: failed to load auth", { err });
    return null;
  }
}

function stableId(...parts: string[]): string {
  return crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 20);
}

function loadState(): ClassroomState {
  try {
    return JSON.parse(fs.readFileSync(config.classroom.statePath, "utf-8")) as ClassroomState;
  } catch {
    return {};
  }
}

function saveState(state: ClassroomState): void {
  fs.writeFileSync(config.classroom.statePath, JSON.stringify(state, null, 2));
}

function toUnixSeconds(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

async function pollClassroom(auth: OAuth2Client): Promise<void> {
  const classroom = google.classroom({ version: "v1", auth });
  const state = loadState();
  const nextState: ClassroomState = { ...state };
  const now = new Date().toISOString();

  const coursesRes = await classroom.courses.list({ courseStates: ["ACTIVE"] });
  const courses = coursesRes.data.courses ?? [];

  for (const course of courses) {
    const courseId = course.id!;
    const courseName = course.name ?? courseId;
    const chatJid = `classroom:${courseId}`;
    const since = state[courseId] ?? new Date(Date.now() - config.classroom.initialWindowMs).toISOString();

    registerChatName(chatJid, courseName);
    nextState[courseId] = now;

    // Announcements
    try {
      const annRes = await classroom.courses.announcements.list({
        courseId,
        orderBy: "updateTime desc",
        pageSize: 50,
      });
      for (const ann of annRes.data.announcements ?? []) {
        const updateTime = ann.updateTime ?? ann.creationTime;
        if (!updateTime || updateTime <= since) continue;
        const msg: NormalizedMessage = {
          messageId: stableId("ann", courseId, ann.id!),
          chatJid,
          senderJid: ann.creatorUserId ?? undefined,
          fromMe: false,
          timestamp: toUnixSeconds(updateTime),
          messageType: "classroomAnnouncement",
          text: ann.text ?? undefined,
        };
        if (msg.text) appendMessage(msg, courseName);
      }
    } catch (err) {
      appLogger.warn("Classroom: failed to fetch announcements", { courseId, err });
    }

    // Coursework (assignments)
    try {
      const cwRes = await classroom.courses.courseWork.list({
        courseId,
        orderBy: "updateTime desc",
        pageSize: 50,
      });
      for (const cw of cwRes.data.courseWork ?? []) {
        const updateTime = cw.updateTime ?? cw.creationTime;
        if (!updateTime || updateTime <= since) continue;
        const parts = [cw.title, cw.description].filter(Boolean);
        const text = parts.join(": ");
        const msg: NormalizedMessage = {
          messageId: stableId("cw", courseId, cw.id!),
          chatJid,
          senderJid: cw.creatorUserId ?? undefined,
          fromMe: false,
          timestamp: toUnixSeconds(updateTime),
          messageType: "classroomCoursework",
          text: text || undefined,
        };
        if (msg.text) appendMessage(msg, courseName);
      }
    } catch (err) {
      appLogger.warn("Classroom: failed to fetch coursework", { courseId, err });
    }
  }

  saveState(nextState);
  appLogger.info("Classroom poll complete", { coursesChecked: courses.length });
}

export function startClassroomPoller(): void {
  const auth = loadAuth();
  if (!auth) {
    appLogger.info(
      "Google Classroom not configured — run auth-classroom script first, then set CLASSROOM_CREDENTIALS_PATH"
    );
    return;
  }

  const intervalMs = config.classroom.pollIntervalMinutes * 60 * 1000;

  async function poll() {
    try {
      await pollClassroom(auth!);
    } catch (err) {
      appLogger.error("Classroom poll error", err);
    }
  }

  poll();
  setInterval(poll, intervalMs);
  appLogger.info("Google Classroom poller started", {
    intervalMinutes: config.classroom.pollIntervalMinutes,
  });
}
