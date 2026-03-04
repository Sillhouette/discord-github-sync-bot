import { ForumChannel, MessagePayload, ThreadChannel, Webhook } from "discord.js";
import { config } from "../config";
import { Thread } from "../interfaces";
import {
  ActionValue,
  Actions,
  Triggerer,
  getDiscordUrl,
  logger,
} from "../logger";
import { saveCommentMapping } from "../commentMap";
import { store } from "../store";
import client from "./discord";

const info = (action: ActionValue, thread: Thread) =>
  logger.info(`${Triggerer.Github} | ${action} | ${getDiscordUrl(thread)}`);

// Webhook cache keyed by forum channel ID — one webhook per forum, reused across comments
// so that updateComment can call webhook.editMessage() on webhook-authored messages.
//
// Known limitation: the Map is unbounded. Each entry holds one Webhook object per forum
// channel. At current scale (single forum channel) this is negligible, but if the bot is
// ever configured to watch many forums the cache should be bounded or evicted on channel
// deletion.
const webhookCache = new Map<string, Webhook>();

// Per-forum promise queue serialising webhook.edit() + webhook.send() pairs so that
// concurrent GitHub comment events from different users cannot interleave their
// rename and send calls, which would cause the wrong avatar/name on a message.
const webhookQueue = new Map<string, Promise<void>>();

function enqueueWebhookTask(forumId: string, task: () => Promise<void>): Promise<void> {
  const prev = webhookQueue.get(forumId) ?? Promise.resolve();
  const next = prev.then(task, task); // advance queue even if previous task errored
  webhookQueue.set(forumId, next);
  // Self-evict once this tail settles so the Map doesn't retain stale entries.
  const cleanup = () => { if (webhookQueue.get(forumId) === next) webhookQueue.delete(forumId); };
  next.then(cleanup, cleanup);
  return next;
}

// Evict both caches for a forum channel that has been deleted.
// Called by the ChannelDelete event handler in discordHandlers.ts.
export function evictForumCache(channelId: string): void {
  webhookCache.delete(channelId);
  webhookQueue.delete(channelId);
}

const DISCORD_MAX_CONTENT = 2000;
const TRUNCATION_SUFFIX = "\n\n*(truncated — see GitHub for full comment)*";
// Spread iterates Unicode code points, avoiding cuts inside emoji surrogate pairs.
const TRUNCATION_KEEP = DISCORD_MAX_CONTENT - [...TRUNCATION_SUFFIX].length;

export function truncateContent(text: string): string {
  const codePoints = [...text];
  if (codePoints.length <= DISCORD_MAX_CONTENT) return text;
  return codePoints.slice(0, TRUNCATION_KEEP).join("") + TRUNCATION_SUFFIX;
}

export async function createThread({
  body,
  login,
  title,
  appliedTags,
  node_id,
  number,
}: {
  body: string;
  login: string;
  title: string;
  appliedTags: string[];
  node_id: string;
  number: number;
}) {
  const forum = client.channels.cache.get(
    config.DISCORD_CHANNEL_ID,
  ) as ForumChannel;
  try {
    const { id } = await forum.threads.create({
      message: {
        content: truncateContent(`**${login}** (GitHub)\n\n${body}`),
      },
      name: title,
      appliedTags,
    });
    const thread = store.threads.find((thread) => thread.id === id);
    if (!thread) {
      logger.warn(`createThread: Discord thread ${id} created but not found in store — node_id may not be set`);
      return;
    }

    thread.body = body;
    thread.node_id = node_id;
    thread.number = number;

    info(Actions.Created, thread);
  } catch (err) {
    logger.error(`createThread failed: ${err instanceof Error ? err.stack : err}`);
  }
}

export function extractImageUrls(body: string): string[] {
  const urls: string[] = [];
  // Markdown: ![alt](url) or ![alt](url "title")
  const mdRegex = /!\[.*?\]\((https?:\/\/[^\s)]+)/g;
  let match;
  while ((match = mdRegex.exec(body)) !== null) {
    urls.push(match[1]);
  }
  // HTML: <img src="url" .../>  (GitHub renders uploaded images this way)
  const htmlRegex = /<img\s[^>]*src="(https?:\/\/[^"]+)"/gi;
  while ((match = htmlRegex.exec(body)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

export function stripImageMarkdown(body: string): string {
  return body
    .replace(/!\[.*?\]\(https?:\/\/[^\s)]+(?:\s[^)]+)?\)/g, "")
    .replace(/<img\s[^>]*\/?>/gi, "")
    .trim();
}

