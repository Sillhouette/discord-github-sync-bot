import { describe, it, expect, vi } from "vitest";
import { createHmac } from "crypto";
import request from "supertest";

// ac_id: AC-1, AC-2
// Integration tests for the webhook Express middleware chain.
// These tests verify that the raw body capture → HMAC check → JSON parse pipeline
// behaves correctly end-to-end. Unit tests for verifySignature in isolation live
// in webhookSignature.test.ts.

// Hardcoded here (not a const) because vi.mock factories are hoisted before
// variable declarations — referencing a const from outside the factory throws.
const TEST_SECRET = "test-webhook-secret-integration";

vi.mock("../config", () => ({
  config: {
    GITHUB_WEBHOOK_SECRET: "test-webhook-secret-integration",
    GITHUB_ACCESS_TOKEN: "test-token",
    GITHUB_USERNAME: "testuser",
    GITHUB_REPOSITORY: "testrepo",
    DISCORD_TOKEN: "test-discord-token",
    DISCORD_CHANNEL_ID: "test-channel-id",
  },
}));

vi.mock("./githubHandlers", () => ({
  handleOpened: vi.fn(),
  handleCreated: vi.fn(),
  handleEdited: vi.fn(),
  handleClosed: vi.fn(),
  handleReopened: vi.fn(),
  handleLocked: vi.fn(),
  handleUnlocked: vi.fn(),
  handleDeleted: vi.fn(),
}));

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  Actions: {},
  Triggerer: {},
  getGithubUrl: vi.fn(),
}));

vi.mock("../store", () => ({
  store: { threads: [], commentMaps: [] },
  initializeStore: vi.fn(),
}));

// Import app AFTER mocks are set up (vi.mock hoisting ensures this)
import app from "./github";

function sign(body: string, secret = TEST_SECRET): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

describe("webhook endpoint — Express middleware chain (AC-1, AC-2)", () => {
  it("returns 200 with valid HMAC-SHA256 signature and parseable JSON body", async () => {
    // Arrange
    const body = JSON.stringify({ action: "opened" });
    const sig = sign(body);

    // Act
    const res = await request(app)
      .post("/")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sig)
      .send(body);

    // Assert
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ msg: "ok" });
  });

  it("returns 403 when the signature is computed with the wrong secret", async () => {
    // Arrange
    const body = JSON.stringify({ action: "opened" });
    const wrongSig = sign(body, "attacker-secret");

    // Act
    const res = await request(app)
      .post("/")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", wrongSig)
      .send(body);

    // Assert
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Invalid or missing webhook signature" });
  });

  it("returns 403 when the X-Hub-Signature-256 header is absent", async () => {
    // Arrange
    const body = JSON.stringify({ action: "opened" });

    // Act — no signature header
    const res = await request(app)
      .post("/")
      .set("Content-Type", "application/json")
      .send(body);

    // Assert
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Invalid or missing webhook signature" });
  });

  it("returns 400 when signature is valid but body is malformed JSON", async () => {
    // Arrange
    const body = "not-json{{{malformed";
    const sig = sign(body);

    // Act
    const res = await request(app)
      .post("/")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sig)
      .send(body);

    // Assert
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid JSON" });
  });

  it("raw body capture is active — HMAC over exact bytes is accepted (express.raw not express.json)", async () => {
    // Arrange — this test is specifically a regression guard: if express.json() were
    // applied globally (before express.raw), req.body would already be a parsed object
    // when the HMAC middleware runs. Buffer.toString() of a parsed object gives
    // '[object Object]', which produces a different HMAC than GitHub computed over the
    // original bytes — causing valid signatures to be rejected with 403.
    const body = JSON.stringify({ action: "created", number: 42 });
    const sig = sign(body); // HMAC computed over raw JSON string (same as GitHub)

    // Act
    const res = await request(app)
      .post("/")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sig)
      .send(body);

    // Assert — 200 proves req.body arrived as raw bytes; 403 would indicate express.json() interference
    expect(res.status).toBe(200);
  });
});
