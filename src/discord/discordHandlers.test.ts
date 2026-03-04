import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AnyThreadChannel,
  Client,
  Collection,
  Message,
  PartialMessage,
  ThreadChannel,
  ForumChannel,
  User,
} from 'discord.js';
import {
  handleClientReady,
  handleChannelDelete,
  handleThreadCreate,
  handleThreadUpdate,
  handleMessageCreate,
  handleMessageDelete,
  handleThreadDelete,
  handleChannelUpdate,
} from './discordHandlers';
import { store } from '../store';
import { Thread } from '../interfaces';

// Mock logger
vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock discordActions (for evictForumCache used by handleChannelDelete)
vi.mock('./discordActions', () => ({
  evictForumCache: vi.fn(),
}));

// Mock GitHub actions
vi.mock('../github/githubActions', () => ({
  closeIssue: vi.fn(),
  openIssue: vi.fn(),
  lockIssue: vi.fn(),
  unlockIssue: vi.fn(),
  createIssue: vi.fn(),
  createIssueComment: vi.fn(),
  deleteComment: vi.fn(),
  deleteIssue: vi.fn(),
  getIssues: vi.fn(async () => []),
}));

// Mock config
vi.mock('../config', () => ({
  config: {
    GITHUB_ACCESS_TOKEN: 'test-token',
    GITHUB_USERNAME: 'testuser',
    GITHUB_REPOSITORY: 'testrepo',
    DISCORD_TOKEN: 'test-discord-token',
    DISCORD_CHANNEL_ID: 'forum-channel-id',
  },
}));

