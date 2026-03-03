import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractImageUrls, stripImageMarkdown, createComment, updateComment } from "./discordActions";

vi.mock("../config", () => ({
  config: {
    GITHUB_ACCESS_TOKEN: "test-token",
    GITHUB_USERNAME: "testuser",
    GITHUB_REPOSITORY: "testrepo",
    DISCORD_TOKEN: "test-discord-token",
    DISCORD_CHANNEL_ID: "test-channel-id",
  },
}));

// user.id is the bot's application ID — used by the webhook selector in updateComment.
vi.mock("./discord", () => ({
  default: { channels: { cache: new Map() }, user: { id: "bot-app-id" } },
}));

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
  Actions: { Commented: "commented", EditedComment: "editedComment" },
  Triggerer: { Github: "github" },
  getDiscordUrl: vi.fn(),
}));

vi.mock("../store", () => ({ store: { threads: [] } }));

vi.mock("../commentMap", () => ({ saveCommentMapping: vi.fn() }));

// Mock only MessagePayload from discord.js — the other imports are TypeScript
// types only and don't require a runtime value.
vi.mock("discord.js", () => ({
  MessagePayload: {
    create: vi.fn(() => ({ resolveBody: vi.fn(() => ({})) })),
  },
}));

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

  it("should extract URL from an HTML img tag (GitHub upload format)", () => {
    // Arrange — GitHub renders uploaded images as <img> tags, not markdown
    const body =
      '<img width="1179" height="2556" alt="Image" src="https://github.com/user-attachments/assets/e65d8dfa-3afc-483f-9572-566157819caa" />';

    // Act
    const result = extractImageUrls(body);

    // Assert
    expect(result).toEqual([
      "https://github.com/user-attachments/assets/e65d8dfa-3afc-483f-9572-566157819caa",
    ]);
  });

  it("should extract URLs from mixed markdown and HTML img tags", () => {
    // Arrange
    const body =
      '![md](https://example.com/a.png)\n<img src="https://github.com/user-attachments/assets/abc123" />';

    // Act
    const result = extractImageUrls(body);

    // Assert
    expect(result).toEqual([
      "https://example.com/a.png",
      "https://github.com/user-attachments/assets/abc123",
    ]);
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

  it("should strip HTML img tags (GitHub upload format)", () => {
    // Arrange
    const body =
      'Some text\n<img width="1179" height="2556" alt="Image" src="https://github.com/user-attachments/assets/abc" />\nMore text';

    // Act
    const result = stripImageMarkdown(body);

    // Assert
    expect(result).toBe("Some text\n\nMore text");
  });

  it("should strip non-self-closing HTML img tags", () => {
    // Arrange — HTML5 allows <img> without the trailing slash
    const body = 'Text <img src="https://example.com/img.png"> More';

    // Act
    const result = stripImageMarkdown(body);

    // Assert
    expect(result).toBe("Text  More");
  });
});

describe("createComment", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { store } = await import("../store");
    store.threads = [];
    const discordModule = await import("./discord");
    (discordModule.default.channels.cache as Map<string, unknown>).clear();
  });

  it("should call saveCommentMapping after posting a webhook message", async () => {
    // Arrange
    const mockSend = vi.fn().mockResolvedValue({ id: "discord-msg-777" });
    const mockCreateWebhook = vi.fn().mockResolvedValue({ send: mockSend });
    const mockChannel = {
      parentId: "forum-create-1",
      parent: { createWebhook: mockCreateWebhook },
    };

    const { store } = await import("../store");
    const discordModule = await import("./discord");
    const { saveCommentMapping } = await import("../commentMap");

    store.threads = [
      {
        id: "thread-create-1",
        title: "Test",
        appliedTags: [],
        node_id: "gh-node-create-1",
        comments: [],
        archived: false,
        locked: false,
      },
    ];
    (discordModule.default.channels.cache as Map<string, unknown>).set(
      "thread-create-1",
      mockChannel,
    );

    // Act
    await createComment({
      git_id: 42,
      body: "Hello from GitHub",
      login: "octocat",
      avatar_url: "https://github.com/octocat.png",
      node_id: "gh-node-create-1",
    });

    // Assert
    expect(mockSend).toHaveBeenCalled();
    expect(saveCommentMapping).toHaveBeenCalledWith(42, "discord-msg-777", "gh-node-create-1");
  });
});

