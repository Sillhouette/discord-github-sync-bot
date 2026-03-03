import { describe, it, expect, beforeEach, vi } from "vitest";
import path from "path";
import type { Thread } from "./interfaces";

// vi.mock() is hoisted automatically — declare it at the top level,
// then capture the fn references via vi.mocked() after import.
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
}));

import * as fs from "fs";
import { saveCommentMapping, getDiscordIdForGitComment, getNodeIdForGitComment, loadInto } from "./commentMap";

const mockExistsSync = vi.mocked(fs.existsSync);
const mockWriteFileSync = vi.mocked(fs.writeFileSync);
const mockRenameSync = vi.mocked(fs.renameSync);

describe("commentMap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The module's in-memory map persists across tests (module-level state).
    // Tests self-isolate by using unique git_ids that don't collide with each other.
  });

  describe("saveCommentMapping", () => {
    it("should persist a new mapping and write to file atomically", () => {
      // Arrange
      mockExistsSync.mockReturnValue(false);

      // Act
      saveCommentMapping(42, "discord-msg-1", "node-abc");

      // Assert — writes to data/commentMap.json.tmp then renames to data/commentMap.json
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining(path.join("data", "commentMap.json.tmp")),
        expect.stringContaining('"42"'),
        "utf8",
      );
      expect(mockRenameSync).toHaveBeenCalledWith(
        expect.stringContaining(path.join("data", "commentMap.json.tmp")),
        expect.stringContaining(path.join("data", "commentMap.json")),
      );
    });

    it("should include discord_id and node_id in the written JSON", () => {
      // Arrange
      mockExistsSync.mockReturnValue(false);

      // Act
      saveCommentMapping(99, "discord-msg-99", "node-xyz");

      // Assert
      const written = mockWriteFileSync.mock.calls[0][1] as string;
      const parsed = JSON.parse(written);
      expect(parsed["99"]).toEqual({ discord_id: "discord-msg-99", node_id: "node-xyz" });
    });
  });

  describe("getDiscordIdForGitComment", () => {
    it("should return the discord_id for a saved mapping", () => {
      // Arrange
      mockExistsSync.mockReturnValue(false);
      saveCommentMapping(7, "discord-msg-7", "node-7");

      // Act
      const result = getDiscordIdForGitComment(7);

      // Assert
      expect(result).toBe("discord-msg-7");
    });

    it("should return undefined for an unknown git_id", () => {
      // Act
      const result = getDiscordIdForGitComment(9999);

      // Assert
      expect(result).toBeUndefined();
    });
  });

  describe("getNodeIdForGitComment", () => {
    it("should return the node_id for a saved mapping", () => {
      // Arrange
      mockExistsSync.mockReturnValue(false);
      saveCommentMapping(5, "discord-msg-5", "node-5");

      // Act
      const result = getNodeIdForGitComment(5);

      // Assert
      expect(result).toBe("node-5");
    });
  });

  describe("loadInto", () => {
    it("should push persisted mappings into thread.comments", () => {
      // Arrange — add mappings directly via the public API (in-memory map)
      saveCommentMapping(110, "discord-d10", "node-N");
      saveCommentMapping(111, "discord-d11", "node-N");

      const threads: Thread[] = [
        {
          id: "thread-N",
          title: "Test",
          appliedTags: [],
          node_id: "node-N",
          comments: [],
          archived: false,
          locked: false,
        },
      ];

      // Act
      loadInto(threads);

      // Assert — both comments pushed into the matching thread
      expect(threads[0].comments).toContainEqual({ id: "discord-d10", git_id: 110 });
      expect(threads[0].comments).toContainEqual({ id: "discord-d11", git_id: 111 });
    });

    it("should not push duplicate mappings when comment is already in thread", () => {
      // Arrange — thread already has comment with git_id 120
      saveCommentMapping(120, "discord-d120", "node-N2");

      const threads: Thread[] = [
        {
          id: "thread-N2",
          title: "Test",
          appliedTags: [],
          node_id: "node-N2",
          comments: [{ id: "discord-d120", git_id: 120 }],
          archived: false,
          locked: false,
        },
      ];

      // Act
      loadInto(threads);

      // Assert — no duplicate pushed
      expect(threads[0].comments.filter((c) => c.git_id === 120)).toHaveLength(1);
    });

    it("should skip mappings whose thread is not in the provided list", () => {
      // Arrange — mapping for a node_id that isn't in threads
      saveCommentMapping(130, "discord-d130", "node-MISSING");

      const threads: Thread[] = [
        {
          id: "thread-other",
          title: "Test",
          appliedTags: [],
          node_id: "node-OTHER",
          comments: [],
          archived: false,
          locked: false,
        },
      ];

      // Act
      loadInto(threads);

      // Assert — nothing pushed (no matching thread)
      expect(threads[0].comments).toHaveLength(0);
    });
  });
});
