import { Router } from "express";
import { requireSession } from "../auth/middleware.js";
import { deleteGrant, listGrantsForUser } from "../oauth/store.js";

/** Apps (ChatGPT, Claude, ...) that signed in through OAuth; the owner can disconnect them. */
export const oauthGrantsRouter = Router();
oauthGrantsRouter.use(requireSession);

oauthGrantsRouter.get("/", (req, res) => {
  res.json(listGrantsForUser(req.user!.id));
});

oauthGrantsRouter.delete("/:grantId", (req, res) => {
  deleteGrant(req.user!.id, Number(req.params.grantId));
  res.status(204).end();
});
