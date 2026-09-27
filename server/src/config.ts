import { config as loadEnv } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Loads the repo-root .env regardless of the process's current working
// directory, so `npm run dev`/`start` behave the same from anywhere.
// `quiet: true` suppresses dotenv's own console output (including its
// unrelated third-party promo "tips"), which has no place in server logs.
loadEnv({ path: join(__dirname, "../../.env"), quiet: true });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  publicUrl: required("PUBLIC_URL", "http://localhost:3000"),
  databasePath: required("DATABASE_PATH", "./data/feedkeeper.sqlite"),
  sessionSecret: required("SESSION_SECRET"),
  allowSignup: process.env.ALLOW_SIGNUP === "true",
  trustProxy: process.env.TRUST_PROXY === "true",
  minPollIntervalMinutes: Number(process.env.MIN_POLL_INTERVAL_MINUTES ?? 5),
  retentionReadDays: Number(process.env.RETENTION_READ_DAYS ?? 30),
  retentionMaxDays: Number(process.env.RETENTION_MAX_DAYS ?? 90),
  retentionMaxItemsPerFeed: Number(process.env.RETENTION_MAX_ITEMS_PER_FEED ?? 1000),
  autoCleanupEnabled: process.env.AUTO_CLEANUP_ENABLED !== "false",
};
