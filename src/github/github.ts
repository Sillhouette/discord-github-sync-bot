import express, { Request, Response, NextFunction } from "express";
import { GithubHandlerFunction } from "../interfaces";
import { config } from "../config";
import { verifySignature } from "./webhookSignature";
import {
  handleClosed,
  handleCreated,
  handleEdited,
  handleOpened,
  handleReopened,
  handleLocked,
  handleUnlocked,
  handleDeleted,
} from "./githubHandlers";

// Note: express.json() is NOT applied globally — the POST / route uses
// express.raw() so that the raw request bytes are available for HMAC
// signature verification before parsing. See webhookSignature.ts.
const app = express();

const githubActions: { [key: string]: GithubHandlerFunction } = {
  opened: (req) => handleOpened(req),
  created: (req) => handleCreated(req),
  edited: (req) => handleEdited(req),
  closed: (req) => handleClosed(req),
  reopened: (req) => handleReopened(req),
  locked: (req) => handleLocked(req),
  unlocked: (req) => handleUnlocked(req),
  deleted: (req) => handleDeleted(req),
};

app.get("/", (_, res) => {
  res.json({ msg: "github webhooks work" });
});

app.get("/health", (_, res) => {
  res.json({ status: "ok" });
});

// Signature verification middleware for the webhook endpoint.
// express.raw() captures the raw body buffer required for HMAC computation.
// If GITHUB_WEBHOOK_SECRET is not set, verification is skipped (development mode).
function webhookSignatureMiddleware(req: Request, res: Response, next: NextFunction): void {
  const sig = req.headers["x-hub-signature-256"] as string | undefined;
  const secret = config.GITHUB_WEBHOOK_SECRET;

  if (secret) {
    if (!sig || !verifySignature(secret, (req.body as Buffer).toString(), sig)) {
      res.status(403).json({ error: "Invalid or missing webhook signature" });
      return;
    }
  }

  next();
}

app.post(
  "/",
  express.raw({ type: "application/json" }),
  webhookSignatureMiddleware,
  async (req, res) => {
    // Parse the raw body buffer into JSON after signature verification passes.
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse((req.body as Buffer).toString()) as Record<string, unknown>;
    } catch {
      res.status(400).json({ error: "Invalid JSON" });
      return;
    }
    const githubAction = githubActions[payload.action as string];
    if (githubAction) {
      // Attach the parsed body back onto req for handler compatibility.
      req.body = payload;
      githubAction(req);
    }
    res.json({ msg: "ok" });
  },
);

/** Starts the HTTP server. Call once at application startup. */
export function initGithub() {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

export default app;
