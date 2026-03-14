import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Tests for config.ts — required vs optional env var split + startup warning

describe("config", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save and reset env before each test
    originalEnv = { ...process.env };
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
    vi.resetModules();
  });

  function setRequiredEnv() {
    process.env.DISCORD_TOKEN = "test-discord-token";
    process.env.GITHUB_ACCESS_TOKEN = "test-github-pat";
    process.env.GITHUB_USERNAME = "test-user";
    process.env.GITHUB_REPOSITORY = "test-repo";
    process.env.DISCORD_CHANNEL_ID = "123456789";
  }

  describe("required vars", () => {
    it("should export config with all required vars when all are set", async () => {
      // Arrange
      setRequiredEnv();
      process.env.GITHUB_WEBHOOK_SECRET = "test-secret";

      // Act
      const { config } = await import("./config");

      // Assert
      expect(config.DISCORD_TOKEN).toBe("test-discord-token");
      expect(config.GITHUB_ACCESS_TOKEN).toBe("test-github-pat");
      expect(config.GITHUB_USERNAME).toBe("test-user");
      expect(config.GITHUB_REPOSITORY).toBe("test-repo");
      expect(config.DISCORD_CHANNEL_ID).toBe("123456789");
    });

    it("should throw when DISCORD_TOKEN is missing", async () => {
      // Arrange
      setRequiredEnv();
      delete process.env.DISCORD_TOKEN;

      // Act & Assert — error must name the missing var
      await expect(import("./config")).rejects.toThrow("DISCORD_TOKEN");
    });

    it("should throw when GITHUB_ACCESS_TOKEN is missing", async () => {
      // Arrange
      setRequiredEnv();
      delete process.env.GITHUB_ACCESS_TOKEN;

      // Act & Assert
      await expect(import("./config")).rejects.toThrow("GITHUB_ACCESS_TOKEN");
    });

    it("should throw when GITHUB_USERNAME is missing", async () => {
      // Arrange
      setRequiredEnv();
      delete process.env.GITHUB_USERNAME;

      // Act & Assert
      await expect(import("./config")).rejects.toThrow("GITHUB_USERNAME");
    });

    it("should throw when GITHUB_REPOSITORY is missing", async () => {
      // Arrange
      setRequiredEnv();
      delete process.env.GITHUB_REPOSITORY;

      // Act & Assert
      await expect(import("./config")).rejects.toThrow("GITHUB_REPOSITORY");
    });

    it("should throw when DISCORD_CHANNEL_ID is missing", async () => {
      // Arrange
      setRequiredEnv();
      delete process.env.DISCORD_CHANNEL_ID;

      // Act & Assert
      await expect(import("./config")).rejects.toThrow("DISCORD_CHANNEL_ID");
    });
  });

  describe("optional vars", () => {
    it("should NOT throw when GITHUB_WEBHOOK_SECRET is absent", async () => {
      // Arrange
      setRequiredEnv();
      delete process.env.GITHUB_WEBHOOK_SECRET;

      // Act & Assert — must not throw
      const { config } = await import("./config");
      expect(config.GITHUB_WEBHOOK_SECRET).toBeUndefined();
    });

    it("should NOT throw when R2_BUCKET is absent", async () => {
      // Arrange
      setRequiredEnv();
      delete process.env.R2_BUCKET;

      // Act & Assert — must not throw
      const { config } = await import("./config");
      expect(config.R2_BUCKET).toBeUndefined();
    });

    it("should NOT throw when R2_CDN_BASE_URL is absent", async () => {
      // Arrange
      setRequiredEnv();
      delete process.env.R2_CDN_BASE_URL;

      // Act & Assert — must not throw
      const { config } = await import("./config");
      expect(config.R2_CDN_BASE_URL).toBeUndefined();
    });

    it("should export R2_BUCKET as string | undefined", async () => {
      // Arrange
      setRequiredEnv();
      process.env.R2_BUCKET = "my-bucket";
      process.env.R2_CDN_BASE_URL = "https://cdn.example.com";

      // Act
      const { config } = await import("./config");

      // Assert
      expect(config.R2_BUCKET).toBe("my-bucket");
      expect(config.R2_CDN_BASE_URL).toBe("https://cdn.example.com");
    });
  });

  describe("startup warning", () => {
    it("should log a security warning when GITHUB_WEBHOOK_SECRET is absent", async () => {
      // Arrange
      setRequiredEnv();
      delete process.env.GITHUB_WEBHOOK_SECRET;
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      // Act
      await import("./config");

      // Assert — warning must mention security and unauthenticated
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("GITHUB_WEBHOOK_SECRET"),
      );
      warnSpy.mockRestore();
    });

    it("should NOT log a security warning when GITHUB_WEBHOOK_SECRET is set", async () => {
      // Arrange
      setRequiredEnv();
      process.env.GITHUB_WEBHOOK_SECRET = "strong-secret";
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      // Act
      await import("./config");

      // Assert
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});
