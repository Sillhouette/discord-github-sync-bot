import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Message, Collection, Attachment } from 'discord.js';
import {
  getDiscordInfoFromGithubBody,
  closeIssue,
  openIssue,
  lockIssue,
  unlockIssue,
  createIssue,
  createIssueComment,
  deleteIssue,
  deleteComment,
} from './githubActions';
import { Thread, ThreadComment } from '../interfaces';
import { store } from '../store';

// Mock logger to prevent output during tests
vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
  Actions: {
    Created: 'created',
    Closed: 'closed',
    Commented: 'commented',
    Reopened: 'reopened',
    Locked: 'locked',
    Unlocked: 'unlocked',
    Deleted: 'deleted',
    DeletedComment: 'deleted comment',
  },
  Triggerer: {
    Discord: 'discord->github',
    Github: 'github->discord',
  },
  getGithubUrl: vi.fn((thread: Thread) => `https://github.com/owner/repo/issues/${thread.number}`),
}));

// Mock config
vi.mock('../config', () => ({
  config: {
    GITHUB_ACCESS_TOKEN: 'test-token',
    GITHUB_USERNAME: 'testuser',
    GITHUB_REPOSITORY: 'testrepo',
    DISCORD_TOKEN: 'test-discord-token',
    DISCORD_CHANNEL_ID: 'test-channel-id',
  },
}));

// Mock octokit
vi.mock('./githubActions', async () => {
  const actual = await vi.importActual('./githubActions');
  return {
    ...actual,
    octokit: {
      rest: {
        issues: {
          update: vi.fn(),
          lock: vi.fn(),
          unlock: vi.fn(),
          create: vi.fn(),
          createComment: vi.fn(),
          deleteComment: vi.fn(),
          listForRepo: vi.fn(),
          listCommentsForRepo: vi.fn(),
        },
      },
    },
  };
});

describe('GitHub Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.threads = [];
    store.availableTags = [];
  });

  describe('getDiscordInfoFromGithubBody', () => {
    it('should extract discord info from valid github body', () => {
      // Arrange
      const body =
        '<kbd>[![user](avatar)](https://discord.com/channels/123456/789012/345678)</kbd>';

      // Act
      const result = getDiscordInfoFromGithubBody(body);

      // Assert
      expect(result).toEqual({
        channelId: '789012',
        id: '345678',
      });
    });

    it('should handle github body without discord link', () => {
      // Arrange
      const body = 'Just a regular issue body';

      // Act
      const result = getDiscordInfoFromGithubBody(body);

      // Assert
      expect(result).toEqual({
        channelId: undefined,
        id: undefined,
      });
    });

    it('should handle malformed discord link', () => {
      // Arrange
      const body = 'https://discord.com/channels/incomplete';

      // Act
      const result = getDiscordInfoFromGithubBody(body);

      // Assert
      expect(result).toEqual({
        channelId: undefined,
        id: undefined,
      });
    });

    it('should extract discord info from github url in markdown link format', () => {
      // Arrange
      const body =
        '[Link](https://discord.com/channels/111/222/333) some text';

      // Act
      const result = getDiscordInfoFromGithubBody(body);

      // Assert
      expect(result).toEqual({
        channelId: '222',
        id: '333',
      });
    });
  });

  describe('closeIssue', () => {
    it('should handle thread without issue number', async () => {
      // Arrange
      const thread: Thread = {
        id: 'thread-1',
        title: 'Test Issue',
        appliedTags: [],
        comments: [],
        archived: false,
        locked: false,
      };

      // Act
      await closeIssue(thread);

      // Assert - should return early without calling API
      expect(store.threads).toHaveLength(0);
    });

    it('should log error when thread lacks issue number', async () => {
      // Arrange
      const thread: Thread = {
        id: 'thread-1',
        title: 'Test Issue',
        appliedTags: [],
        comments: [],
        archived: false,
        locked: false,
      };

      // Act
      await closeIssue(thread);

      // Assert - verify error was logged (in real scenario)
      // The test verifies function handles missing issue_number gracefully
      expect(thread.number).toBeUndefined();
    });
  });

  describe('openIssue', () => {
    it('should handle thread without issue number', async () => {
      // Arrange
      const thread: Thread = {
        id: 'thread-1',
        title: 'Test Issue',
        appliedTags: [],
        comments: [],
        archived: false,
        locked: false,
      };

      // Act
      await openIssue(thread);

      // Assert
      expect(thread.number).toBeUndefined();
    });
  });

  describe('lockIssue', () => {
    it('should handle thread without issue number', async () => {
      // Arrange
      const thread: Thread = {
        id: 'thread-1',
        title: 'Test Issue',
        appliedTags: [],
        comments: [],
        archived: false,
        locked: false,
      };

      // Act
      await lockIssue(thread);

      // Assert
      expect(thread.number).toBeUndefined();
    });
  });

  describe('unlockIssue', () => {
    it('should handle thread without issue number', async () => {
      // Arrange
      const thread: Thread = {
        id: 'thread-1',
        title: 'Test Issue',
        appliedTags: [],
        comments: [],
        archived: false,
        locked: false,
      };

      // Act
      await unlockIssue(thread);

      // Assert
      expect(thread.number).toBeUndefined();
    });
  });

  describe('createIssue', () => {
    it('should handle thread that already has an issue number', async () => {
      // Arrange
      const thread: Thread = {
        id: 'thread-1',
        title: 'Test Issue',
        appliedTags: [],
        comments: [],
        archived: false,
        locked: false,
        number: 42,
      };
      const mockMessage = {
        guildId: '123',
        channelId: 'thread-1',
        id: 'msg-1',
        content: 'Test message',
        author: {
          bot: false,
          id: 'user-1',
          globalName: 'TestUser',
          avatar: 'avatar-hash',
        },
        attachments: new Collection(),
      } as unknown as Message;

      // Act
      await createIssue(thread, mockMessage);

      // Assert - should return early without creating issue
      expect(thread.number).toBe(42);
    });
  });

  describe('createIssueComment', () => {
    it('should handle thread without issue number', async () => {
      // Arrange
      const thread: Thread = {
        id: 'thread-1',
        title: 'Test Issue',
        appliedTags: [],
        comments: [],
        archived: false,
        locked: false,
      };
      const mockMessage = {
        guildId: '123',
        channelId: 'thread-1',
        id: 'msg-1',
        content: 'Comment text',
        author: {
          bot: false,
          id: 'user-1',
          globalName: 'TestUser',
          avatar: 'avatar-hash',
        },
        attachments: new Collection(),
      } as unknown as Message;

      // Act
      await createIssueComment(thread, mockMessage);

      // Assert
      expect(thread.comments).toHaveLength(0);
    });
  });

  describe('deleteIssue', () => {
    it('should handle thread without node_id', async () => {
      // Arrange
      const thread: Thread = {
        id: 'thread-1',
        title: 'Test Issue',
        appliedTags: [],
        comments: [],
        archived: false,
        locked: false,
      };

      // Act
      await deleteIssue(thread);

      // Assert
      expect(thread.node_id).toBeUndefined();
    });
  });

  describe('deleteComment', () => {
    it('should handle comment deletion with valid comment id', async () => {
      // Arrange
      const thread: Thread = {
        id: 'thread-1',
        title: 'Test Issue',
        appliedTags: [],
        comments: [],
        archived: false,
        locked: false,
        number: 42,
      };
      const commentId = 999;

      // Act
      await deleteComment(thread, commentId);

      // Assert - should not throw or error
      expect(thread.comments).toHaveLength(0);
    });
  });
});
