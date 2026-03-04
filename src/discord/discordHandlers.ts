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

  // Fetch cache for closed threads
  const threadPromises = store.threads.map(async (thread) => {
    const cachedChannel = client.channels.cache.get(thread.id) as
      | ThreadChannel
      | undefined;
    if (cachedChannel) {
      cachedChannel.messages.cache.forEach((message) => message.id);
      return thread; // Returning thread as valid
    } else {
      try {
        const channel = (await client.channels.fetch(
          thread.id,
        )) as ThreadChannel;
        channel.messages.cache.forEach((message) => message.id);
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
      }
    }
    if (reconciled > 0) {
      logger.info(`Reconciled ${reconciled} stale Discord thread(s) with closed GitHub issues`);
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
