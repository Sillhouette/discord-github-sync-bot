import {
  AnyThreadChannel,
  Client,
  DMChannel,
  ForumChannel,
  Message,
  NonThreadGuildBasedChannel,
  PartialDMChannel,
  PartialMessage,
  ThreadChannel,
} from "discord.js";
import { config } from "../config";
import {
  closeIssue,
  createIssue,
  createIssueComment,
  deleteComment,
  deleteIssue,
  getIssues,
  lockIssue,
  openIssue,
  unlockIssue,
} from "../github/githubActions";
import { evictForumCache } from "./discordActions";
import { logger } from "../logger";
import { store } from "../store";
import { Thread } from "../interfaces";

export async function handleClientReady(client: Client) {
  logger.info(`Logged in as ${client.user?.tag}!`);

  store.threads = await getIssues();

  // Validate that each thread's Discord channel still exists; remove any that
  // have been deleted. Each fetch is raced against a 10-second timeout so a
  // single hanging API call cannot block startup indefinitely.
  const CHANNEL_FETCH_TIMEOUT_MS = 10_000;
  const threadPromises = store.threads.map(async (thread) => {
    const cachedChannel = client.channels.cache.get(thread.id) as
      | ThreadChannel
      | undefined;
    if (cachedChannel) {
      return thread; // Returning thread as valid
    } else {
      try {
        const fetchWithTimeout = Promise.race([
          client.channels.fetch(thread.id),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`timeout fetching channel ${thread.id}`)),
              CHANNEL_FETCH_TIMEOUT_MS,
            ),
          ),
        ]);
        await fetchWithTimeout;
        return thread; // Returning thread as valid
      } catch (error) {
        return; // Marking thread as invalid
      }
    }
  });
  const threadPromisesResults = await Promise.all(threadPromises);
  store.threads = threadPromisesResults.filter(
    (thread) => thread !== undefined,
  ) as Thread[];

  logger.info(`Issues loaded : ${store.threads.length}`);

  try {
    const forum = (await client.channels.fetch(config.DISCORD_CHANNEL_ID)) as ForumChannel;
    store.availableTags = forum.availableTags;

    // Reconcile Discord thread states with GitHub on startup.
    // Archive any Discord threads that are still open but whose GitHub issue is closed.
    // Note: fetchActive() returns only the first page of results. At current scale
    // (single forum, small thread count) this is acceptable, but a paginated
    // implementation would be needed if thread counts grow large.
    const activeThreads = await forum.threads.fetchActive();
    let reconciled = 0;
    let orphaned = 0;
    for (const [threadId, channel] of activeThreads.threads) {
      const storeThread = store.threads.find((t) => t.id === threadId);
      if (storeThread?.archived && !channel.archived) {
        // storeThread.archived is already true (guaranteed by the condition above);
        // the assignment is intentionally omitted to avoid a misleading no-op.
        // The ThreadUpdate handler checks this flag before calling openIssue, so
        // the value must be set before setArchived fires — it already is.
        try {
          await channel.setArchived(true);
          reconciled++;
        } catch (err) {
          logger.error(`handleClientReady: failed to archive thread ${threadId}: ${err instanceof Error ? err.stack : err}`);
        }
      } else if (!storeThread) {
        // Orphaned Discord thread — exists in the forum but has no corresponding
        // GitHub issue (e.g. createIssue failed on a previous run, or the bot was
        // down when the thread was created). Recover by fetching the starter message
        // and creating the issue now.
        try {
          const starterMessage = await channel.fetchStarterMessage();
          if (starterMessage && !starterMessage.author.bot) {
            const thread = {
              id: threadId,
              title: channel.name,
              appliedTags: channel.appliedTags,
              archived: false,
              locked: channel.locked ?? false,
              comments: [],
            };
            store.threads.push(thread);
            await createIssue(thread, starterMessage);
            orphaned++;
          }
        } catch (err) {
          logger.error(`handleClientReady: failed to recover orphaned thread ${threadId}: ${err instanceof Error ? err.stack : err}`);
        }
      }
    }
    if (reconciled > 0) {
      logger.info(`Reconciled ${reconciled} stale Discord thread(s) with closed GitHub issues`);
    }
    if (orphaned > 0) {
      logger.info(`Recovered ${orphaned} orphaned Discord thread(s) with missing GitHub issues`);
    }
  } catch (err) {
    logger.error(`handleClientReady: reconciliation failed: ${err instanceof Error ? err.stack : err}`);
  }
}

export async function handleThreadCreate(params: AnyThreadChannel) {
  if (params.parentId !== config.DISCORD_CHANNEL_ID) return;

  const { id, name, appliedTags } = params;

  store.threads.push({
    id,
    appliedTags,
    title: name,
    archived: false,
    locked: false,
    comments: [],
  });
}

export async function handleChannelUpdate(
  params: DMChannel | NonThreadGuildBasedChannel,
) {
  if (params.id !== config.DISCORD_CHANNEL_ID) return;

  if (params.type === 15) {
    store.availableTags = params.availableTags;
  }
}

export async function handleThreadUpdate(params: AnyThreadChannel) {
  if (params.parentId !== config.DISCORD_CHANNEL_ID) return;

  const { id, archived, locked } = params.members.thread;
  const thread = store.threads.find((item) => item.id === id);
  if (!thread) return;

  if (thread.locked !== locked && !thread.lockLocking) {
    if (thread.archived) {
      thread.lockArchiving = true;
    }
    thread.locked = locked;
    locked ? lockIssue(thread) : unlockIssue(thread);
  }
  if (thread.archived !== archived) {
    setTimeout(() => {
      // timeout for fixing discord archived post locking
      if (thread.lockArchiving) {
        if (archived) {
          thread.lockArchiving = false;
        }
        thread.lockLocking = false;
        return;
      }
      thread.archived = archived;
      archived ? closeIssue(thread) : openIssue(thread);
    }, 500);
  }
}

export async function handleMessageCreate(params: Message) {
  const { channelId, author } = params;

  if (author.bot) return;

  const thread = store.threads.find((thread) => thread.id === channelId);

  if (!thread) return;

  if (!thread.body) {
    createIssue(thread, params);
  } else {
    createIssueComment(thread, params);
  }
}

export async function handleMessageDelete(params: Message | PartialMessage) {
  const { channelId, id } = params;
  const thread = store.threads.find((i) => i.id === channelId);
  if (!thread) return;

  const commentIndex = thread.comments.findIndex((i) => i.id === id);
  if (commentIndex === -1) return;

  const comment = thread.comments.splice(commentIndex, 1)[0];
  deleteComment(thread, comment.git_id);
}

export async function handleThreadDelete(params: AnyThreadChannel) {
  if (params.parentId !== config.DISCORD_CHANNEL_ID) return;

  const thread = store.threads.find((item) => item.id === params.id);
  if (!thread) return;

  deleteIssue(thread);
}

export function handleChannelDelete(
  channel: DMChannel | NonThreadGuildBasedChannel | PartialDMChannel,
): void {
  if (channel.id === config.DISCORD_CHANNEL_ID) {
    evictForumCache(channel.id);
  }
}
