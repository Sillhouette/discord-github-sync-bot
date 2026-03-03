import { describe, it, expect, vi, beforeEach } from "vitest";
import { Attachment, Collection } from "discord.js";

vi.mock("../r2", () => ({ uploadToR2: vi.fn() }));
vi.mock("../config", () => ({
  config: {
    GITHUB_ACCESS_TOKEN: "test-token",
    GITHUB_USERNAME: "testuser",
    GITHUB_REPOSITORY: "testrepo",
    DISCORD_TOKEN: "test-discord-token",
    DISCORD_CHANNEL_ID: "test-channel-id",
  },
}));
vi.mock("../logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
  Actions: {},
  Triggerer: {},
  getGithubUrl: vi.fn(),
}));
vi.mock("../store", () => ({ store: { threads: [] } }));

import { attachmentsToMarkdown } from "./githubActions";
import { uploadToR2 } from "../r2";

function makeAttachment(fields: Partial<Attachment> & { size?: number }): Attachment {
  return {
    url: "https://cdn.discordapp.com/attachments/default.png",
    name: "default.png",
    contentType: "image/png",
    size: 1024,
    ...fields,
  } as unknown as Attachment;
}

function makeCollection(items: Attachment[]): Collection<string, Attachment> {
  const col = new Collection<string, Attachment>();
  items.forEach((item, i) => col.set(String(i), item));
  return col;
}

