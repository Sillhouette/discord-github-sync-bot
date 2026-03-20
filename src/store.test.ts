import { describe, it, expect, beforeEach } from 'vitest';
import { ThreadRepository } from './store';
import { Thread } from './interfaces';

const makeThread = (overrides: Partial<Thread> = {}): Thread => ({
  id: 'thread-1',
  title: 'Test Thread',
  appliedTags: [],
  comments: [],
  archived: false,
  locked: false,
  ...overrides,
});

describe('ThreadRepository', () => {
  let repo: ThreadRepository;

  beforeEach(() => {
    repo = new ThreadRepository();
  });

  describe('addThread', () => {
    it('adds a thread to the repository', () => {
      // Arrange
      const thread = makeThread();

      // Act
      repo.addThread(thread);

      // Assert
      expect(repo.getAll()).toHaveLength(1);
      expect(repo.getAll()[0]).toBe(thread);
    });

    it('stores multiple threads independently', () => {
      // Arrange
      const t1 = makeThread({ id: 'thread-1' });
      const t2 = makeThread({ id: 'thread-2' });

      // Act
      repo.addThread(t1);
      repo.addThread(t2);

      // Assert
      expect(repo.getAll()).toHaveLength(2);
    });
  });

  describe('removeThread', () => {
    it('removes a thread by id', () => {
      // Arrange
      repo.addThread(makeThread({ id: 'thread-1' }));
      repo.addThread(makeThread({ id: 'thread-2' }));

      // Act
      repo.removeThread('thread-1');

      // Assert
      expect(repo.getAll()).toHaveLength(1);
      expect(repo.getAll()[0].id).toBe('thread-2');
    });

    it('does nothing when id is not found', () => {
      // Arrange
      repo.addThread(makeThread({ id: 'thread-1' }));

      // Act
      repo.removeThread('does-not-exist');

      // Assert
      expect(repo.getAll()).toHaveLength(1);
    });

    it('does nothing when id is undefined', () => {
      // Arrange
      repo.addThread(makeThread({ id: 'thread-1' }));

      // Act
      repo.removeThread(undefined);

      // Assert
      expect(repo.getAll()).toHaveLength(1);
    });
  });

  describe('updateThread', () => {
    it('applies a patch to the matching thread', () => {
      // Arrange
      repo.addThread(makeThread({ id: 'thread-1', archived: false }));

      // Act
      repo.updateThread('thread-1', { archived: true, number: 42 });

      // Assert
      const t = repo.findByDiscordId('thread-1');
      expect(t?.archived).toBe(true);
      expect(t?.number).toBe(42);
    });

    it('does nothing when id is not found', () => {
      // Arrange
      repo.addThread(makeThread({ id: 'thread-1' }));

      // Act
      repo.updateThread('does-not-exist', { archived: true });

      // Assert
      expect(repo.findByDiscordId('thread-1')?.archived).toBe(false);
    });
  });

  describe('findByDiscordId', () => {
    it('returns the thread matching the Discord id', () => {
      // Arrange
      const thread = makeThread({ id: 'disc-123' });
      repo.addThread(thread);

      // Act
      const found = repo.findByDiscordId('disc-123');

      // Assert
      expect(found).toBe(thread);
    });

    it('returns undefined when no thread matches', () => {
      // Arrange — empty repo

      // Act
      const found = repo.findByDiscordId('disc-999');

      // Assert
      expect(found).toBeUndefined();
    });
  });

  describe('findByNodeId', () => {
    it('returns the thread matching the VCS node_id', () => {
      // Arrange
      const thread = makeThread({ id: 'disc-1', node_id: 'MDU6SXNzdWUx' });
      repo.addThread(thread);

      // Act
      const found = repo.findByNodeId('MDU6SXNzdWUx');

      // Assert
      expect(found).toBe(thread);
    });

    it('returns undefined when no thread has that node_id', () => {
      // Arrange
      repo.addThread(makeThread({ id: 'disc-1', node_id: 'other-id' }));

      // Act
      const found = repo.findByNodeId('MDU6SXNzdWUx');

      // Assert
      expect(found).toBeUndefined();
    });

    it('returns undefined when node_id is undefined on the thread', () => {
      // Arrange
      repo.addThread(makeThread({ id: 'disc-1' })); // no node_id

      // Act
      const found = repo.findByNodeId('MDU6SXNzdWUx');

      // Assert
      expect(found).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('returns an empty collection when no threads exist', () => {
      expect(repo.getAll()).toHaveLength(0);
    });

    it('returns all added threads', () => {
      // Arrange
      repo.addThread(makeThread({ id: 'thread-1' }));
      repo.addThread(makeThread({ id: 'thread-2' }));

      // Act
      const all = repo.getAll();

      // Assert
      expect(all).toHaveLength(2);
    });

    it('returns a readonly view — the backing array is not exposed', () => {
      // Arrange
      repo.addThread(makeThread({ id: 'thread-1' }));

      // Act
      const all = repo.getAll();

      // Assert — casting to mutable and pushing does not affect the repo
      (all as Thread[]).push(makeThread({ id: 'injected' }));
      expect(repo.getAll()).toHaveLength(1);
    });
  });

  describe('loadThreads', () => {
    it('replaces all existing threads with the provided list', () => {
      // Arrange
      repo.addThread(makeThread({ id: 'old-thread' }));
      const fresh = [makeThread({ id: 'new-1' }), makeThread({ id: 'new-2' })];

      // Act
      repo.loadThreads(fresh);

      // Assert
      expect(repo.getAll()).toHaveLength(2);
      expect(repo.findByDiscordId('old-thread')).toBeUndefined();
      expect(repo.findByDiscordId('new-1')).toBeDefined();
    });

    it('accepts an empty array to clear all threads', () => {
      // Arrange
      repo.addThread(makeThread({ id: 'thread-1' }));

      // Act
      repo.loadThreads([]);

      // Assert
      expect(repo.getAll()).toHaveLength(0);
    });
  });

  describe('setAvailableTags / getAvailableTags', () => {
    it('stores and retrieves available tags', () => {
      // Arrange
      const tags = [
        { id: 'tag-1', name: 'bug' },
        { id: 'tag-2', name: 'feature' },
      ] as any[];

      // Act
      repo.setAvailableTags(tags);

      // Assert
      expect(repo.getAvailableTags()).toHaveLength(2);
      expect(repo.getAvailableTags()[0].id).toBe('tag-1');
    });

    it('returns empty collection before any tags are set', () => {
      expect(repo.getAvailableTags()).toHaveLength(0);
    });

    it('replaces previous tags on subsequent calls', () => {
      // Arrange
      repo.setAvailableTags([{ id: 'old', name: 'old' }] as any[]);

      // Act
      repo.setAvailableTags([{ id: 'new-1', name: 'a' }, { id: 'new-2', name: 'b' }] as any[]);

      // Assert
      expect(repo.getAvailableTags()).toHaveLength(2);
      expect(repo.getAvailableTags()[0].id).toBe('new-1');
    });
  });

  describe('clear', () => {
    it('removes all threads and tags', () => {
      // Arrange
      repo.addThread(makeThread());
      repo.setAvailableTags([{ id: 'tag-1', name: 'bug' }] as any[]);

      // Act
      repo.clear();

      // Assert
      expect(repo.getAll()).toHaveLength(0);
      expect(repo.getAvailableTags()).toHaveLength(0);
    });
  });
});
