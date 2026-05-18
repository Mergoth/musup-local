/**
 * One-time Google Classroom OAuth2 setup.
 *
 * Run ONCE locally (not in Docker) to obtain and save the OAuth token:
 *
 *   npx tsx src/auth-classroom.ts
 *
 * Prerequisites:
 *   1. Go to https://console.cloud.google.com and create a project
 *   2. Enable the Google Classroom API
 *   3. Create OAuth 2.0 credentials → Desktop app → download JSON
 *   4. Save it as data/auth/classroom-credentials.json
 *      (or set CLASSROOM_CREDENTIALS_PATH to its location)
 *
 * After running this script, classroom-token.json will be saved next to the
 * credentials file. Copy both files to data/auth/ on the NAS before starting
 * Docker — the collector container reads them from /data/auth/.
 */

import { google } from "googleapis";
import fs from "fs";
import path from "path";
import readline from "readline";
import dotenv from "dotenv";

dotenv.config();

const dataDir = process.env.DATA_DIR ?? "./data";
const credentialsPath =
  process.env.CLASSROOM_CREDENTIALS_PATH ??
  path.join(dataDir, "auth", "classroom-credentials.json");
const tokenPath =
  process.env.CLASSROOM_TOKEN_PATH ??
  path.join(dataDir, "auth", "classroom-token.json");

const SCOPES = [
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.announcements.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.students.readonly",
  "https://www.googleapis.com/auth/classroom.student-submissions.students.readonly",
];

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  if (!fs.existsSync(credentialsPath)) {
    console.error(`credentials.json not found at: ${credentialsPath}`);
    console.error("Download it from Google Cloud Console → APIs & Services → Credentials");
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(credentialsPath, "utf-8"));
  const creds = raw.installed ?? raw.web;
  if (!creds) {
    console.error("Invalid credentials.json — expected 'installed' or 'web' key");
    process.exit(1);
  }

  const client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    creds.redirect_uris[0]
  );

  const authUrl = client.generateAuthUrl({ access_type: "offline", scope: SCOPES });

  console.log("\nOpen this URL in your browser and authorize the app:\n");
  console.log(authUrl);
  console.log();

  const code = await prompt("Paste the authorization code here: ");
  const { tokens } = await client.getToken(code);

  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));

  console.log(`\nToken saved to: ${tokenPath}`);
  console.log("Copy it to data/auth/classroom-token.json on your NAS before starting Docker.");
}

main().catch((err) => {
  console.error("Auth failed:", err);
  process.exit(1);
});
