import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractImageUrls, stripImageMarkdown, truncateContent, createThread, createComment, updateComment, evictForumCache } from "./discordActions";

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

describe("truncateContent", () => {
  it("returns the text unchanged when at or below 2000 characters", () => {
    // Arrange
    const text = "a".repeat(2000);

    // Act
    const result = truncateContent(text);

    // Assert
    expect(result).toBe(text);
    expect(result.length).toBe(2000);
  });

  it("truncates text exceeding 2000 characters and appends suffix", () => {
    // Arrange
    const text = "a".repeat(2500);

    // Act
    const result = truncateContent(text);

    // Assert
    expect(result.length).toBe(2000);
    expect(result).toContain("*(truncated — see GitHub for full comment)*");
  });

  it("truncates text that is exactly 2001 characters", () => {
    // Arrange — one character over the limit; the boundary itself must trigger truncation
    const text = "a".repeat(2001);

    // Act
    const result = truncateContent(text);

    // Assert
    expect(result.length).toBe(2000);
    expect(result).toContain("*(truncated — see GitHub for full comment)*");
  });

  it("returns short text unchanged", () => {
    // Arrange
    const text = "short message";

    // Act
    const result = truncateContent(text);

    // Assert
    expect(result).toBe("short message");
  });

  it("does not split emoji surrogate pairs when truncating", () => {
    // Arrange — each 🗡️ is 2 UTF-16 code units but 1 code point; fill just over limit
    const emoji = "🗡️";
    const text = emoji.repeat(1001); // 1001 code points, well over 2000

    // Act
    const result = truncateContent(text);

    // Assert — result must be valid (no malformed trailing surrogate)
    expect([...result].every((cp) => cp !== "\uFFFD")).toBe(true);
    expect(result).toContain("*(truncated — see GitHub for full comment)*");
    expect([...result].length).toBe(2000);
  });
});

