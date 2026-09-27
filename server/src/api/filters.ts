import { Router } from "express";
import { z } from "zod";
import { requireSession } from "../auth/middleware.js";
import {
  listMutedKeywords,
  addMutedKeyword,
  removeMutedKeyword,
} from "../feeds/repository.js";

export const filtersRouter = Router();
filtersRouter.use(requireSession);

filtersRouter.get("/muted", (req, res) => {
  const keywords = listMutedKeywords(req.user!.id);
  res.json({ keywords });
});

const addKeywordSchema = z.object({
  keyword: z.string().trim().min(1).max(100),
});

filtersRouter.post("/muted", (req, res) => {
  const parsed = addKeywordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }
  const created = addMutedKeyword(req.user!.id, parsed.data.keyword);
  res.status(201).json(created);
});

filtersRouter.delete("/muted/:id", (req, res) => {
  const keywordId = Number(req.params.id);
  if (isNaN(keywordId)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  removeMutedKeyword(req.user!.id, keywordId);
  res.status(204).end();
});
