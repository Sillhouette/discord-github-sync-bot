import { describe, it, expect, vi } from "vitest";
import { extractImageUrls, stripImageMarkdown } from "./discordActions";

vi.mock("../config", () => ({
  config: {
    GITHUB_ACCESS_TOKEN: "test-token",
    GITHUB_USERNAME: "testuser",
    GITHUB_REPOSITORY: "testrepo",
    DISCORD_TOKEN: "test-discord-token",
    DISCORD_CHANNEL_ID: "test-channel-id",
  },
}));

vi.mock("./discord", () => ({ default: { channels: { cache: new Map() } } }));

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
  Actions: {},
  Triggerer: {},
  getDiscordUrl: vi.fn(),
}));

vi.mock("../store", () => ({ store: { threads: [] } }));

describe("extractImageUrls", () => {
  it("should extract a single image URL from markdown", () => {
    // Arrange
    const body = "Some text\n![screenshot](https://example.com/image.png)\nMore text";

    // Act
    const result = extractImageUrls(body);

    // Assert
    expect(result).toEqual(["https://example.com/image.png"]);
  });

  it("should extract multiple image URLs from markdown", () => {
    // Arrange
    const body =
      "![first](https://example.com/a.png) and ![second](https://example.com/b.gif)";

    // Act
    const result = extractImageUrls(body);

    // Assert
    expect(result).toEqual([
      "https://example.com/a.png",
      "https://example.com/b.gif",
    ]);
  });

  it("should return empty array when no images are present", () => {
    // Arrange
    const body = "Just plain text with no images";

    // Act
    const result = extractImageUrls(body);

    // Assert
    expect(result).toEqual([]);
  });

  it("should handle GitHub user-content image URLs", () => {
    // Arrange
    const body =
      "![screenshot](https://user-images.githubusercontent.com/123/abc.png)";

    // Act
    const result = extractImageUrls(body);

    // Assert
    expect(result).toEqual([
      "https://user-images.githubusercontent.com/123/abc.png",
    ]);
  });

  it("should extract URL from image markdown with title attribute", () => {
    // Arrange
    const body = '![alt text](https://example.com/img.png "image title")';

    // Act
    const result = extractImageUrls(body);

    // Assert
    expect(result).toEqual(["https://example.com/img.png"]);
  });

  it("should not extract non-image markdown links", () => {
    // Arrange
    const body = "[link text](https://example.com/page)";

    // Act
    const result = extractImageUrls(body);

    // Assert
    expect(result).toEqual([]);
  });
});

describe("stripImageMarkdown", () => {
  it("should remove image markdown from body", () => {
    // Arrange
    const body = "Before\n![screenshot](https://example.com/img.png)\nAfter";

    // Act
    const result = stripImageMarkdown(body);

    // Assert
    expect(result).toBe("Before\n\nAfter");
  });

  it("should return empty string when body is only an image", () => {
    // Arrange
    const body = "![screenshot](https://example.com/img.png)";

    // Act
    const result = stripImageMarkdown(body);

    // Assert
    expect(result).toBe("");
  });

  it("should remove multiple image markdowns", () => {
    // Arrange
    const body =
      "Text ![a](https://example.com/a.png) middle ![b](https://example.com/b.png) end";

    // Act
    const result = stripImageMarkdown(body);

    // Assert
    expect(result).toBe("Text  middle  end");
  });

  it("should leave non-image content untouched", () => {
    // Arrange
    const body = "Plain text with [a link](https://example.com) here";

    // Act
    const result = stripImageMarkdown(body);

    // Assert
    expect(result).toBe("Plain text with [a link](https://example.com) here");
  });

  it("should remove image markdown with title attribute", () => {
    // Arrange
    const body = 'Before ![alt](https://example.com/img.png "My title") After';

    // Act
    const result = stripImageMarkdown(body);

    // Assert
    expect(result).toBe("Before  After");
  });
});
