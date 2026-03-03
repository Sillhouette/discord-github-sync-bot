import { existsSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";
import { Thread } from "./interfaces";

const MAP_FILE = path.resolve(process.cwd(), "commentMap.json");

type CommentEntry = { discord_id: string; node_id: string };
type CommentMap = Record<string, CommentEntry>; // key is git_id as string

// In-memory map, populated at startup from disk.
let map: CommentMap = {};
try {
  if (existsSync(MAP_FILE)) {
    const parsed: unknown = JSON.parse(readFileSync(MAP_FILE, "utf8"));
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      map = parsed as CommentMap;
    }
  }
} catch (err) {
  // A corrupt or partially-written file (e.g. from a mid-write crash) resets to
  // an empty map. Log so operators notice the data loss rather than debugging
  // silently missing edit-syncs.
  console.warn(`commentMap: failed to parse ${MAP_FILE}, starting with empty map: ${err}`);
  map = {};
}

/** Persist a new git_id → discord_id + node_id mapping to disk (atomic write). */
export function saveCommentMapping(
  git_id: number,
  discord_id: string,
  node_id: string,
): void {
  map[String(git_id)] = { discord_id, node_id };
  // Write to a temp file first, then rename — a crash mid-write leaves the
  // existing file intact rather than producing a corrupt one.
  const tmpFile = MAP_FILE + ".tmp";
  writeFileSync(tmpFile, JSON.stringify(map), "utf8");
  renameSync(tmpFile, MAP_FILE);
}

/** Return the Discord message ID for a given GitHub comment ID, or undefined. */
export function getDiscordIdForGitComment(git_id: number): string | undefined {
  return map[String(git_id)]?.discord_id;
}

/** Return the issue node_id for a given GitHub comment ID, or undefined. */
export function getNodeIdForGitComment(git_id: number): string | undefined {
  return map[String(git_id)]?.node_id;
}

/**
 * Merge persisted GitHub→Discord comment mappings into the provided threads.
 * Call this after fillCommentsData() at startup so that webhook-posted Discord
 * messages (which have no Discord URL in the GitHub body) are still editable
 * after a bot restart.
 *
 * Skips entries whose thread is not in the list or whose git_id is already
 * present (avoids duplicates with fillCommentsData results).
 */
export function loadInto(threads: Thread[]): void {
  for (const [git_id_str, { discord_id, node_id }] of Object.entries(map)) {
    const git_id = Number(git_id_str);
    const thread = threads.find((t) => t.node_id === node_id);
    if (!thread) continue;
    if (thread.comments.some((c) => c.git_id === git_id)) continue;
    thread.comments.push({ id: discord_id, git_id });
  }
}