export async function createComment({
  git_id,
  body,
  login,
  avatar_url,
  node_id,
}: {
  git_id: number;
  body: string;
  login: string;
  avatar_url: string;
  node_id: string;
}) {
  const { thread, channel } = await getThreadChannel(node_id);
  if (!thread || !channel || !channel.parentId || !channel.parent) return;

  const imageUrls = extractImageUrls(body).slice(0, 10);
  const embeds = imageUrls.map((url) => ({ image: { url } }));
  const cleanBody = stripImageMarkdown(body);

  await enqueueWebhookTask(channel.parentId, async () => {
    try {
      let webhook = webhookCache.get(channel.parentId!);
      if (!webhook) {
        // Cold cache — prefer reusing an existing bot webhook over creating a new one
        // to avoid accumulating orphaned webhooks on bot restart (Discord limit: 10/channel).
        const hooks = await (channel.parent as ForumChannel).fetchWebhooks();
        const botId = client.user?.id;
        const found =
          (botId ? hooks.find((h) => h.applicationId === botId) : undefined) ??
          hooks.first();
        if (found) {
          webhook = found;
          await webhook.edit({ name: login, avatar: avatar_url });
        } else {
          webhook = await (channel.parent as ForumChannel).createWebhook({
            name: login,
            avatar: avatar_url,
          });
        }
        webhookCache.set(channel.parentId!, webhook);
      } else {
        await webhook.edit({ name: login, avatar: avatar_url });
      }

      const messagePayload = MessagePayload.create(webhook, {
        content: truncateContent(cleanBody) || "\u200b",
        embeds,
        threadId: thread.id,
      }).resolveBody();

      const { id } = await webhook.send(messagePayload);
      thread.comments.push({ id, git_id });
      saveCommentMapping(git_id, id, thread.node_id!);
      info(Actions.Commented, thread);

      // Discord auto-unarchives threads when a message is posted.
      // Re-archive if the thread was already closed to prevent the
      // ThreadUpdate event from being misread as a user reopen.
      if (thread.archived) {
        thread.lockArchiving = true;
        await channel.setArchived(true);
      }
    } catch (err) {
      logger.error(`createComment failed: ${err instanceof Error ? err.stack : err}`);
    }
  });
}

export async function updateComment({
  discord_id,
  body,
  node_id,
}: {
  discord_id: string;
  body: string;
  node_id: string;
}) {
  const { thread, channel } = await getThreadChannel(node_id);
  if (!thread || !channel || !channel.parentId) return;

  let webhook = webhookCache.get(channel.parentId);
  if (!webhook) {
    // Cache is cold (e.g. after a bot restart) — fetch the existing webhook
    // from Discord rather than failing. Prefer the webhook whose applicationId
    // matches the bot's own user ID (the one we created). Fall back to the
    // first result if client.user is not yet populated (shouldn't happen after
    // the ready event, but guards against edge cases).
    try {
      const hooks = await (channel.parent as ForumChannel).fetchWebhooks();
      const botId = client.user?.id;
      const found =
        (botId ? hooks.find((h) => h.applicationId === botId) : undefined) ??
        hooks.first();
      if (!found) {
        logger.error(`updateComment: no webhook found for channel ${channel.parentId}`);
        return;
      }
      webhook = found;
      webhookCache.set(channel.parentId, webhook);
    } catch (err) {
      logger.error(`updateComment: failed to fetch webhooks: ${err instanceof Error ? err.stack : err}`);
      return;
    }
  }

  try {
    const imageUrls = extractImageUrls(body).slice(0, 10);
    const embeds = imageUrls.map((url) => ({ image: { url } }));
    const cleanBody = stripImageMarkdown(body);
    await webhook.editMessage(discord_id, {
      content: truncateContent(cleanBody) || "\u200b",
      embeds,
      threadId: thread.id,
    });
    info(Actions.EditedComment, thread);
  } catch (err) {
    logger.error(`updateComment failed: ${err instanceof Error ? err.stack : err}`);
  }
}

export async function archiveThread(node_id: string | undefined) {
  const { thread, channel } = await getThreadChannel(node_id);
  if (!thread || !channel || channel.archived) return;

  info(Actions.Closed, thread);

  thread.archived = true;
  await channel.setArchived(true);
}

export async function unarchiveThread(node_id: string | undefined) {
  const { thread, channel } = await getThreadChannel(node_id);
  if (!thread || !channel || !channel.archived) return;

  info(Actions.Reopened, thread);

  thread.archived = false;
  await channel.setArchived(false);
}

export async function lockThread(node_id: string | undefined) {
  const { thread, channel } = await getThreadChannel(node_id);
  if (!thread || !channel || channel.locked) return;

  info(Actions.Locked, thread);

  thread.locked = true;
  if (channel.archived) {
    thread.lockArchiving = true;
    thread.lockLocking = true;
    await channel.setArchived(false);
    await channel.setLocked(true);
    await channel.setArchived(true);
  } else {
    await channel.setLocked(true);
  }
}

export async function unlockThread(node_id: string | undefined) {
  const { thread, channel } = await getThreadChannel(node_id);
  if (!thread || !channel || !channel.locked) return;

  info(Actions.Unlocked, thread);

  thread.locked = false;
  if (channel.archived) {
    thread.lockArchiving = true;
    thread.lockLocking = true;
    await channel.setArchived(false);
    await channel.setLocked(false);
    await channel.setArchived(true);
  } else {
    await channel.setLocked(false);
  }
}

export async function deleteThread(node_id: string | undefined) {
  const { channel, thread } = await getThreadChannel(node_id);
  if (!thread || !channel) return;

  info(Actions.Deleted, thread);

  store.deleteThread(thread?.id);
  await channel.delete();
}

export async function getThreadChannel(node_id: string | undefined): Promise<{
  channel: ThreadChannel<boolean> | undefined;
  thread: Thread | undefined;
}> {
  let channel: ThreadChannel<boolean> | undefined;
  if (!node_id) return { thread: undefined, channel };

  const thread = store.threads.find((thread) => thread.node_id === node_id);
  if (!thread) return { thread, channel };

  channel = <ThreadChannel | undefined>client.channels.cache.get(thread.id);
  if (channel) return { thread, channel };

  try {
    const fetchedChannel = await client.channels.fetch(thread.id);
    channel = <ThreadChannel | undefined>fetchedChannel;
  } catch (err) {
    logger.warn(`getThreadChannel: failed to fetch channel ${thread.id}: ${err instanceof Error ? err.stack : err}`);
  }

  return { thread, channel };
}
