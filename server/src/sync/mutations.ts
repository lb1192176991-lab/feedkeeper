import { z } from "zod";
import { db } from "../db/index.js";
import { pruneArchive, scheduleArchive } from "../feeds/archive.js";
import {
  bookmarkItem,
  canAccessItem,
  deleteItemNote,
  markItemRead,
  markItemUnread,
  setItemNote,
  unbookmarkItem,
} from "../feeds/repository.js";

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_AGE_MS = 30 * 86_400_000;
// "Not started" and "finished" are covered by the read state, so such positions are not stored.
const MIN_PROGRESS = 0.05;
const MAX_PROGRESS = 0.95;

const base = {
  id: z.string().min(8).max(64),
  at: z.string().datetime({ offset: true }),
  itemId: z.number().int().positive(),
};

export const mutationSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("item.read"), value: z.boolean() }),
  z.object({ ...base, type: z.literal("item.save"), value: z.boolean() }),
  z.object({ ...base, type: z.literal("item.progress"), position: z.number().min(0).max(1) }),
  z.object({
    ...base,
    type: z.literal("item.note.set"),
    content: z.string().max(100_000),
    expectedRevision: z.number().int().nonnegative().optional(),
  }),
  z.object({
    ...base,
    type: z.literal("item.note.delete"),
  }),
]);

export type Mutation = z.infer<typeof mutationSchema>;
export type MutationOutcome = "applied" | "duplicate" | "stale" | "rejected" | "conflict";
export interface MutationResult {
  id: string;
  outcome: MutationOutcome;
  error?: string;
  current?: {
    itemId: number;
    content: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
  };
}

type Field = "read_at" | "saved_at" | "progress_at";
const FIELD: Partial<Record<Mutation["type"], Field>> = {
  "item.read": "read_at",
  "item.save": "saved_at",
  "item.progress": "progress_at",
};

/** The time of the change, kept inside a sane window around the server's own clock. */
function effectiveTime(at: string): string | null {
  const time = new Date(at).getTime();
  const now = Date.now();
  if (Number.isNaN(time) || time < now - MAX_AGE_MS) return null;
  return new Date(Math.min(time, now + MAX_CLOCK_SKEW_MS)).toISOString();
}

function lastChange(userId: number, itemId: number, field: Field): string | null {
  return db
    .prepare<[number, number], Record<Field, string | null>>(`SELECT ${field} FROM changes WHERE user_id = ? AND entity = 'item_state' AND entity_id = ?`)
    .get(userId, itemId)?.[field] ?? null;
}

/** Record when a field was last set without moving the object forward in the log. */
function stampField(userId: number, itemId: number, field: Field, at: string): void {
  const updated = db.prepare(`UPDATE changes SET ${field} = ? WHERE user_id = ? AND entity = 'item_state' AND entity_id = ?`).run(at, userId, itemId).changes;
  if (updated) return;
  db.prepare(
    `INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at, ${field})
     VALUES (?, 'item_state', ?, 'upsert', (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = ?), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?)`,
  ).run(userId, itemId, userId, at);
}

function apply(userId: number, mutation: Mutation, at: string): void {
  switch (mutation.type) {
    case "item.read":
      if (mutation.value) markItemRead(userId, mutation.itemId);
      else markItemUnread(userId, mutation.itemId);
      break;
    case "item.save":
      if (mutation.value) {
        if (bookmarkItem(userId, mutation.itemId) > 0) scheduleArchive(mutation.itemId);
      } else if (unbookmarkItem(userId, mutation.itemId) > 0) {
        pruneArchive();
      }
      break;
    case "item.progress":
      if (mutation.position < MIN_PROGRESS || mutation.position > MAX_PROGRESS) {
        db.prepare("DELETE FROM item_progress WHERE user_id = ? AND item_id = ?").run(userId, mutation.itemId);
      } else {
        db.prepare(
          `INSERT INTO item_progress (user_id, item_id, position, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (user_id, item_id) DO UPDATE SET position = excluded.position, updated_at = excluded.updated_at`,
        ).run(userId, mutation.itemId, mutation.position, at);
      }
      break;
    case "item.note.set":
    case "item.note.delete":
      break;
  }
}

/**
 * Apply changes a device made offline. Each has a client-made id, so replaying a batch changes
 * nothing; an older change never overrides a newer one of the same field, whatever device it came from.
 */
export function applyMutations(userId: number, raw: unknown[]): MutationResult[] {
  return raw.map((entry): MutationResult => {
    const parsed = mutationSchema.safeParse(entry);
    const id = typeof (entry as { id?: unknown })?.id === "string" ? (entry as { id: string }).id : "";
    if (!parsed.success) return { id, outcome: "rejected", error: "invalid_mutation" };
    const mutation = parsed.data;

    const known = db
      .prepare<[number, string], { outcome: string; error: string | null }>("SELECT outcome, error FROM applied_mutations WHERE user_id = ? AND mutation_id = ?")
      .get(userId, mutation.id);
    if (known) return { id: mutation.id, outcome: "duplicate" };

    const finish = (
      outcome: MutationOutcome,
      error?: string,
      current?: MutationResult["current"],
    ): MutationResult => {
      db.prepare("INSERT INTO applied_mutations (user_id, mutation_id, outcome, error) VALUES (?, ?, ?, ?)").run(userId, mutation.id, outcome, error ?? null);
      return { id: mutation.id, outcome, ...(error ? { error } : {}), ...(current ? { current } : {}) };
    };

    return db.transaction((): MutationResult => {
      const at = effectiveTime(mutation.at);
      if (!at) return finish("rejected", "invalid_time");
      if (!canAccessItem(userId, mutation.itemId)) return finish("rejected", "item_not_found");

      if (mutation.type === "item.note.set") {
        const result = setItemNote(userId, mutation.itemId, mutation.content, mutation.expectedRevision);
        if ("conflict" in result) {
          const c = result.conflict;
          return finish("conflict", "revision_conflict", {
            itemId: c.item_id,
            content: c.content,
            revision: c.revision,
            createdAt: c.created_at,
            updatedAt: c.updated_at,
          });
        }
        return finish("applied");
      }

      if (mutation.type === "item.note.delete") {
        deleteItemNote(userId, mutation.itemId);
        return finish("applied");
      }

      const field = FIELD[mutation.type]!;
      const last = lastChange(userId, mutation.itemId, field);
      if (last && last > at) return finish("stale");

      apply(userId, mutation, at);
      stampField(userId, mutation.itemId, field, at);
      return finish("applied");
    })();
  });
}
