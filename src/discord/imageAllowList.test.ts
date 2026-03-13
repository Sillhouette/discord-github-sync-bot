import { describe, it, expect, vi } from "vitest";

// ac_id: AC-5
// Import the allow-list predicate — exported from discordActions.ts

vi.mock("../config", () => ({
  config: {
    GITHUB_ACCESS_TOKEN: "test-token",
    GITHUB_USERNAME: "testuser",
    GITHUB_REPOSITORY: "testrepo",
    DISCORD_TOKEN: "test-discord-token",
    DISCORD_CHANNEL_ID: "test-channel-id",
  },
}));
vi.mock("./discord", () => ({
  default: { channels: { cache: new Map() }, user: { id: "bot-app-id" } },
}));
vi.mock("../logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  Actions: {},
  Triggerer: {},
  getDiscordUrl: vi.fn(),
}));
vi.mock("../store", () => ({ store: { threads: [], deleteThread: vi.fn() } }));
vi.mock("../commentMap", () => ({ saveCommentMapping: vi.fn() }));
vi.mock("discord.js", () => ({
  MessagePayload: {
    create: vi.fn(() => ({ resolveBody: vi.fn(() => ({})) })),
  },
}));

import { isImageUrlSafe } from "./discordActions";

describe("isImageUrlSafe", () => {
  describe("AC-5: safe hosts are accepted", () => {
    const safeCases = [
      "https://cdn.discordapp.com/attachments/123/abc.png",
      "https://media.discordapp.net/attachments/123/abc.png",
      "https://githubusercontent.com/user/repo/raw/main/img.png",
      "https://raw.githubusercontent.com/user/repo/main/img.png",
      "https://github.com/user/repo/assets/123/abc.png",
      "https://user-images.githubusercontent.com/123/abc.png",
    ];

    for (const url of safeCases) {
      it(`AC-5: accepts safe host URL: ${new URL(url).hostname}`, () => {
        // ac_id: AC-5

        // Arrange — url defined above

        // Act
        const result = isImageUrlSafe(url);

        // Assert
        expect(result).toBe(true);
      });
    }
  });

  describe("AC-5: untrusted hosts are rejected", () => {
    const unsafeCases = [
      "https://evil.com/image.png",
      "https://attacker.example.com/img.png",
      "http://malicious.io/tracker.gif",
      "https://phishing-github.com/img.png",
    ];

    for (const url of unsafeCases) {
      it(`AC-5: rejects untrusted host URL: ${new URL(url).hostname}`, () => {
        // ac_id: AC-5

        // Arrange — url defined above

        // Act
        const result = isImageUrlSafe(url);

        // Assert
        expect(result).toBe(false);
      });
    }
  });

  it("AC-5 edge: subdomain-spoofing bypass is blocked (evil.githubusercontent.com.attacker.com)", () => {
    // ac_id: AC-5
    // endsWith("githubusercontent.com") would match this — hostname check must be exact-or-subdomain

    // Arrange
    const spoofUrl = "https://evil.githubusercontent.com.attacker.com/img.png";

    // Act
    const result = isImageUrlSafe(spoofUrl);

    // Assert — must be rejected
    expect(result).toBe(false);
  });

  it("AC-5 edge: exact match on safe host (no subdomain required)", () => {
    // ac_id: AC-5

    // Arrange
    const exactUrl = "https://github.com/user-attachments/assets/abc.png";

    // Act
    const result = isImageUrlSafe(exactUrl);

    // Assert
    expect(result).toBe(true);
  });

  it("AC-5 edge: returns false for invalid URL string", () => {
    // ac_id: AC-5

    // Arrange
    const badUrl = "not-a-url-at-all";

    // Act
    const result = isImageUrlSafe(badUrl);

    // Assert — must not throw; returns false gracefully
    expect(result).toBe(false);
  });
});