describe("updateComment", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { store } = await import("../store");
    store.threads = [];
    const discordModule = await import("./discord");
    (discordModule.default.channels.cache as Map<string, unknown>).clear();
  });

  it("should fetch webhooks by applicationId when cache is cold and edit the message", async () => {
    // Arrange — webhookCache starts cold for this parentId (unique per test)
    const mockEditMessage = vi.fn().mockResolvedValue({});
    // The webhook's applicationId must match client.user.id ("bot-app-id" from the mock)
    const mockWebhook = { applicationId: "bot-app-id", editMessage: mockEditMessage };
    const mockHooks = {
      find: vi.fn((predicate: (h: typeof mockWebhook) => boolean) =>
        predicate(mockWebhook) ? mockWebhook : undefined,
      ),
      first: vi.fn(() => mockWebhook),
    };
    const mockFetchWebhooks = vi.fn().mockResolvedValue(mockHooks);
    const mockChannel = {
      parentId: "forum-update-cold-1",
      parent: { fetchWebhooks: mockFetchWebhooks },
    };

    const { store } = await import("../store");
    const discordModule = await import("./discord");

    store.threads = [
      {
        id: "thread-update-1",
        title: "Test",
        appliedTags: [],
        node_id: "gh-node-update-1",
        comments: [{ id: "discord-msg-edit-1", git_id: 55 }],
        archived: false,
        locked: false,
      },
    ];
    (discordModule.default.channels.cache as Map<string, unknown>).set(
      "thread-update-1",
      mockChannel,
    );

    // Act
    await updateComment({
      discord_id: "discord-msg-edit-1",
      body: "Edited text",
      node_id: "gh-node-update-1",
    });

    // Assert — fetched by applicationId, edited the right message
    expect(mockFetchWebhooks).toHaveBeenCalled();
    expect(mockHooks.find).toHaveBeenCalled();
    expect(mockEditMessage).toHaveBeenCalledWith(
      "discord-msg-edit-1",
      expect.objectContaining({ content: "Edited text" }),
    );
  });

  it("should edit the message using the cached webhook without fetching again", async () => {
    // Arrange — warm the cache for a unique parentId by going through createComment first
    const mockEditMessage = vi.fn().mockResolvedValue({});
    const mockSend = vi.fn().mockResolvedValue({ id: "discord-msg-warm-1" });
    // Single webhook object serves both send (from createComment) and editMessage (from updateComment)
    const mockWebhook = { send: mockSend, editMessage: mockEditMessage, edit: vi.fn() };
    const mockCreateWebhook = vi.fn().mockResolvedValue(mockWebhook);
    const mockChannel = {
      parentId: "forum-warm-1",
      parent: { createWebhook: mockCreateWebhook },
      // fetchWebhooks is placed on the channel object (not channel.parent) intentionally —
      // it acts as a sentinel to confirm the warm-cache path never reaches the fallback
      // fetch logic, which calls channel.parent.fetchWebhooks(). Placing it here means
      // any accidental call would be caught by the not.toHaveBeenCalled() assertion below
      // without accidentally wiring it into the real code path under test.
      fetchWebhooks: vi.fn(),
    };

    const { store } = await import("../store");
    const discordModule = await import("./discord");

    store.threads = [
      {
        id: "thread-warm-1",
        title: "Test",
        appliedTags: [],
        node_id: "gh-node-warm-1",
        comments: [],
        archived: false,
        locked: false,
      },
    ];
    (discordModule.default.channels.cache as Map<string, unknown>).set(
      "thread-warm-1",
      mockChannel,
    );

    // Warm the cache: createComment creates + caches the webhook for "forum-warm-1"
    await createComment({
      git_id: 77,
      body: "Initial comment",
      login: "octocat",
      avatar_url: "https://github.com/octocat.png",
      node_id: "gh-node-warm-1",
    });

    // Act — updateComment should reuse the cached webhook, not call fetchWebhooks
    await updateComment({
      discord_id: "discord-msg-warm-1",
      body: "Edited warm",
      node_id: "gh-node-warm-1",
    });

    // Assert — no fetch needed; editMessage called directly
    expect(mockChannel.fetchWebhooks).not.toHaveBeenCalled();
    expect(mockEditMessage).toHaveBeenCalledWith(
      "discord-msg-warm-1",
      expect.objectContaining({ content: "Edited warm" }),
    );
  });

  it("should log an error and not edit when fetchWebhooks returns empty collection", async () => {
    // Arrange — cache is cold; fetchWebhooks returns a collection with no webhooks
    const mockHooks = {
      find: vi.fn(() => undefined),
      first: vi.fn(() => undefined),
    };
    const mockFetchWebhooks = vi.fn().mockResolvedValue(mockHooks);
    const mockChannel = {
      parentId: "forum-empty-hooks-1",
      parent: { fetchWebhooks: mockFetchWebhooks },
    };

    const { store } = await import("../store");
    const discordModule = await import("./discord");
    const { logger } = await import("../logger");

    store.threads = [
      {
        id: "thread-empty-hooks-1",
        title: "Test",
        appliedTags: [],
        node_id: "gh-node-empty-hooks-1",
        comments: [{ id: "discord-msg-no-hook", git_id: 88 }],
        archived: false,
        locked: false,
      },
    ];
    (discordModule.default.channels.cache as Map<string, unknown>).set(
      "thread-empty-hooks-1",
      mockChannel,
    );

    // Act
    await updateComment({
      discord_id: "discord-msg-no-hook",
      body: "Should not be sent",
      node_id: "gh-node-empty-hooks-1",
    });

    // Assert — error logged, no edit attempted
    expect(mockFetchWebhooks).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("no webhook found"),
    );
  });
});
