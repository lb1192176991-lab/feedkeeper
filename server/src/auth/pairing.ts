import { createHash, randomBytes } from "node:crypto";
import { db } from "../db/index.js";
import { createPersonalAccessToken } from "./tokens.js";

const CODE_TTL_MS = 10 * 60 * 1000;
// Without 0, O, 1, I and L, so a code can be read out or typed by hand.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 12;

function normalize(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function hashCode(code: string): string {
  return createHash("sha256").update(normalize(code)).digest("hex");
}

/** A fresh single-use code for the user (about 60 bits); it replaces any code they still had. */
export function createPairingCode(userId: number): { code: string; expiresAt: string } {
  const bytes = randomBytes(CODE_LENGTH);
  const raw = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
  const code = raw.match(/.{4}/g)!.join("-");
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  db.prepare(
    `INSERT INTO pairing_codes (user_id, code_hash, expires_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  ).run(userId, hashCode(code), expiresAt);
  return { code, expiresAt };
}

/** Exchange a valid code for a device token. A code works once; expired and unknown codes give null. */
export function redeemPairingCode(
  code: string,
  device: { name: string; platform: string; appVersion: string | null },
): { userId: number; deviceId: number; token: string } | null {
  return db.transaction(() => {
    db.prepare("DELETE FROM pairing_codes WHERE expires_at <= ?").run(new Date().toISOString());
    const row = db.prepare<[string], { user_id: number }>("SELECT user_id FROM pairing_codes WHERE code_hash = ?").get(hashCode(code));
    if (!row) return null;
    db.prepare("DELETE FROM pairing_codes WHERE user_id = ?").run(row.user_id);
    const { id, token } = createPersonalAccessToken(row.user_id, device.name, "write", { platform: device.platform, appVersion: device.appVersion });
    return { userId: row.user_id, deviceId: id, token };
  })();
}