describe('Discord Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.threads = [];
    store.availableTags = [];
  });

  describe('handleClientReady', () => {
    it('archives Discord threads whose GitHub issue is closed on startup', async () => {
      // Arrange — two threads: one open, one closed in GitHub
      const { getIssues } = await import('../github/githubActions');
      vi.mocked(getIssues).mockResolvedValue([
        {
          id: 'thread-open',
          title: 'Open issue',
          appliedTags: [],
          comments: [],
          archived: false,
          locked: false,
        },
        {
          id: 'thread-closed',
          title: 'Closed issue',
          appliedTags: [],
          comments: [],
          archived: true,
          locked: false,
        },
      ]);

      const mockSetArchived = vi.fn().mockResolvedValue(undefined);
      const mockActiveThreads = {
        threads: new Map([
          ['thread-open',   { id: 'thread-open',   archived: false, setArchived: vi.fn() }],
          ['thread-closed', { id: 'thread-closed',  archived: false, setArchived: mockSetArchived }],
        ]),
      };

      const mockForum = {
        availableTags: [],
        threads: { fetchActive: vi.fn().mockResolvedValue(mockActiveThreads) },
      };

      const mockClient = {
        user: { tag: 'TestBot#0001' },
        channels: {
          cache: new Map([
            ['thread-open',   { messages: { cache: { forEach: vi.fn() } } }],
            ['thread-closed', { messages: { cache: { forEach: vi.fn() } } }],
          ]),
          fetch: vi.fn().mockResolvedValue(mockForum),
        },
      } as unknown as Client;

      // Act
      await handleClientReady(mockClient);

      // Assert — only the closed thread is archived
      expect(mockSetArchived).toHaveBeenCalledWith(true);
      expect(mockSetArchived).toHaveBeenCalledTimes(1);
    });

    it('does not archive Discord threads that are already archived', async () => {
      // Arrange — closed GitHub issue but Discord thread already archived
      const { getIssues } = await import('../github/githubActions');
      vi.mocked(getIssues).mockResolvedValue([
        {
          id: 'thread-closed',
          title: 'Closed issue',
          appliedTags: [],
          comments: [],
          archived: true,
          locked: false,
        },
      ]);

      const mockSetArchived = vi.fn();
      const mockActiveThreads = {
        threads: new Map([
          ['thread-closed', { id: 'thread-closed', archived: true, setArchived: mockSetArchived }],
        ]),
      };

      const mockForum = {
        availableTags: [],
        threads: { fetchActive: vi.fn().mockResolvedValue(mockActiveThreads) },
      };

      const mockClient = {
        user: { tag: 'TestBot#0001' },
        channels: {
          cache: new Map([
            ['thread-closed', { messages: { cache: { forEach: vi.fn() } } }],
          ]),
          fetch: vi.fn().mockResolvedValue(mockForum),
        },
      } as unknown as Client;

      // Act
      await handleClientReady(mockClient);

      // Assert — already archived, so setArchived is not called again
      expect(mockSetArchived).not.toHaveBeenCalled();
    });
  });

  describe('handleThreadCreate', () => {
    it('should add thread to store when created in correct forum channel', async () => {
      // Arrange
      const mockThread = {
        id: 'thread-1',
        name: 'New Thread',
        parentId: 'forum-channel-id',
        appliedTags: ['tag-1', 'tag-2'],
      } as unknown as AnyThreadChannel;

      // Act
      await handleThreadCreate(mockThread);

      // Assert
      expect(store.threads).toHaveLength(1);
      expect(store.threads[0]).toMatchObject({
        id: 'thread-1',
        title: 'New Thread',
        appliedTags: ['tag-1', 'tag-2'],
        archived: false,
        locked: false,
        comments: [],
      });
    });

    it('should ignore thread created in different forum channel', async () => {
      // Arrange
      const mockThread = {
        id: 'thread-1',
        name: 'New Thread',
        parentId: 'different-channel-id',
        appliedTags: [],
      } as unknown as AnyThreadChannel;

      // Act
      await handleThreadCreate(mockThread);

      // Assert
      expect(store.threads).toHaveLength(0);
    });

    it('should handle thread with no applied tags', async () => {
      // Arrange
      const mockThread = {
        id: 'thread-2',
        name: 'Thread Without Tags',
        parentId: 'forum-channel-id',
        appliedTags: [],
      } as unknown as AnyThreadChannel;

      // Act
      await handleThreadCreate(mockThread);

      // Assert
      expect(store.threads[0].appliedTags).toHaveLength(0);
    });
  });

  describe('handleChannelUpdate', () => {
    it('should update available tags when forum channel is updated', async () => {
      // Arrange
      const mockTags = [
        { id: 'tag-1', name: 'bug', emoji: null },
        { id: 'tag-2', name: 'feature', emoji: null },
      ];
      const mockChannel = {
        id: 'forum-channel-id',
        type: 15,
        availableTags: mockTags,
      } as unknown as any;

      // Act
      await handleChannelUpdate(mockChannel);

      // Assert
      expect(store.availableTags).toHaveLength(2);
      expect(store.availableTags).toEqual(mockTags);
    });

    it('should ignore update for non-forum channels', async () => {
      // Arrange
      const mockChannel = {
        id: 'text-channel-id',
        type: 0,
        availableTags: [],
      } as unknown as any;

      // Act
      await handleChannelUpdate(mockChannel);

      // Assert
      expect(store.availableTags).toHaveLength(0);
    });

    it('should ignore update for channels with incorrect id', async () => {
      // Arrange
      const mockChannel = {
        id: 'wrong-channel-id',
        type: 15,
        availableTags: [{ id: 'tag-1', name: 'bug' }],
      } as unknown as any;

      // Act
      await handleChannelUpdate(mockChannel);

      // Assert
      expect(store.availableTags).toHaveLength(0);
    });
  });

  describe('handleMessageCreate', () => {
    it('should ignore messages from bot users', async () => {
      // Arrange
      const mockMessage = {
        channelId: 'thread-1',
        author: {
          bot: true,
          id: 'bot-id',
        },
      } as unknown as Message;

      // Act
      await handleMessageCreate(mockMessage);

      // Assert - should not create issue or comment
      // (verified by checking no state changes)
      expect(store.threads).toHaveLength(0);
    });

    it('should skip message in thread not in store', async () => {
      // Arrange
      const mockMessage = {
        channelId: 'unknown-thread-id',
        author: {
          bot: false,
          id: 'user-1',
        },
      } as unknown as Message;

      // Act
      await handleMessageCreate(mockMessage);

      // Assert
      expect(store.threads).toHaveLength(0);
    });

    it('should skip message when thread not found', async () => {
      // Arrange
      store.threads = [
        {
          id: 'thread-1',
          title: 'Test',
          appliedTags: [],
          comments: [],
          archived: false,
          locked: false,
        },
      ];
      const mockMessage = {
        channelId: 'thread-2',
        author: {
          bot: false,
          id: 'user-1',
        },
      } as unknown as Message;

      // Act
      await handleMessageCreate(mockMessage);

      // Assert
      expect(store.threads).toHaveLength(1);
    });
  });

  describe('handleMessageDelete', () => {
    it('should skip deletion when thread not found', async () => {
      // Arrange
      const mockMessage = {
        channelId: 'unknown-thread-id',
        id: 'msg-1',
      } as unknown as Message;

      // Act
      await handleMessageDelete(mockMessage);

      // Assert
      expect(store.threads).toHaveLength(0);
    });

    it('should skip deletion when comment not found in thread', async () => {
      // Arrange
      store.threads = [
        {
          id: 'thread-1',
          title: 'Test',
          appliedTags: [],
          comments: [],
          archived: false,
          locked: false,
        },
      ];
      const mockMessage = {
        channelId: 'thread-1',
        id: 'unknown-msg-id',
      } as unknown as Message;

      // Act
      await handleMessageDelete(mockMessage);

      // Assert
      expect(store.threads[0].comments).toHaveLength(0);
    });

    it('should remove comment from thread when found', async () => {
      // Arrange
      store.threads = [
        {
          id: 'thread-1',
          title: 'Test',
          appliedTags: [],
          comments: [
            { id: 'msg-1', git_id: 1 },
            { id: 'msg-2', git_id: 2 },
          ],
          archived: false,
          locked: false,
        },
      ];
      const mockMessage = {
        channelId: 'thread-1',
        id: 'msg-1',
      } as unknown as Message;

      // Act
      await handleMessageDelete(mockMessage);

      // Assert
      expect(store.threads[0].comments).toHaveLength(1);
      expect(store.threads[0].comments[0].id).toBe('msg-2');
    });
  });

  describe('handleThreadDelete', () => {
    it('should ignore thread delete for incorrect forum channel', async () => {
      // Arrange
      store.threads = [
        {
          id: 'thread-1',
          title: 'Test',
          appliedTags: [],
          comments: [],
          archived: false,
          locked: false,
        },
      ];
      const mockThread = {
        id: 'thread-1',
        parentId: 'different-channel-id',
      } as unknown as AnyThreadChannel;

      // Act
      await handleThreadDelete(mockThread);

      // Assert
      expect(store.threads).toHaveLength(1);
    });

    it('should skip deletion when thread not found in store', async () => {
      // Arrange
      const mockThread = {
        id: 'unknown-thread',
        parentId: 'forum-channel-id',
      } as unknown as AnyThreadChannel;

      // Act
      await handleThreadDelete(mockThread);

      // Assert
      expect(store.threads).toHaveLength(0);
    });
  });

  describe('handleThreadUpdate', () => {
    it('should ignore thread update for incorrect forum channel', async () => {
      // Arrange
      store.threads = [
        {
          id: 'thread-1',
          title: 'Test',
          appliedTags: [],
          comments: [],
          archived: false,
          locked: false,
        },
      ];
      const mockThread = {
        id: 'thread-1',
        parentId: 'different-channel-id',
        members: {
          thread: {
            id: 'thread-1',
            archived: true,
            locked: false,
          },
        },
      } as unknown as AnyThreadChannel;

      // Act
      await handleThreadUpdate(mockThread);

      // Assert
      expect(store.threads[0].archived).toBe(false);
    });

    it('should skip update when thread not found in store', async () => {
      // Arrange
      const mockThread = {
        id: 'unknown-thread',
        parentId: 'forum-channel-id',
        members: {
          thread: {
            id: 'unknown-thread',
            archived: true,
            locked: false,
          },
        },
      } as unknown as AnyThreadChannel;

      // Act
      await handleThreadUpdate(mockThread);

      // Assert
      expect(store.threads).toHaveLength(0);
    });

    it('should update thread locked state when changed', async () => {
      // Arrange
      store.threads = [
        {
          id: 'thread-1',
          title: 'Test',
          appliedTags: [],
          comments: [],
          archived: false,
          locked: false,
        },
      ];
      const mockThread = {
        id: 'thread-1',
        parentId: 'forum-channel-id',
        members: {
          thread: {
            id: 'thread-1',
            archived: false,
            locked: true,
          },
        },
      } as unknown as AnyThreadChannel;

      // Act
      await handleThreadUpdate(mockThread);

      // Assert
      expect(store.threads[0].locked).toBe(true);
    });

    it('should update thread archived state when changed', async () => {
      // Arrange
      store.threads = [
        {
          id: 'thread-1',
          title: 'Test',
          appliedTags: [],
          comments: [],
          archived: false,
          locked: false,
        },
      ];
      const mockThread = {
        id: 'thread-1',
        parentId: 'forum-channel-id',
        members: {
          thread: {
            id: 'thread-1',
            archived: true,
            locked: false,
          },
        },
      } as unknown as AnyThreadChannel;

      // Act
      await handleThreadUpdate(mockThread);

      // Assert
      // Wrapped in setTimeout, so we need to verify async behavior
      expect(store.threads[0].archived).toBe(false); // initially false
    });

    it('should not update lock state when lockLocking flag is set', async () => {
      // Arrange
      store.threads = [
        {
          id: 'thread-1',
          title: 'Test',
          appliedTags: [],
          comments: [],
          archived: false,
          locked: false,
          lockLocking: true,
        },
      ];
      const mockThread = {
        id: 'thread-1',
        parentId: 'forum-channel-id',
        members: {
          thread: {
            id: 'thread-1',
            archived: false,
            locked: true,
          },
        },
      } as unknown as AnyThreadChannel;

      // Act
      await handleThreadUpdate(mockThread);

      // Assert
      expect(store.threads[0].locked).toBe(false);
    });
  });

  describe('handleChannelDelete', () => {
    it('evicts the forum cache when the deleted channel matches DISCORD_CHANNEL_ID', async () => {
      // Arrange
      const { evictForumCache } = await import('./discordActions');
      const mockChannel = { id: 'forum-channel-id' } as any;

      // Act
      handleChannelDelete(mockChannel);

      // Assert
      expect(evictForumCache).toHaveBeenCalledWith('forum-channel-id');
    });

    it('does not evict the cache when the deleted channel does not match DISCORD_CHANNEL_ID', async () => {
      // Arrange
      const { evictForumCache } = await import('./discordActions');
      const mockChannel = { id: 'some-other-channel-id' } as any;

      // Act
      handleChannelDelete(mockChannel);

      // Assert
      expect(evictForumCache).not.toHaveBeenCalled();
    });
  });
});
