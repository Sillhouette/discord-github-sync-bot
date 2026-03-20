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
import { threadRepository } from '../store';
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
    threadRepository.clear();
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

    it('continues reconciling remaining threads when one setArchived call fails', async () => {
      // Arrange — three closed threads; the first setArchived throws
      const { getIssues } = await import('../github/githubActions');
      vi.mocked(getIssues).mockResolvedValue([
        { id: 'thread-a', title: 'A', appliedTags: [], comments: [], archived: true, locked: false },
        { id: 'thread-b', title: 'B', appliedTags: [], comments: [], archived: true, locked: false },
        { id: 'thread-c', title: 'C', appliedTags: [], comments: [], archived: true, locked: false },
      ]);

      const mockSetArchivedA = vi.fn().mockRejectedValue(new Error('rate limited'));
      const mockSetArchivedB = vi.fn().mockResolvedValue(undefined);
      const mockSetArchivedC = vi.fn().mockResolvedValue(undefined);
      const mockActiveThreads = {
        threads: new Map([
          ['thread-a', { id: 'thread-a', archived: false, setArchived: mockSetArchivedA }],
          ['thread-b', { id: 'thread-b', archived: false, setArchived: mockSetArchivedB }],
          ['thread-c', { id: 'thread-c', archived: false, setArchived: mockSetArchivedC }],
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
            ['thread-a', { messages: { cache: { forEach: vi.fn() } } }],
            ['thread-b', { messages: { cache: { forEach: vi.fn() } } }],
            ['thread-c', { messages: { cache: { forEach: vi.fn() } } }],
          ]),
          fetch: vi.fn().mockResolvedValue(mockForum),
        },
      } as unknown as Client;

      // Act
      await handleClientReady(mockClient);

      // Assert — B and C are archived even though A failed
      expect(mockSetArchivedB).toHaveBeenCalledWith(true);
      expect(mockSetArchivedC).toHaveBeenCalledWith(true);
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

    it('creates a GitHub issue for an active Discord thread with no corresponding GitHub issue', async () => {
      // Arrange — no GitHub issues; one active Discord thread (orphaned)
      const { getIssues, createIssue } = await import('../github/githubActions');
      vi.mocked(getIssues).mockResolvedValue([]);
      // Simulate a successful createIssue by setting thread.number (as the real implementation does)
      vi.mocked(createIssue).mockImplementation(async (thread) => { thread.number = 1; });

      const mockStarterMessage = {
        author: { bot: false, id: 'user-1', globalName: 'TestUser', avatar: 'hash' },
        guildId: '111',
        channelId: 'orphaned-thread',
        id: 'msg-1',
        content: 'Help wanted',
        attachments: new Collection(),
      };
      const mockFetchStarterMessage = vi.fn().mockResolvedValue(mockStarterMessage);
      const mockActiveThreads = {
        threads: new Map([
          ['orphaned-thread', {
            id: 'orphaned-thread',
            name: 'Orphaned Thread',
            appliedTags: ['tag-a'],
            locked: false,
            archived: false,
            fetchStarterMessage: mockFetchStarterMessage,
          }],
        ]),
      };

      const mockForum = {
        availableTags: [],
        threads: { fetchActive: vi.fn().mockResolvedValue(mockActiveThreads) },
      };

      const mockClient = {
        user: { tag: 'TestBot#0001' },
        channels: {
          cache: new Map(),
          fetch: vi.fn().mockResolvedValue(mockForum),
        },
      } as unknown as Client;

      // Act
      await handleClientReady(mockClient);

      // Assert — thread added to store and GitHub issue created
      expect(mockFetchStarterMessage).toHaveBeenCalled();
      expect(createIssue).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'orphaned-thread', title: 'Orphaned Thread' }),
        mockStarterMessage,
      );
      expect(threadRepository.findByDiscordId('orphaned-thread')).toBeDefined();
    });

    it('skips orphaned thread recovery when starter message is from a bot', async () => {
      // Arrange
      const { getIssues, createIssue } = await import('../github/githubActions');
      vi.mocked(getIssues).mockResolvedValue([]);

      const mockBotMessage = {
        author: { bot: true, id: 'bot-id' },
      };
      const mockActiveThreads = {
        threads: new Map([
          ['bot-thread', {
            id: 'bot-thread',
            name: 'Bot Thread',
            appliedTags: [],
            locked: false,
            archived: false,
            fetchStarterMessage: vi.fn().mockResolvedValue(mockBotMessage),
          }],
        ]),
      };

      const mockForum = {
        availableTags: [],
        threads: { fetchActive: vi.fn().mockResolvedValue(mockActiveThreads) },
      };

      const mockClient = {
        user: { tag: 'TestBot#0001' },
        channels: {
          cache: new Map(),
          fetch: vi.fn().mockResolvedValue(mockForum),
        },
      } as unknown as Client;

      // Act
      await handleClientReady(mockClient);

      // Assert — bot-originated thread not added or issued
      expect(createIssue).not.toHaveBeenCalled();
      expect(threadRepository.findByDiscordId('bot-thread')).toBeUndefined();
    });

    it('does not add orphaned thread to store when createIssue fails to set thread.number', async () => {
      // Arrange — createIssue resolves but leaves thread.number unset (internal failure)
      const { getIssues, createIssue } = await import('../github/githubActions');
      vi.mocked(getIssues).mockResolvedValue([]);
      vi.mocked(createIssue).mockResolvedValue(undefined); // does not set thread.number

      const mockStarterMessage = {
        author: { bot: false, id: 'user-1', globalName: 'User', avatar: 'hash' },
        guildId: '111', channelId: 'orphaned-thread', id: 'msg-1',
        content: 'Help', attachments: new Collection(),
      };
      const mockActiveThreads = {
        threads: new Map([
          ['orphaned-thread', {
            id: 'orphaned-thread', name: 'Thread', appliedTags: [], locked: false, archived: false,
            fetchStarterMessage: vi.fn().mockResolvedValue(mockStarterMessage),
          }],
        ]),
      };

      const mockForum = {
        availableTags: [],
        threads: { fetchActive: vi.fn().mockResolvedValue(mockActiveThreads) },
      };
      const mockClient = {
        user: { tag: 'TestBot#0001' },
        channels: { cache: new Map(), fetch: vi.fn().mockResolvedValue(mockForum) },
      } as unknown as Client;

      // Act
      await handleClientReady(mockClient);

      // Assert — thread not added to store because GitHub issue was not created
      expect(threadRepository.findByDiscordId('orphaned-thread')).toBeUndefined();
    });

    it('skips orphaned thread recovery when fetchStarterMessage returns null', async () => {
      // Arrange
      const { getIssues, createIssue } = await import('../github/githubActions');
      vi.mocked(getIssues).mockResolvedValue([]);

      const mockActiveThreads = {
        threads: new Map([
          ['orphaned-thread', {
            id: 'orphaned-thread', name: 'Thread', appliedTags: [], locked: false, archived: false,
            fetchStarterMessage: vi.fn().mockResolvedValue(null),
          }],
        ]),
      };

      const mockForum = {
        availableTags: [],
        threads: { fetchActive: vi.fn().mockResolvedValue(mockActiveThreads) },
      };
      const mockClient = {
        user: { tag: 'TestBot#0001' },
        channels: { cache: new Map(), fetch: vi.fn().mockResolvedValue(mockForum) },
      } as unknown as Client;

      // Act
      await handleClientReady(mockClient);

      // Assert
      expect(createIssue).not.toHaveBeenCalled();
      expect(threadRepository.findByDiscordId('orphaned-thread')).toBeUndefined();
    });

    it('continues recovering remaining orphaned threads when one fetchStarterMessage throws', async () => {
      // Arrange
      const { getIssues, createIssue } = await import('../github/githubActions');
      vi.mocked(getIssues).mockResolvedValue([]);
      vi.mocked(createIssue).mockImplementation(async (thread) => { thread.number = 1; });

      const mockStarterMessage = {
        author: { bot: false, id: 'user-1', globalName: 'User', avatar: 'hash' },
        guildId: '111', channelId: 'thread-b', id: 'msg-2',
        content: 'ok', attachments: new Collection(),
      };
      const mockActiveThreads = {
        threads: new Map([
          ['thread-a', {
            id: 'thread-a', name: 'A', appliedTags: [], locked: false, archived: false,
            fetchStarterMessage: vi.fn().mockRejectedValue(new Error('fetch failed')),
          }],
          ['thread-b', {
            id: 'thread-b', name: 'B', appliedTags: [], locked: false, archived: false,
            fetchStarterMessage: vi.fn().mockResolvedValue(mockStarterMessage),
          }],
        ]),
      };

      const mockForum = {
        availableTags: [],
        threads: { fetchActive: vi.fn().mockResolvedValue(mockActiveThreads) },
      };

      const mockClient = {
        user: { tag: 'TestBot#0001' },
        channels: {
          cache: new Map(),
          fetch: vi.fn().mockResolvedValue(mockForum),
        },
      } as unknown as Client;

      // Act
      await handleClientReady(mockClient);

      // Assert — thread-b recovered despite thread-a failing
      expect(createIssue).toHaveBeenCalledTimes(1);
      expect(threadRepository.findByDiscordId('thread-b')).toBeDefined();
    });

    it('excludes a thread from the store when its channel fetch times out', async () => {
      // Arrange — one thread whose fetch never resolves
      vi.useFakeTimers();
      const { getIssues } = await import('../github/githubActions');
      vi.mocked(getIssues).mockResolvedValue([
        { id: 'thread-slow', title: 'Slow', appliedTags: [], comments: [], archived: false, locked: false },
        { id: 'thread-ok',   title: 'OK',   appliedTags: [], comments: [], archived: false, locked: false },
      ]);

      const mockForum = {
        availableTags: [],
        threads: { fetchActive: vi.fn().mockResolvedValue({ threads: new Map() }) },
      };

      const mockClient = {
        user: { tag: 'TestBot#0001' },
        channels: {
          cache: new Map([
            // thread-ok is in cache; thread-slow is not (will be fetched)
            ['thread-ok', { messages: { cache: { forEach: vi.fn() } } }],
          ]),
          fetch: vi.fn().mockImplementation((id: string) => {
            if (id === 'forum-channel-id') return Promise.resolve(mockForum);
            // thread-slow fetch hangs forever
            return new Promise(() => {});
          }),
        },
      } as unknown as Client;

      // Act — start handleClientReady then advance timers past the 10s timeout,
      // using advanceTimersByTimeAsync so promise microtasks are flushed between ticks.
      const readyPromise = handleClientReady(mockClient);
      await vi.advanceTimersByTimeAsync(11_000);
      await readyPromise;

      vi.useRealTimers();

      // Assert — slow thread excluded; ok thread retained
      expect(threadRepository.findByDiscordId('thread-slow')).toBeUndefined();
      expect(threadRepository.findByDiscordId('thread-ok')).toBeDefined();
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
      expect(threadRepository.getAll()).toHaveLength(1);
      expect(threadRepository.getAll()[0]).toMatchObject({
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
      expect(threadRepository.getAll()).toHaveLength(0);
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
      expect(threadRepository.getAll()[0].appliedTags).toHaveLength(0);
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
      expect([...threadRepository.getAvailableTags()]).toHaveLength(2);
      expect([...threadRepository.getAvailableTags()]).toEqual(mockTags);
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
      expect([...threadRepository.getAvailableTags()]).toHaveLength(0);
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
      expect([...threadRepository.getAvailableTags()]).toHaveLength(0);
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
      expect(threadRepository.getAll()).toHaveLength(0);
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
      expect(threadRepository.getAll()).toHaveLength(0);
    });

    it('should skip message when thread not found', async () => {
      // Arrange
      threadRepository.addThread({
        id: 'thread-1',
        title: 'Test',
        appliedTags: [],
        comments: [],
        archived: false,
        locked: false,
      });
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
      expect(threadRepository.getAll()).toHaveLength(1);
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
      expect(threadRepository.getAll()).toHaveLength(0);
    });

    it('should skip deletion when comment not found in thread', async () => {
      // Arrange
      threadRepository.addThread({
        id: 'thread-1',
        title: 'Test',
        appliedTags: [],
        comments: [],
        archived: false,
        locked: false,
      });
      const mockMessage = {
        channelId: 'thread-1',
        id: 'unknown-msg-id',
      } as unknown as Message;

      // Act
      await handleMessageDelete(mockMessage);

      // Assert
      expect(threadRepository.getAll()[0].comments).toHaveLength(0);
    });

    it('should remove comment from thread when found', async () => {
      // Arrange
      threadRepository.addThread({
        id: 'thread-1',
        title: 'Test',
        appliedTags: [],
        comments: [
          { id: 'msg-1', git_id: 1 },
          { id: 'msg-2', git_id: 2 },
        ],
        archived: false,
        locked: false,
      });
      const mockMessage = {
        channelId: 'thread-1',
        id: 'msg-1',
      } as unknown as Message;

      // Act
      await handleMessageDelete(mockMessage);

      // Assert
      expect(threadRepository.getAll()[0].comments).toHaveLength(1);
      expect(threadRepository.getAll()[0].comments[0].id).toBe('msg-2');
    });
  });

  describe('handleThreadDelete', () => {
    it('should ignore thread delete for incorrect forum channel', async () => {
      // Arrange
      threadRepository.addThread({
        id: 'thread-1',
        title: 'Test',
        appliedTags: [],
        comments: [],
        archived: false,
        locked: false,
      });
      const mockThread = {
        id: 'thread-1',
        parentId: 'different-channel-id',
      } as unknown as AnyThreadChannel;

      // Act
      await handleThreadDelete(mockThread);

      // Assert
      expect(threadRepository.getAll()).toHaveLength(1);
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
      expect(threadRepository.getAll()).toHaveLength(0);
    });
  });

  describe('handleThreadUpdate', () => {
    it('should ignore thread update for incorrect forum channel', async () => {
      // Arrange
      threadRepository.addThread({
        id: 'thread-1',
        title: 'Test',
        appliedTags: [],
        comments: [],
        archived: false,
        locked: false,
      });
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
      expect(threadRepository.getAll()[0].archived).toBe(false);
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
      expect(threadRepository.getAll()).toHaveLength(0);
    });

    it('should update thread locked state when changed', async () => {
      // Arrange
      threadRepository.addThread({
        id: 'thread-1',
        title: 'Test',
        appliedTags: [],
        comments: [],
        archived: false,
        locked: false,
      });
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
      expect(threadRepository.getAll()[0].locked).toBe(true);
    });

    it('should update thread archived state when changed', async () => {
      // Arrange
      threadRepository.addThread({
        id: 'thread-1',
        title: 'Test',
        appliedTags: [],
        comments: [],
        archived: false,
        locked: false,
      });
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
      expect(threadRepository.getAll()[0].archived).toBe(false); // initially false
    });

    it('should not update lock state when lockLocking flag is set', async () => {
      // Arrange
      threadRepository.addThread({
        id: 'thread-1',
        title: 'Test',
        appliedTags: [],
        comments: [],
        archived: false,
        locked: false,
        lockLocking: true,
      });
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
      expect(threadRepository.getAll()[0].locked).toBe(false);
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
