import { Router } from "express";
import { onboardingRouter } from "./onboarding.js";
import { authRouter } from "./auth.js";
import { feedsRouter } from "./feeds.js";
import { itemsRouter } from "./items.js";
import { tokensRouter } from "./tokens.js";
import { systemRouter } from "./system.js";
import { filtersRouter } from "./filters.js";
import { foldersRouter } from "./folders.js";
import { archiveRouter } from "./archive.js";
import { pushRouter } from "./push.js";

import { config } from "../config.js";

export const apiRouter = Router();

apiRouter.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

apiRouter.get("/config", (_req, res) => {
  res.json({
    showGithubLink: config.showGithubLink,
    githubUrl: config.githubUrl,
  });
});

apiRouter.use("/onboarding", onboardingRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/feeds", feedsRouter);
apiRouter.use("/items", itemsRouter);
apiRouter.use("/tokens", tokensRouter);
apiRouter.use("/system", systemRouter);
apiRouter.use("/filters", filtersRouter);
apiRouter.use("/folders", foldersRouter);
apiRouter.use("/archive", archiveRouter);
apiRouter.use("/push", pushRouter);
