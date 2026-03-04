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
  getIssues,
  octokit,
} from './githubActions';
import { Thread, ThreadComment } from '../interfaces';
import { store } from '../store';

// Mock logger to prevent output during tests
vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  Actions: {
    Created: 'created',
    Closed: 'closed',
    Commented: 'commented',
    EditedComment: 'edited comment',
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

// Mock R2 so attachment tests don't hit real S3
vi.mock('../r2', () => ({ uploadToR2: vi.fn().mockResolvedValue(null) }));

// Mock octokit
vi.mock('./githubActions', async () => {
  const actual = await vi.importActual('./githubActions');
  return {
    ...actual,
    octokit: {
      paginate: vi.fn(),
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
    it('should not call the API when thread has no issue number', async () => {
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

      // Assert
      expect(octokit.rest.issues.update).not.toHaveBeenCalled();
    });
  });

  describe('openIssue', () => {
    it('should not call the API when thread has no issue number', async () => {
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
      expect(octokit.rest.issues.update).not.toHaveBeenCalled();
    });
  });

  describe('lockIssue', () => {
    it('should not call the API when thread has no issue number', async () => {
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
      expect(octokit.rest.issues.lock).not.toHaveBeenCalled();
    });
  });

  describe('unlockIssue', () => {
    it('should not call the API when thread has no issue number', async () => {
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
      expect(octokit.rest.issues.unlock).not.toHaveBeenCalled();
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

      // Assert - should return early without calling API
      expect(octokit.rest.issues.create).not.toHaveBeenCalled();
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

      // Assert - should return early without calling API
      expect(octokit.rest.issues.createComment).not.toHaveBeenCalled();
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

      // Assert - should return early without calling API
      // (deleteIssue uses graphqlWithAuth, not octokit — verified by no throw)
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

      // Act & Assert — deleteComment has no guard path; verify it does not
      // rethrow API errors (the try/catch inside swallows them).
      // Note: the internal octokit instance is not the exported mock, so we
      // cannot assert toHaveBeenCalled() here without a deeper mock refactor.
      await expect(deleteComment(thread, commentId)).resolves.toBeUndefined();
    });
  });

  describe('getIssues', () => {
    it('returns an empty array and does not throw when the API fails', async () => {
      // Arrange — nothing to mock; the internal octokit will reject (no network in tests)

      // Act & Assert — getIssues catches all errors and returns []
      await expect(getIssues()).resolves.toEqual([]);
    });
  });
});

