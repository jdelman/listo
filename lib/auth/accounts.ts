import type Database from "better-sqlite3";
import { createHash, randomBytes, randomUUID, scrypt as deriveKey, timingSafeEqual } from "node:crypto";
import { openListoDatabase } from "../backend/sqlite/database";

export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const secret = () => randomBytes(32).toString("base64url");
export type User = { id: string; username: string };
export const SESSION_SECONDS = 60 * 60 * 24 * 7;

export async function hashPassword(password: string) {
  if (password.length < 10 || password.length > 256) throw new Error("Use a password between 10 and 256 characters.");
  const salt = randomBytes(16).toString("hex");
  const key = await new Promise<Buffer>((resolve, reject) => deriveKey(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
  return `scrypt:${salt}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, hash: string) {
  if (password.length > 256) return false;
  const [, salt, expected] = hash.split(":");
  // Do comparable work for unknown accounts and accounts awaiting bootstrap.
  const key = await new Promise<Buffer>((resolve, reject) => deriveKey(password, salt || "00000000000000000000000000000000", 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
  const target = expected ? Buffer.from(expected, "hex") : Buffer.alloc(64);
  return Boolean(expected) && key.length === target.length && timingSafeEqual(key, target);
}

export class Accounts {
  constructor(readonly db: Database.Database = openListoDatabase()) {}
  user(id: string): User | undefined {
    return this.db.prepare("SELECT id, username FROM users WHERE id=? AND active=1").get(id) as User | undefined;
  }
  byUsername(username: string) {
    return this.db.prepare("SELECT id, username, password_hash FROM users WHERE username=? COLLATE NOCASE AND active=1").get(username) as (User & { password_hash: string }) | undefined;
  }
  async create(username: string, password: string) {
    if (!/^[a-zA-Z0-9_-]{3,64}$/.test(username)) throw new Error("Username must contain 3–64 letters, numbers, underscores, or hyphens.");
    const id = randomUUID(), time = new Date().toISOString();
    const hash = await hashPassword(password);
    this.db.prepare("INSERT INTO users(id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, username, hash, time, time);
    return { id, username };
  }
  async bootstrap(password: string) {
    const hash = await hashPassword(password);
    return this.db.prepare("UPDATE users SET password_hash=?, updated_at=? WHERE username='jdelman' AND password_hash=''").run(hash, new Date().toISOString()).changes === 1;
  }
  throttle(key: string, limit = 10, windowMs = 15 * 60_000) {
    const now = Date.now();
    this.db.prepare("DELETE FROM auth_attempts WHERE expires_at < ?").run(now);
    const row = this.db.prepare("INSERT INTO auth_attempts(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count").get(digest(key), now + windowMs) as { count: number };
    if (row.count > limit) throw new Error("Too many attempts. Please try again later.");
  }
  async login(username: string, password: string) {
    this.throttle(`login:${username.toLowerCase()}`);
    this.throttle("login:global", 100);
    const user = this.byUsername(username);
    if (!await verifyPassword(password, user?.password_hash || "") || !user) return null;
    const token = secret();
    this.db.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(digest(token), user.id, Date.now() + SESSION_SECONDS * 1000);
    return token;
  }
  session(token?: string): User | undefined {
    if (!token) return;
    return this.db.prepare("SELECT u.id, u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1").get(digest(token), Date.now()) as User | undefined;
  }
  logout(token?: string) { if (token) this.db.prepare("DELETE FROM sessions WHERE token_hash=?").run(digest(token)); }
  revokeAll(userId: string) {
    this.db.prepare("DELETE FROM sessions WHERE user_id=?").run(userId);
    this.db.prepare("DELETE FROM password_resets WHERE user_id=?").run(userId);
    this.db.prepare("DELETE FROM oauth_codes WHERE user_id=?").run(userId);
    this.db.prepare("UPDATE oauth_grants SET revoked=1 WHERE user_id=?").run(userId);
  }
  async changePassword(userId: string, current: string, password: string) {
    this.throttle(`password:${userId}`);
    const row = this.db.prepare("SELECT password_hash FROM users WHERE id=? AND active=1").get(userId) as { password_hash: string } | undefined;
    if (!row || !await verifyPassword(current, row.password_hash)) throw new Error("Current password is incorrect.");
    const hash = await hashPassword(password);
    this.db.transaction(() => {
      const changed = this.db.prepare("UPDATE users SET password_hash=?, updated_at=? WHERE id=? AND password_hash=? AND active=1").run(hash, new Date().toISOString(), userId, row.password_hash);
      if (!changed.changes) throw new Error("Account changed. Please sign in again.");
      this.revokeAll(userId);
    })();
  }
  resetLink(username: string) {
    const user = this.byUsername(username);
    if (!user) throw new Error("Account not found");
    const token = secret();
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM password_resets WHERE user_id=?").run(user.id);
      this.db.prepare("INSERT INTO password_resets VALUES (?, ?, ?)").run(digest(token), user.id, Date.now() + 30 * 60_000);
    })();
    return token;
  }
  async resetPassword(token: string, password: string) {
    this.throttle("reset:global", 50);
    const hash = await hashPassword(password);
    this.db.transaction(() => {
      const row = this.db.prepare("DELETE FROM password_resets WHERE token_hash=? AND expires_at>? RETURNING user_id").get(digest(token), Date.now()) as { user_id: string } | undefined;
      if (!row || !this.user(row.user_id)) throw new Error("This recovery link is invalid or expired.");
      this.db.prepare("UPDATE users SET password_hash=?, updated_at=? WHERE id=?").run(hash, new Date().toISOString(), row.user_id);
      this.revokeAll(row.user_id);
    }).immediate();
  }
}
