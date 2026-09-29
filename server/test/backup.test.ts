import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import Database from "better-sqlite3";

test("backup includes uncheckpointed WAL changes and restore recovers them", () => {
  const directory = mkdtempSync(join(tmpdir(), "feedkeeper-backup-test-"));
  const databasePath = join(directory, "live.sqlite");
  const backupPath = join(directory, "backup.sqlite");
  const serverRoot = resolve(import.meta.dirname, "..");
  const environment = {
    ...process.env,
    DATABASE_PATH: databasePath,
    SESSION_SECRET: "test-session-secret-at-least-32-characters",
  };
  const runCli = (action: string, args: string[]) => {
    const result = spawnSync("tsx", ["src/backup-cli.ts", action, ...args], {
      cwd: serverRoot,
      env: environment,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };

  try {
    const live = new Database(databasePath);
    try {
      live.pragma("journal_mode = WAL");
      live.pragma("wal_autocheckpoint = 0");
      live.exec("CREATE TABLE sample (value TEXT)");
      live.prepare("INSERT INTO sample (value) VALUES (?)").run("in WAL");
      runCli("backup", [backupPath]);

      const backup = new Database(backupPath, { readonly: true });
      try {
        assert.equal(backup.prepare("SELECT value FROM sample").get()?.value, "in WAL");
      } finally {
        backup.close();
      }
      live.exec("DELETE FROM sample");
    } finally {
      live.close();
    }

    runCli("restore", [backupPath, "--force"]);
    const restored = new Database(databasePath, { readonly: true });
    try {
      assert.equal(restored.prepare("SELECT value FROM sample").get()?.value, "in WAL");
    } finally {
      restored.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