describe("attachmentsToMarkdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("should rehost image via R2 and use the stable CDN URL", async () => {
    // Arrange
    const discordUrl = "https://cdn.discordapp.com/attachments/img.png?ex=abc";
    const cdnUrl = "https://cdn.theoatrix.app/bot-uploads/discord/msg1/img.png";
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(100),
    } as unknown as Response);
    vi.mocked(uploadToR2).mockResolvedValueOnce(cdnUrl);

    const attachments = makeCollection([
      makeAttachment({ url: discordUrl, name: "img.png", contentType: "image/png" }),
    ]);

    // Act
    const result = await attachmentsToMarkdown(attachments, "msg1");

    // Assert
    expect(result).toBe(`![img.png](${cdnUrl} "img.png")`);
    expect(uploadToR2).toHaveBeenCalledWith(
      "bot-uploads/discord/msg1/img.png",
      expect.any(Buffer),
      "image/png",
    );
  });

  it("should fall back to Discord CDN URL when R2 is not configured (returns null)", async () => {
    // Arrange
    const discordUrl = "https://cdn.discordapp.com/attachments/img.png?ex=abc";
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(100),
    } as unknown as Response);
    vi.mocked(uploadToR2).mockResolvedValueOnce(null);

    const attachments = makeCollection([
      makeAttachment({ url: discordUrl, name: "img.png", contentType: "image/png" }),
    ]);

    // Act
    const result = await attachmentsToMarkdown(attachments, "msg1");

    // Assert
    expect(result).toBe(`![img.png](${discordUrl} "img.png")`);
  });

  it("should fall back to Discord CDN URL when fetch fails", async () => {
    // Arrange
    const discordUrl = "https://cdn.discordapp.com/attachments/img.png";
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Network error"));

    const attachments = makeCollection([
      makeAttachment({ url: discordUrl, name: "img.png", contentType: "image/png" }),
    ]);

    // Act
    const result = await attachmentsToMarkdown(attachments, "msg1");

    // Assert
    expect(result).toBe(`![img.png](${discordUrl} "img.png")`);
    expect(uploadToR2).not.toHaveBeenCalled();
  });

  it("should fall back to Discord CDN URL when fetch returns non-ok response", async () => {
    // Arrange
    const discordUrl = "https://cdn.discordapp.com/attachments/img.png";
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 403,
    } as unknown as Response);

    const attachments = makeCollection([
      makeAttachment({ url: discordUrl, name: "img.png", contentType: "image/png" }),
    ]);

    // Act
    const result = await attachmentsToMarkdown(attachments, "msg1");

    // Assert
    expect(result).toBe(`![img.png](${discordUrl} "img.png")`);
    expect(uploadToR2).not.toHaveBeenCalled();
  });

  it("should inline small text file contents in a fenced code block", async () => {
    // Arrange
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      text: async () => "hello world",
    } as unknown as Response);

    const attachments = makeCollection([
      makeAttachment({
        url: "https://cdn.discordapp.com/attachments/notes.txt",
        name: "notes.txt",
        contentType: "text/plain",
        size: 11,
      }),
    ]);

    // Act
    const result = await attachmentsToMarkdown(attachments, "msg1");

    // Assert
    expect(result).toContain("**Attached: notes.txt**");
    expect(result).toContain("```");
    expect(result).toContain("hello world");
  });

  it("should rehost large text files (over 4KB) to R2 and use stable CDN URL", async () => {
    // Arrange
    const discordUrl = "https://cdn.discordapp.com/attachments/big.txt";
    const cdnUrl = "https://cdn.theoatrix.app/bot-uploads/discord/msg1/big.txt";
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8192),
    } as unknown as Response);
    vi.mocked(uploadToR2).mockResolvedValueOnce(cdnUrl);

    const attachments = makeCollection([
      makeAttachment({
        url: discordUrl,
        name: "big.txt",
        contentType: "text/plain",
        size: 8192,
      }),
    ]);

    // Act
    const result = await attachmentsToMarkdown(attachments, "msg1");

    // Assert
    expect(result).toBe(`[big.txt](${cdnUrl})`);
    expect(uploadToR2).toHaveBeenCalledWith(
      "bot-uploads/discord/msg1/big.txt",
      expect.any(Buffer),
      "text/plain",
    );
  });

  it("should fall back to Discord URL for large text files when R2 returns null", async () => {
    // Arrange
    const discordUrl = "https://cdn.discordapp.com/attachments/big.txt";
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8192),
    } as unknown as Response);
    vi.mocked(uploadToR2).mockResolvedValueOnce(null);

    const attachments = makeCollection([
      makeAttachment({
        url: discordUrl,
        name: "big.txt",
        contentType: "text/plain",
        size: 8192,
      }),
    ]);

    // Act
    const result = await attachmentsToMarkdown(attachments, "msg1");

    // Assert
    expect(result).toBe(`[big.txt](${discordUrl})`);
  });

  it("should fall back to link when text fetch fails", async () => {
    // Arrange
    const discordUrl = "https://cdn.discordapp.com/attachments/notes.txt";
    vi.mocked(fetch).mockRejectedValueOnce(new Error("403 Forbidden"));

    const attachments = makeCollection([
      makeAttachment({ url: discordUrl, name: "notes.txt", contentType: "text/plain", size: 100 }),
    ]);

    // Act
    const result = await attachmentsToMarkdown(attachments, "msg1");

    // Assert
    expect(result).toBe(`[notes.txt](${discordUrl})`);
  });

  it("should rehost binary files to R2 and use stable CDN URL", async () => {
    // Arrange
    const discordUrl = "https://cdn.discordapp.com/attachments/archive.zip";
    const cdnUrl = "https://cdn.theoatrix.app/bot-uploads/discord/msg1/archive.zip";
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(65536),
    } as unknown as Response);
    vi.mocked(uploadToR2).mockResolvedValueOnce(cdnUrl);

    const attachments = makeCollection([
      makeAttachment({
        url: discordUrl,
        name: "archive.zip",
        contentType: "application/zip",
        size: 65536,
      }),
    ]);

    // Act
    const result = await attachmentsToMarkdown(attachments, "msg1");

    // Assert
    expect(result).toBe(`[archive.zip](${cdnUrl})`);
    expect(uploadToR2).toHaveBeenCalledWith(
      "bot-uploads/discord/msg1/archive.zip",
      expect.any(Buffer),
      "application/zip",
    );
  });

  it("should fall back to Discord URL for binary files when R2 returns null", async () => {
    // Arrange
    const discordUrl = "https://cdn.discordapp.com/attachments/archive.zip";
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(65536),
    } as unknown as Response);
    vi.mocked(uploadToR2).mockResolvedValueOnce(null);

    const attachments = makeCollection([
      makeAttachment({
        url: discordUrl,
        name: "archive.zip",
        contentType: "application/zip",
        size: 65536,
      }),
    ]);

    // Act
    const result = await attachmentsToMarkdown(attachments, "msg1");

    // Assert
    expect(result).toBe(`[archive.zip](${discordUrl})`);
  });

  it("should rehost gif images via R2 and use stable CDN URL", async () => {
    // Arrange
    const discordUrl = "https://cdn.discordapp.com/attachments/anim.gif";
    const cdnUrl = "https://cdn.theoatrix.app/bot-uploads/discord/msg1/anim.gif";
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(200),
    } as unknown as Response);
    vi.mocked(uploadToR2).mockResolvedValueOnce(cdnUrl);

    const attachments = makeCollection([
      makeAttachment({ url: discordUrl, name: "anim.gif", contentType: "image/gif" }),
    ]);

    // Act
    const result = await attachmentsToMarkdown(attachments, "msg1");

    // Assert
    expect(result).toBe(`![anim.gif](${cdnUrl} "anim.gif")`);
    expect(uploadToR2).toHaveBeenCalledWith(
      "bot-uploads/discord/msg1/anim.gif",
      expect.any(Buffer),
      "image/gif",
    );
  });

  it("should rehost webp images via R2 and use stable CDN URL", async () => {
    // Arrange
    const discordUrl = "https://cdn.discordapp.com/attachments/photo.webp";
    const cdnUrl = "https://cdn.theoatrix.app/bot-uploads/discord/msg1/photo.webp";
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(300),
    } as unknown as Response);
    vi.mocked(uploadToR2).mockResolvedValueOnce(cdnUrl);

    const attachments = makeCollection([
      makeAttachment({ url: discordUrl, name: "photo.webp", contentType: "image/webp" }),
    ]);

    // Act
    const result = await attachmentsToMarkdown(attachments, "msg1");

    // Assert
    expect(result).toBe(`![photo.webp](${cdnUrl} "photo.webp")`);
    expect(uploadToR2).toHaveBeenCalledWith(
      "bot-uploads/discord/msg1/photo.webp",
      expect.any(Buffer),
      "image/webp",
    );
  });

  it("should handle mixed image and text attachments", async () => {
    // Arrange
    const imgCdnUrl = "https://cdn.theoatrix.app/bot-uploads/discord/msg1/img.png";
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(100),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "log content",
      } as unknown as Response);
    vi.mocked(uploadToR2).mockResolvedValueOnce(imgCdnUrl);

    const attachments = makeCollection([
      makeAttachment({ url: "https://cdn.discordapp.com/img.png", name: "img.png", contentType: "image/png", size: 500 }),
      makeAttachment({ url: "https://cdn.discordapp.com/log.txt", name: "log.txt", contentType: "text/plain", size: 200 }),
    ]);

    // Act
    const result = await attachmentsToMarkdown(attachments, "msg1");

    // Assert
    expect(result).toContain(`![img.png](${imgCdnUrl}`);
    expect(result).toContain("log content");
  });
});
