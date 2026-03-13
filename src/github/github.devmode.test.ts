import { describe, it, expect, vi } from "vitest";
import request from "supertest";

// ac_id: AC-2 (dev-mode skip path)
// Tests the case where GITHUB_WEBHOOK_SECRET is not set.
// In this mode, the middleware skips signature verification so local development
// works without needing to configure a real webhook secret.
//
// This test runs in a separate file from github.test.ts so that each file gets
// its own isolated module instance with its own config mock — vi.mock is module-scoped.

vi.mock("../config", () => ({
  config: {
    GITHUB_WEBHOOK_SECRET: undefined, // unset — dev mode
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

import app from "./github";

describe("webhook endpoint — dev mode (no GITHUB_WEBHOOK_SECRET)", () => {
  it("returns 200 without any signature header when secret is not configured", async () => {
    // Arrange — no signature header, no secret set (development mode)
    const body = JSON.stringify({ action: "opened" });

    // Act
    const res = await request(app)
      .post("/")
      .set("Content-Type", "application/json")
      .send(body);

    // Assert — verification skipped; request accepted
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ msg: "ok" });
  });

  it("still returns 400 on malformed JSON even when verification is skipped", async () => {
    // Arrange — malformed body, no secret
    const body = "not-json{{{";

    // Act
    const res = await request(app)
      .post("/")
      .set("Content-Type", "application/json")
      .send(body);

    // Assert — JSON parsing still runs after verification skip; 400 on bad input
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid JSON" });
  });
});
