import { z } from "zod";
import { db } from "../db/index.js";
import { NativeError, nativeRequest } from "./requests.js";

export const folderId = z.number().int().positive();
const distinctIds = z.array(folderId).max(1000).refine((ids) => new Set(ids).size === ids.length, "IDs must be unique");
const timezone = z.string().max(100).refine((value) => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}, "Use an IANA time zone");

export const preferenceFields = {
  timeZone: timezone,
  editionSize: z.number().int().min(1).max(24),
  readingMinutes: z.number().int().min(5).max(180).nullable(),
  folderOrder: z.array(folderId.nullable()).max(1001).refine((ids) => new Set(ids).size === ids.length, "IDs must be unique"),
  hiddenFolderIds: distinctIds,
  preferredFolderIds: distinctIds,
  showUnfiled: z.boolean(),
};
export const preferencePatchSchema = z.object(preferenceFields).partial().extend({
  requestId: z.uuid(),
  expectedRevision: z.number().int().min(0),
}).strict();

export interface NativeSettings {
  timeZone: string;
  editionSize: number;
  readingMinutes: number | null;
  folderOrder: (number | null)[];
  hiddenFolderIds: number[];
  preferredFolderIds: number[];
  showUnfiled: boolean;
}
export interface NativePreferences extends NativeSettings {
  revision: number;
  updatedAt: string | null;
}
const defaults: NativeSettings = {
  timeZone: "UTC", editionSize: 24, readingMinutes: null,
  folderOrder: [], hiddenFolderIds: [], preferredFolderIds: [], showUnfiled: true,
};

export function getNativePreferences(userId: number): NativePreferences {
  const row = db.prepare<[number], { revision: number; settings: string; updated_at: string }>(
    "SELECT revision, settings, updated_at FROM native_preferences WHERE user_id = ?",
  ).get(userId);
  return { ...defaults, ...(row ? JSON.parse(row.settings) : {}), revision: row?.revision ?? 0, updatedAt: row?.updated_at ?? null };
}

export function patchNativePreferences(userId: number, input: { requestId: string; expectedRevision: number } & Partial<NativeSettings>): NativePreferences {
  const parsed = preferencePatchSchema.safeParse(input);
  if (!parsed.success) throw new NativeError("invalid_input");
  const { requestId, expectedRevision, ...patch } = parsed.data as typeof input;
  return nativeRequest(userId, requestId, "preferences.patch", { expectedRevision, ...patch }, () => {
    const current = getNativePreferences(userId);
    if (current.revision !== expectedRevision) throw new NativeError("revision_conflict", 409, current);
    const ownedIds = new Set(db.prepare<[number], { id: number }>("SELECT id FROM folders WHERE user_id = ?").all(userId).map((f) => f.id));
    for (const ids of [patch.folderOrder, patch.hiddenFolderIds, patch.preferredFolderIds]) {
      if (ids?.some((id) => id !== null && !ownedIds.has(id))) throw new NativeError("folder_not_found", 404);
    }
    const { revision, updatedAt: _updatedAt, ...settings } = current;
    const next = { ...settings, ...patch };
    // The first write records ownership of defaults, allowing a one-time local migration.
    if (revision > 0 && JSON.stringify(settings) === JSON.stringify(next)) return current;
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO native_preferences (user_id, revision, settings, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET revision = excluded.revision, settings = excluded.settings, updated_at = excluded.updated_at`)
      .run(userId, revision + 1, JSON.stringify(next), now);
    return getNativePreferences(userId);
  });
}
