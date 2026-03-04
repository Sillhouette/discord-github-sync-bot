import { describe, it, expect, beforeEach, vi } from "vitest";
import { Request } from "express";
import { handleCreated, handleEdited } from "./githubHandlers";
import { store } from "../store";

// Mock logger to prevent output during tests
vi.mock("../logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock discord actions
vi.mock("../discord/discordActions", () => ({
  archiveThread: vi.fn(),
  createComment: vi.fn(),
  createThread: vi.fn(),
  deleteThread: vi.fn(),
  lockThread: vi.fn(),
  unarchiveThread: vi.fn(),
  unlockThread: vi.fn(),
  updateComment: vi.fn(),
}));

// Mock github actions
vi.mock("./githubActions", () => ({
  getDiscordInfoFromGithubBody: vi.fn((body: string) => {
    const match = body.match(
      /https:\/\/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)(?=\))/,
    );
    if (!match || match.length !== 4) return { channelId: undefined, id: undefined };
    const [, , channelId, id] = match;
    return { channelId, id };
  }),
}));

vi.mock("../config", () => ({
  config: {
    GITHUB_ACCESS_TOKEN: "test-token",
    GITHUB_USERNAME: "testuser",
    GITHUB_REPOSITORY: "testrepo",
    DISCORD_TOKEN: "test-discord-token",
    DISCORD_CHANNEL_ID: "test-channel-id",
  },
}));

describe("handleCreated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.threads = [];
    store.availableTags = [];
  });

  it("should skip comments that contain a Discord URL (bot-originated)", async () => {
    // Arrange
    const { createComment } = await import("../discord/discordActions");
    const req = {
      body: {
        comment: {
          id: 200,
          body: "<kbd>[![user](avatar)](https://discord.com/channels/111/222/333)</kbd>",
          user: { login: "discord-bot", avatar_url: "https://example.com/avatar.png", type: "Bot" },
        },
        issue: { node_id: "issue-node-1" },
      },
    } as unknown as Request;

    // Act
    await handleCreated(req);

    // Assert
    expect(createComment).not.toHaveBeenCalled();
  });

  it("should call createComment with correct params for non-bot comments", async () => {
    // Arrange
    const { createComment } = await import("../discord/discordActions");
    const req = {
      body: {
        comment: {
          id: 201,
          body: "A normal GitHub comment",
          user: { login: "github-user", avatar_url: "https://example.com/avatar.png", type: "User" },
        },
        issue: { node_id: "issue-node-2" },
      },
    } as unknown as Request;

    // Act
    await handleCreated(req);

    // Assert
    expect(createComment).toHaveBeenCalledWith({
      git_id: 201,
      body: "A normal GitHub comment",
      login: "github-user",
      avatar_url: "https://example.com/avatar.png",
      node_id: "issue-node-2",
    });
  });
});

describe("handleEdited", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.threads = [];
    store.availableTags = [];
  });

  it("should skip when req.body.comment is absent (issues.edited event)", async () => {
    // Arrange
    const { updateComment } = await import("../discord/discordActions");
    const req = {
      body: {
        issue: { node_id: "issue-node-1" },
        // no comment field — this is an issues.edited event, not issue_comment.edited
      },
    } as unknown as Request;

    // Act
    await handleEdited(req);

    // Assert
    expect(updateComment).not.toHaveBeenCalled();
  });

  it("should skip comments that originated from the Discord bot", async () => {
    // Arrange
    const { updateComment } = await import("../discord/discordActions");
    const req = {
      body: {
        comment: {
          id: 123,
          body: "<kbd>[![user](avatar)](https://discord.com/channels/111/222/333)</kbd>",
          user: { login: "discord-bot" },
        },
        issue: { node_id: "issue-node-1" },
      },
    } as unknown as Request;

    // Act
    await handleEdited(req);

    // Assert
    expect(updateComment).not.toHaveBeenCalled();
  });

  it("should skip when thread is not found in store", async () => {
    // Arrange
    const { updateComment } = await import("../discord/discordActions");
    store.threads = [];
    const req = {
      body: {
        comment: { id: 123, body: "Updated comment text", user: { login: "github-user" } },
        issue: { node_id: "nonexistent-node" },
      },
    } as unknown as Request;

    // Act
    await handleEdited(req);

    // Assert
    expect(updateComment).not.toHaveBeenCalled();
  });

  it("should skip when comment not found in thread", async () => {
    // Arrange
    const { updateComment } = await import("../discord/discordActions");
    store.threads = [
      {
        id: "discord-thread-1",
        title: "Test",
        appliedTags: [],
        comments: [{ id: "discord-msg-1", git_id: 999 }],
        archived: false,
        locked: false,
        node_id: "issue-node-1",
      },
    ];
    const req = {
      body: {
        comment: { id: 123, body: "Updated comment text", user: { login: "github-user" } },
        issue: { node_id: "issue-node-1" },
      },
    } as unknown as Request;

    // Act
    await handleEdited(req);

    // Assert
    expect(updateComment).not.toHaveBeenCalled();
  });

  it("should call updateComment with correct params when comment is found", async () => {
    // Arrange
    const { updateComment } = await import("../discord/discordActions");
    store.threads = [
      {
        id: "discord-thread-1",
        title: "Test",
        appliedTags: [],
        comments: [{ id: "discord-msg-42", git_id: 123 }],
        archived: false,
        locked: false,
        node_id: "issue-node-1",
      },
    ];
    const req = {
      body: {
        comment: { id: 123, body: "Updated comment text", user: { login: "github-user" } },
        issue: { node_id: "issue-node-1" },
      },
    } as unknown as Request;

    // Act
    await handleEdited(req);

    // Assert
    expect(updateComment).toHaveBeenCalledWith({
      discord_id: "discord-msg-42",
      body: "Updated comment text",
      node_id: "issue-node-1",
    });
  });
});