describe("createThread", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { store } = await import("../store");
    store.threads = [];
    const discordModule = await import("./discord");
    (discordModule.default.channels.cache as Map<string, unknown>).clear();
  });

  it("formats opening message as login attribution followed by body", async () => {
    // Arrange
    const mockCreate = vi.fn().mockResolvedValue({ id: "thread-fmt-1" });
    const mockForum = { threads: { create: mockCreate } };

    const { store } = await import("../store");
    const discordModule = await import("./discord");

    store.threads = [
      {
        id: "thread-fmt-1",
        title: "Test issue",
        appliedTags: [],
        comments: [],
        archived: false,
        locked: false,
      },
    ];
    (discordModule.default.channels.cache as Map<string, unknown>).set(
      "test-channel-id",
      mockForum,
    );

    // Act
    await createThread({
      login: "octocat",
      title: "Test issue",
      body: "Something is broken.",
      appliedTags: [],
      node_id: "node-1",
      number: 1,
    });

    // Assert
    const content = mockCreate.mock.calls[0][0].message.content as string;
    expect(content).toBe("**octocat** (GitHub)\n\nSomething is broken.");
  });

  it("truncates opening message exceeding 2000 characters", async () => {
    // Arrange
    const mockCreate = vi.fn().mockResolvedValue({ id: "thread-trunc-long-1" });
    const mockForum = { threads: { create: mockCreate } };

    const { store } = await import("../store");
    const discordModule = await import("./discord");

    store.threads = [
      {
        id: "thread-trunc-long-1",
        title: "Long issue",
        appliedTags: [],
        comments: [],
        archived: false,
        locked: false,
      },
    ];
    (discordModule.default.channels.cache as Map<string, unknown>).set(
      "test-channel-id",
      mockForum,
    );

    // Act
    await createThread({
      login: "octocat",
      title: "Long issue",
      body: "x".repeat(3000),
      appliedTags: [],
      node_id: "node-trunc-long-1",
      number: 2,
    });

    // Assert
    const content = mockCreate.mock.calls[0][0].message.content as string;
    expect([...content].length).toBe(2000);
    expect(content).toContain("*(truncated — see GitHub for full comment)*");
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
      parent: {
        fetchWebhooks: vi.fn().mockResolvedValue({ find: () => undefined, first: () => undefined }),
        createWebhook: mockCreateWebhook,
      },
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

  it("reuses an existing webhook on cold cache instead of creating a new one", async () => {
    // Arrange — fetchWebhooks returns an existing bot webhook
    const mockSend = vi.fn().mockResolvedValue({ id: "discord-msg-reuse" });
    const mockEdit = vi.fn().mockResolvedValue(undefined);
    const existingWebhook = { send: mockSend, edit: mockEdit, applicationId: "bot-app-id" };
    const mockCreateWebhook = vi.fn();
    const mockChannel = {
      parentId: "forum-reuse-1",
      parent: {
        fetchWebhooks: vi.fn().mockResolvedValue({
          find: vi.fn().mockReturnValue(existingWebhook),
          first: vi.fn().mockReturnValue(existingWebhook),
        }),
        createWebhook: mockCreateWebhook,
      },
    };

    const { store } = await import("../store");
    const discordModule = await import("./discord");

    store.threads = [
      {
        id: "thread-reuse-1",
        title: "Reuse test",
        appliedTags: [],
        node_id: "gh-node-reuse-1",
        comments: [],
        archived: false,
        locked: false,
      },
    ];
    (discordModule.default.channels.cache as Map<string, unknown>).set(
      "thread-reuse-1",
      mockChannel,
    );

    // Act
    await createComment({
      git_id: 55,
      body: "Hello",
      login: "octocat",
      avatar_url: "https://github.com/octocat.png",
      node_id: "gh-node-reuse-1",
    });

    // Assert — existing webhook was reused; no new webhook was created
    expect(mockCreateWebhook).not.toHaveBeenCalled();
    expect(mockEdit).toHaveBeenCalledWith({ name: "octocat", avatar: "https://github.com/octocat.png" });
    expect(mockSend).toHaveBeenCalled();
  });

  it("truncates body exceeding 2000 characters before sending", async () => {
    // Arrange
    const mockSend = vi.fn().mockResolvedValue({ id: "discord-msg-trunc-1" });
    const mockCreateWebhook = vi.fn().mockResolvedValue({ send: mockSend });
    const mockChannel = {
      parentId: "forum-trunc-1",
      parent: {
        fetchWebhooks: vi.fn().mockResolvedValue({ find: () => undefined, first: () => undefined }),
        createWebhook: mockCreateWebhook,
      },
    };

    const { store } = await import("../store");
    const discordModule = await import("./discord");

    store.threads = [
      {
        id: "thread-trunc-1",
        title: "Test",
        appliedTags: [],
        node_id: "gh-node-trunc-1",
        comments: [],
        archived: false,
        locked: false,
      },
    ];
    (discordModule.default.channels.cache as Map<string, unknown>).set(
      "thread-trunc-1",
      mockChannel,
    );

    // Act
    await createComment({
      git_id: 99,
      body: "x".repeat(3000),
      login: "octocat",
      avatar_url: "https://github.com/octocat.png",
      node_id: "gh-node-trunc-1",
    });

    // Assert — content sent to Discord must be at most 2000 chars
    const { MessagePayload } = await import("discord.js");
    const callArg = (MessagePayload.create as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect([...callArg.content].length).toBe(2000);
    expect(callArg.content).toContain("*(truncated — see GitHub for full comment)*");
  });

  it("does not start second task until first send completes", async () => {
    // Arrange — Alice's send is deferred; Bob's send resolves immediately.
    // Alice takes the createWebhook path (no rename); Bob hits the cached-webhook
    // path and calls webhook.edit. The queue must hold Bob's rename until Alice's
    // send resolves.
    const log: string[] = [];
    let resolveAliceSend!: () => void;

    const mockSend = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ id: string }>((resolve) => {
            resolveAliceSend = () => {
              log.push("alice-send");
              resolve({ id: "msg-alice" });
            };
          }),
      )
      .mockImplementationOnce(() => {
        log.push("bob-send");
        return Promise.resolve({ id: "msg-bob" });
      });

    const mockWebhook = {
      edit: vi.fn(({ name }: { name: string }) => {
        log.push(`rename-${name}`);
        return Promise.resolve();
      }),
      send: mockSend,
    };

    const mockCreateWebhook = vi.fn().mockResolvedValue(mockWebhook);
    const mockChannel = {
      parentId: "forum-race-1",
      parent: {
        fetchWebhooks: vi.fn().mockResolvedValue({ find: () => undefined, first: () => undefined }),
        createWebhook: mockCreateWebhook,
      },
    };

    const { store } = await import("../store");
    const discordModule = await import("./discord");

    store.threads = [
      {
        id: "thread-race-1",
        title: "Race test",
        appliedTags: [],
        node_id: "gh-node-race-1",
        comments: [],
        archived: false,
        locked: false,
      },
    ];
    (discordModule.default.channels.cache as Map<string, unknown>).set(
      "thread-race-1",
      mockChannel,
    );

    // Act — fire both concurrently
    const alicePromise = createComment({
      git_id: 1,
      body: "Alice",
      login: "alice",
      avatar_url: "https://example.com/alice.png",
      node_id: "gh-node-race-1",
    });
    const bobPromise = createComment({
      git_id: 2,
      body: "Bob",
      login: "bob",
      avatar_url: "https://example.com/bob.png",
      node_id: "gh-node-race-1",
    });

    // Drain all pending microtasks: Alice's task starts, createWebhook resolves,
    // send is called and resolveAliceSend is assigned — but send is still pending.
    await new Promise<void>((r) => setImmediate(r));

    // Bob's task has not started yet — Alice's send is still pending
    expect(log).not.toContain("rename-bob");
    expect(log).not.toContain("bob-send");

    // Complete Alice's send, unblocking Bob's task
    resolveAliceSend();
    await Promise.all([alicePromise, bobPromise]);

    // Assert — Bob's rename only happens after Alice's send completes
    expect(log.indexOf("alice-send")).toBeLessThan(log.indexOf("rename-bob"));
    expect(log.indexOf("rename-bob")).toBeLessThan(log.indexOf("bob-send"));
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
      parent: {
        fetchWebhooks: vi.fn().mockResolvedValue({ find: () => undefined, first: () => undefined }),
        createWebhook: mockCreateWebhook,
      },
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

  it("truncates body exceeding 2000 characters before editing", async () => {
    // Arrange — cold cache; fetchWebhooks returns a valid webhook
    const mockEditMessage = vi.fn().mockResolvedValue({});
    const mockWebhook = { applicationId: "bot-app-id", editMessage: mockEditMessage };
    const mockHooks = {
      find: vi.fn((predicate: (h: typeof mockWebhook) => boolean) =>
        predicate(mockWebhook) ? mockWebhook : undefined,
      ),
      first: vi.fn(() => mockWebhook),
    };
    const mockChannel = {
      parentId: "forum-trunc-update-1",
      parent: { fetchWebhooks: vi.fn().mockResolvedValue(mockHooks) },
    };

    const { store } = await import("../store");
    const discordModule = await import("./discord");

    store.threads = [
      {
        id: "thread-trunc-update-1",
        title: "Test",
        appliedTags: [],
        node_id: "gh-node-trunc-update-1",
        comments: [{ id: "discord-msg-trunc-edit-1", git_id: 101 }],
        archived: false,
        locked: false,
      },
    ];
    (discordModule.default.channels.cache as Map<string, unknown>).set(
      "thread-trunc-update-1",
      mockChannel,
    );

    // Act
    await updateComment({
      discord_id: "discord-msg-trunc-edit-1",
      body: "x".repeat(3000),
      node_id: "gh-node-trunc-update-1",
    });

    // Assert — content passed to editMessage must be at most 2000 chars
    const editedContent = mockEditMessage.mock.calls[0][1].content as string;
    expect([...editedContent].length).toBe(2000);
    expect(editedContent).toContain("*(truncated — see GitHub for full comment)*");
  });
});

describe("evictForumCache", () => {
  it("evicts the webhook cache so the next createComment creates a fresh webhook", async () => {
    // Arrange — prime the cache with one createComment call
    const mockSend = vi.fn().mockResolvedValue({ id: "msg-1" });
    const mockCreateWebhook = vi.fn().mockResolvedValue({ send: mockSend });
    const mockChannel = {
      parentId: "forum-evict-1",
      parent: {
        fetchWebhooks: vi.fn().mockResolvedValue({ find: () => undefined, first: () => undefined }),
        createWebhook: mockCreateWebhook,
      },
    };

    const { store } = await import("../store");
    const discordModule = await import("./discord");

    store.threads = [
      {
        id: "thread-evict-1",
        title: "Evict test",
        appliedTags: [],
        node_id: "gh-evict-1",
        comments: [],
        archived: false,
        locked: false,
      },
    ];
    (discordModule.default.channels.cache as Map<string, unknown>).set(
      "thread-evict-1",
      mockChannel,
    );

    await createComment({
      git_id: 1,
      body: "first",
      login: "alice",
      avatar_url: "a",
      node_id: "gh-evict-1",
    });
    expect(mockCreateWebhook).toHaveBeenCalledTimes(1);

    // Act — evict the cache
    evictForumCache("forum-evict-1");

    // Reset send mock so the second call gets a clean webhook
    mockSend.mockResolvedValue({ id: "msg-2" });
    mockCreateWebhook.mockResolvedValue({ send: mockSend });

    await createComment({
      git_id: 2,
      body: "second",
      login: "bob",
      avatar_url: "b",
      node_id: "gh-evict-1",
    });

    // Assert — createWebhook called again because cache was evicted
    expect(mockCreateWebhook).toHaveBeenCalledTimes(2);
  });

  it("self-evicts the queue entry once all pending tasks settle", async () => {
    // Arrange
    const mockSend = vi.fn().mockResolvedValue({ id: "msg-settle" });
    const mockCreateWebhook = vi.fn().mockResolvedValue({ send: mockSend });
    const mockChannel = {
      parentId: "forum-settle-1",
      parent: {
        fetchWebhooks: vi.fn().mockResolvedValue({ find: () => undefined, first: () => undefined }),
        createWebhook: mockCreateWebhook,
      },
    };

    const { store } = await import("../store");
    const discordModule = await import("./discord");

    store.threads = [
      {
        id: "thread-settle-1",
        title: "Settle test",
        appliedTags: [],
        node_id: "gh-settle-1",
        comments: [],
        archived: false,
        locked: false,
      },
    ];
    (discordModule.default.channels.cache as Map<string, unknown>).set(
      "thread-settle-1",
      mockChannel,
    );

    // Act — one createComment, let it fully resolve
    await createComment({
      git_id: 10,
      body: "hello",
      login: "alice",
      avatar_url: "a",
      node_id: "gh-settle-1",
    });

    // Drain any cleanup microtasks from the self-eviction .then()
    await new Promise<void>((r) => setImmediate(r));

    // Assert — evicting the now-absent queue entry is a no-op (no error thrown)
    expect(() => evictForumCache("forum-settle-1")).not.toThrow();
    // And a subsequent createComment creates a new webhook (cache was not double-evicted)
    mockSend.mockResolvedValue({ id: "msg-settle-2" });
    mockCreateWebhook.mockResolvedValue({ send: mockSend });
    await createComment({
      git_id: 11,
      body: "world",
      login: "alice",
      avatar_url: "a",
      node_id: "gh-settle-1",
    });
    expect(mockCreateWebhook).toHaveBeenCalledTimes(2);
  });
});
