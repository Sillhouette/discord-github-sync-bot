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
} from './githubActions';
import { Thread, ThreadComment } from '../interfaces';
import { threadRepository } from '../store';

// Hoisted mock instance — must be declared before vi.mock factories run.
// Mocking @octokit/rest at the constructor level so the module-internal
// `octokit` variable (used by getIssues, deleteComment, etc.) is the same
// mock object that test assertions reference.
const mockOctokit = vi.hoisted(() => ({
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
}));

vi.mock('@octokit/rest', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  Octokit: vi.fn().mockImplementation(function () { return mockOctokit; }),
}));

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

describe('GitHub Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    threadRepository.clear();
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
      expect(mockOctokit.rest.issues.update).not.toHaveBeenCalled();
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
      expect(mockOctokit.rest.issues.update).not.toHaveBeenCalled();
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
      expect(mockOctokit.rest.issues.lock).not.toHaveBeenCalled();
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
      expect(mockOctokit.rest.issues.unlock).not.toHaveBeenCalled();
    });
  });

  describe('createIssue', () => {
    it('strips Markdown image syntax from Discord message content before posting to GitHub', async () => {
      // Arrange — Discord user embeds an image URL in their message body.
      // Without filtering, GitHub renders it and makes an outbound request to the URL.
      const thread: Thread = {
        id: 'thread-1',
        title: 'Test Issue',
        appliedTags: [],
        comments: [],
        archived: false,
        locked: false,
      };
      mockOctokit.rest.issues.create.mockResolvedValueOnce({ data: { number: 1, node_id: 'node-1' } });
      const mockMessage = {
        guildId: '123',
        channelId: 'thread-1',
        id: 'msg-1',
        content: 'Here is a tracking pixel: ![tracker](https://evil.com/pixel.gif) and a normal message.',
        author: { bot: false, id: 'user-1', globalName: 'TestUser', avatar: 'avatar-hash' },
        attachments: new Collection(),
      } as unknown as Message;

      // Act
      await createIssue(thread, mockMessage);

      // Assert — the GitHub issue body must not contain the unsafe image URL
      const callArgs = mockOctokit.rest.issues.create.mock.calls[0][0];
      expect(callArgs.body).not.toContain('https://evil.com/pixel.gif');
      expect(callArgs.body).not.toContain('![tracker]');
      expect(callArgs.body).toContain('Here is a tracking pixel:');
    });

    it('strips HTML img tags from Discord message content before posting to GitHub', async () => {
      // Arrange
      const thread: Thread = {
        id: 'thread-2',
        title: 'Test Issue 2',
        appliedTags: [],
        comments: [],
        archived: false,
        locked: false,
      };
      mockOctokit.rest.issues.create.mockResolvedValueOnce({ data: { number: 2, node_id: 'node-2' } });
      const mockMessage = {
        guildId: '123',
        channelId: 'thread-2',
        id: 'msg-2',
        content: 'Bug report <img src="https://attacker.com/spy.png"/> details here.',
        author: { bot: false, id: 'user-1', globalName: 'TestUser', avatar: 'avatar-hash' },
        attachments: new Collection(),
      } as unknown as Message;

      // Act
      await createIssue(thread, mockMessage);

      // Assert
      const callArgs = mockOctokit.rest.issues.create.mock.calls[0][0];
      expect(callArgs.body).not.toContain('https://attacker.com/spy.png');
      expect(callArgs.body).not.toContain('<img');
      expect(callArgs.body).toContain('Bug report');
    });

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
      expect(mockOctokit.rest.issues.create).not.toHaveBeenCalled();
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
      expect(mockOctokit.rest.issues.createComment).not.toHaveBeenCalled();
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
      mockOctokit.rest.issues.deleteComment.mockResolvedValue({});

      // Act
      await deleteComment(thread, commentId);

      // Assert
      expect(mockOctokit.rest.issues.deleteComment).toHaveBeenCalledWith(
        expect.objectContaining({ comment_id: commentId }),
      );
    });
  });

  describe('getIssues', () => {
    it('returns threads for all paginated issues, marking closed ones as archived', async () => {
      // Arrange — Discord URLs must use numeric snowflake IDs (regex: /\d+\/\d+\/\d+/)
      const openLink   = '<kbd>[![u](a)](https://discord.com/channels/111/222000001/333000001)</kbd>';
      const closedLink = '<kbd>[![u](a)](https://discord.com/channels/111/222000002/333000002)</kbd>';
      mockOctokit.paginate
        .mockResolvedValueOnce([
          // first call: listForRepo
          { title: 'Open',   body: openLink,   number: 1, node_id: 'n1', locked: false, state: 'open'   },
          { title: 'Closed', body: closedLink, number: 2, node_id: 'n2', locked: false, state: 'closed' },
        ])
        .mockResolvedValueOnce([]); // second call: listCommentsForRepo

      // Act
      const threads = await getIssues();

      // Assert
      expect(threads).toHaveLength(2);
      expect(threads.find((t) => t.id === '333000001')?.archived).toBe(false);
      expect(threads.find((t) => t.id === '333000002')?.archived).toBe(true);
    });

    it('calls paginate with listForRepo and listCommentsForRepo (not listForRepo directly)', async () => {
      // Arrange
      mockOctokit.paginate.mockResolvedValue([]);

      // Act
      await getIssues();

      // Assert — paginate called twice (issues + comments); direct listForRepo never called
      expect(mockOctokit.paginate).toHaveBeenCalledTimes(2);
      expect(mockOctokit.paginate).toHaveBeenCalledWith(
        mockOctokit.rest.issues.listForRepo,
        expect.objectContaining({ state: 'all', per_page: 100 }),
      );
      expect(mockOctokit.paginate).toHaveBeenCalledWith(
        mockOctokit.rest.issues.listCommentsForRepo,
        expect.objectContaining({ per_page: 100 }),
      );
      expect(mockOctokit.rest.issues.listForRepo).not.toHaveBeenCalled();
    });

    it('populates thread.comments from GitHub comment data', async () => {
      // Arrange — one issue with a matching comment; verifies fillCommentsData
      // runs AFTER formatIssuesToThreads so the thread exists when comments are matched.
      //
      // Discord forum posts: the thread channel ID and initial message ID are the
      // same value, so the issue URL has format channels/{guild}/{threadId}/{threadId}.
      // fillCommentsData matches threads by the channelId (2nd segment) of the
      // comment URL, which must equal the thread.id set from the issue URL's 3rd segment.
      const threadId    = '777000001';
      const issueLink   = `<kbd>[![u](a)](https://discord.com/channels/111/${threadId}/${threadId})</kbd>`;
      const commentLink = `<kbd>[![u](a)](https://discord.com/channels/111/${threadId}/888000001)</kbd>`;
      mockOctokit.paginate
        .mockResolvedValueOnce([
          { title: 'Issue', body: issueLink, number: 1, node_id: 'n1', locked: false, state: 'open' },
        ])
        .mockResolvedValueOnce([
          { id: 42, body: `comment text ${commentLink}` },
        ]);

      // Act
      const threads = await getIssues();

      // Assert — thread has one comment mapped from the GitHub comment id
      expect(threads).toHaveLength(1);
      expect(threads[0].comments).toHaveLength(1);
      expect(threads[0].comments[0]).toEqual({ id: '888000001', git_id: 42 });
    });

    it('returns an empty array and does not throw when paginate rejects', async () => {
      // Arrange
      mockOctokit.paginate.mockRejectedValue(new Error('network error'));

      // Act & Assert
      await expect(getIssues()).resolves.toEqual([]);
    });
  });
});
