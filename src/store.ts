import { GuildForumTag } from "discord.js";
import { Thread } from "./interfaces";

export class ThreadRepository {
  private threads: Thread[] = [];
  private availableTags: GuildForumTag[] = [];

  addThread(thread: Thread): void {
    this.threads.push(thread);
  }

  removeThread(id: string | undefined): void {
    if (id === undefined) return;
    const index = this.threads.findIndex((t) => t.id === id);
    if (index !== -1) {
      this.threads.splice(index, 1);
    }
  }

  updateThread(id: string, patch: Partial<Thread>): void {
    const thread = this.threads.find((t) => t.id === id);
    if (thread) {
      Object.assign(thread, patch);
    }
  }

  findByDiscordId(id: string): Thread | undefined {
    return this.threads.find((t) => t.id === id);
  }

  findByNodeId(nodeId: string): Thread | undefined {
    return this.threads.find((t) => t.node_id === nodeId);
  }

  getAll(): readonly Thread[] {
    return this.threads.slice();
  }

  loadThreads(threads: Thread[]): void {
    this.threads = threads;
  }

  setAvailableTags(tags: GuildForumTag[]): void {
    this.availableTags = [...tags];
  }

  getAvailableTags(): readonly GuildForumTag[] {
    return this.availableTags;
  }

  /** Reset all state. Intended for use in tests only. */
  clear(): void {
    this.threads = [];
    this.availableTags = [];
  }
}

export const threadRepository = new ThreadRepository();
