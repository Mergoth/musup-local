import crypto from "crypto";
import { promisify } from "util";
import {
  createAuthSession,
  deleteAuthSession,
  deleteExpiredAuthSessions,
  getAuthSession,
} from "./db/database.js";

const scryptAsync = promisify(crypto.scrypt);
export const AUTH_COOKIE_NAME = "musup_session";
const SESSION_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("base64url");
  const key = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;

  const [, salt, encodedKey] = parts;
  const expected = Buffer.from(encodedKey, "base64url");
  const actual = (await scryptAsync(password, salt, expected.length)) as Buffer;
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function createSessionToken(): { token: string; expiresAt: string } {
  deleteExpiredAuthSessions();
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  createAuthSession(tokenHash, expiresAt);
  return { token, expiresAt };
}

export function getSessionCookie(token: string, expiresAt: string): string {
  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  return `${AUTH_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function getClearSessionCookie(): string {
  return `${AUTH_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export function getCookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) return rawValue.join("=");
  }
  return undefined;
}

export function isValidSessionToken(token: string | undefined): boolean {
  if (!token) return false;
  deleteExpiredAuthSessions();
  const session = getAuthSession(hashSessionToken(token));
  if (!session) return false;
  return new Date(session.expiresAt).getTime() > Date.now();
}

export function deleteSessionToken(token: string | undefined): void {
  if (!token) return;
  deleteAuthSession(hashSessionToken(token));
}

function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("base64url");
}
