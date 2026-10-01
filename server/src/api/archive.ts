import { Router } from "express";
import { requireSession } from "../auth/middleware.js";
import { findArchivedImage } from "../feeds/archive.js";

export const archiveRouter = Router();
archiveRouter.use(requireSession);

archiveRouter.get("/images/:imageId", (req, res) => {
  const image = findArchivedImage(req.user!.id, Number(req.params.imageId));
  if (!image) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  // Archived files never change; the URL is tied to one stored copy.
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.type(image.mime).sendFile(image.path, (error) => {
    if (error && !res.headersSent) res.status(404).json({ error: "not_found" });
  });
});
