import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import { Thread } from './interfaces';

describe('Store', () => {
  beforeEach(() => {
    // Reset store state before each test
    store.threads = [];
    store.availableTags = [];
  });

  describe('deleteThread', () => {
    it('should remove thread by id from threads array', () => {
      // Arrange
      const thread: Thread = {
        id: 'thread-1',
        title: 'Test Thread',
        appliedTags: [],
        comments: [],
        archived: false,
        locked: false,
      };
      store.threads = [thread];

      // Act
      const result = store.deleteThread('thread-1');

      // Assert
      expect(result).toHaveLength(0);
      expect(store.threads).toHaveLength(0);
    });

    it('should handle deletion of non-existent thread gracefully', () => {
      // Arrange
      const thread: Thread = {
        id: 'thread-1',
        title: 'Test Thread',
        appliedTags: [],
        comments: [],
        archived: false,
        locked: false,
      };
      store.threads = [thread];

      // Act
      const result = store.deleteThread('thread-nonexistent');

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('thread-1');
    });

    it('should handle deletion with undefined id', () => {
      // Arrange
      const thread: Thread = {
        id: 'thread-1',
        title: 'Test Thread',
        appliedTags: [],
        comments: [],
        archived: false,
        locked: false,
      };
      store.threads = [thread];

      // Act
      const result = store.deleteThread(undefined);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('thread-1');
    });

    it('should remove correct thread when multiple threads exist', () => {
      // Arrange
      const thread1: Thread = {
        id: 'thread-1',
        title: 'Thread 1',
        appliedTags: [],
        comments: [],
        archived: false,
        locked: false,
      };
      const thread2: Thread = {
        id: 'thread-2',
        title: 'Thread 2',
        appliedTags: [],
        comments: [],
        archived: false,
        locked: false,
      };
      const thread3: Thread = {
        id: 'thread-3',
        title: 'Thread 3',
        appliedTags: [],
        comments: [],
        archived: false,
        locked: false,
      };
      store.threads = [thread1, thread2, thread3];

      // Act
      const result = store.deleteThread('thread-2');

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('thread-1');
      expect(result[1].id).toBe('thread-3');
    });

    it('should maintain store state across multiple operations', () => {
      // Arrange
      const thread1: Thread = {
        id: 'thread-1',
        title: 'Thread 1',
        appliedTags: [],
        comments: [],
        archived: false,
        locked: false,
      };
      const thread2: Thread = {
        id: 'thread-2',
        title: 'Thread 2',
        appliedTags: [],
        comments: [],
        archived: false,
        locked: false,
      };
      store.threads = [thread1, thread2];

      // Act
      store.deleteThread('thread-1');
      const finalResult = store.deleteThread('thread-2');

      // Assert
      expect(finalResult).toHaveLength(0);
      expect(store.threads).toHaveLength(0);
    });

    it('should return the updated threads array', () => {
      // Arrange
      const thread1: Thread = {
        id: 'thread-1',
        title: 'Thread 1',
        appliedTags: [],
        comments: [],
        archived: false,
        locked: false,
      };
      store.threads = [thread1];

      // Act
      const result = store.deleteThread('thread-1');

      // Assert
      expect(result).toBe(store.threads);
    });
  });
});
