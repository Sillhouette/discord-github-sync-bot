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
//
// Known limitation: webhook.edit({ name, avatar }) is called on every comment to impersonate
// the commenter. Two concurrent GitHub comment events from different users can race, causing
// the later edit to overwrite the earlier one before the first message is sent, resulting in
// the wrong avatar/name on a message. Acceptable at current traffic levels; a per-comment
// webhook or a queue would eliminate this at higher throughput.
const webhookCache = new Map<string, Webhook>();

export function createThread({
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
  forum.threads
    .create({
      message: {
        content: body + "/" + login, // TODO
      },
      name: title,
      appliedTags,
    })
    .then(({ id }) => {
      const thread = store.threads.find((thread) => thread.id === id);
      if (!thread) return;

      thread.body = body;
      thread.node_id = node_id;
      thread.number = number;

      info(Actions.Created, thread);
    });
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

  try {
    let webhook = webhookCache.get(channel.parentId);
    if (!webhook) {
      webhook = await (channel.parent as ForumChannel).createWebhook({
        name: login,
        avatar: avatar_url,
      });
      webhookCache.set(channel.parentId, webhook);
    } else {
      await webhook.edit({ name: login, avatar: avatar_url });
    }

    const messagePayload = MessagePayload.create(webhook, {
      content: cleanBody || "\u200b",
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
      channel.setArchived(true);
    }
  } catch (err) {
    logger.error(`createComment failed: ${err}`);
  }
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
      const found =
        (client.user?.id ? hooks.find((h) => h.applicationId === client.user!.id) : undefined) ??
        hooks.first();
      if (!found) {
        logger.error(`updateComment: no webhook found for channel ${channel.parentId}`);
        return;
      }
      webhook = found;
      webhookCache.set(channel.parentId, webhook);
    } catch (err) {
      logger.error(`updateComment: failed to fetch webhooks: ${err}`);
      return;
    }
  }

  try {
    const imageUrls = extractImageUrls(body).slice(0, 10);
    const embeds = imageUrls.map((url) => ({ image: { url } }));
    const cleanBody = stripImageMarkdown(body);
    await webhook.editMessage(discord_id, {
      content: cleanBody || "\u200b",
      embeds,
      threadId: thread.id,
    });
    info(Actions.EditedComment, thread);
  } catch (err) {
    logger.error(`updateComment failed: ${err}`);
  }
}

export async function archiveThread(node_id: string | undefined) {
  const { thread, channel } = await getThreadChannel(node_id);
  if (!thread || !channel || channel.archived) return;

  info(Actions.Closed, thread);

  thread.archived = true;
  channel.setArchived(true);
}

export async function unarchiveThread(node_id: string | undefined) {
  const { thread, channel } = await getThreadChannel(node_id);
  if (!thread || !channel || !channel.archived) return;

  info(Actions.Reopened, thread);

  thread.archived = false;
  channel.setArchived(false);
}

export async function lockThread(node_id: string | undefined) {
  const { thread, channel } = await getThreadChannel(node_id);
  if (!thread || !channel || channel.locked) return;

  info(Actions.Locked, thread);

  thread.locked = true;
  if (channel.archived) {
    thread.lockArchiving = true;
    thread.lockLocking = true;
    channel.setArchived(false);
    channel.setLocked(true);
    channel.setArchived(true);
  } else {
    channel.setLocked(true);
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
    channel.setArchived(false);
    channel.setLocked(false);
    channel.setArchived(true);
  } else {
    channel.setLocked(false);
  }
}

export async function deleteThread(node_id: string | undefined) {
  const { channel, thread } = await getThreadChannel(node_id);
  if (!thread || !channel) return;

  info(Actions.Deleted, thread);

  store.deleteThread(thread?.id);
  channel.delete();
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
    const fetchChanel = await client.channels.fetch(thread.id);
    channel = <ThreadChannel | undefined>fetchChanel;
  } catch (err) {
    /* empty */
  }

  return { thread, channel };
}
