import { graphql } from "@octokit/graphql";
import { Octokit } from "@octokit/rest";
import { Attachment, Collection, Message } from "discord.js";
import { config } from "../config";
import { uploadToR2 } from "../r2";
import { loadInto } from "../commentMap";
import { GitIssue, Thread } from "../interfaces";
import {
  ActionValue,
  Actions,
  Triggerer,
  getGithubUrl,
  logger,
} from "../logger";
import { threadRepository } from "../store";
import { stripImageMarkdown } from "../discord/discordActions";

/**
 * Returns the shortest tilde fence that cannot be broken by the given text.
 * Per CommonMark spec, a closing fence must be at least as long as the opening
 * fence — so we find the longest run of tildes (≥3) inside the text and use
 * one more tilde. Falls back to the minimum of ~~~ when the text is clean.
 */
function minFence(text: string): string {
  const maxRun = (text.match(/~{3,}/g) ?? []).reduce((max, s) => Math.max(max, s.length), 0);
  return "~".repeat(Math.max(3, maxRun + 1));
}

export const octokit = new Octokit({
  auth: config.GITHUB_ACCESS_TOKEN,
  baseUrl: "https://api.github.com",
});

const graphqlWithAuth = graphql.defaults({
  headers: {
    authorization: `token ${config.GITHUB_ACCESS_TOKEN}`,
  },
});

export const repoCredentials = {
  owner: config.GITHUB_USERNAME,
  repo: config.GITHUB_REPOSITORY,
};

const info = (action: ActionValue, thread: Thread) =>
  logger.info(`${Triggerer.Discord} | ${action} | ${getGithubUrl(thread)}`);
const error = (action: ActionValue | string, thread?: Thread) =>
  logger.error(
    `${Triggerer.Discord} | ${action} ` +
      (thread ? `| ${getGithubUrl(thread)}` : ""),
  );

const TEXT_INLINE_MAX_BYTES = 4096;

export async function attachmentsToMarkdown(
  attachments: Collection<string, Attachment>,
  messageId: string,
): Promise<string> {
  let md = "";
  for (const { url, name, contentType, size } of attachments.values()) {
    switch (contentType) {
      case "image/png":
      case "image/jpeg":
      case "image/gif":
      case "image/webp": {
        let imageUrl = url;
        try {
          const res = await fetch(url);
          if (res.ok) {
            const buffer = Buffer.from(await res.arrayBuffer());
            const key = `bot-uploads/discord/${messageId}/${name}`;
            const hosted = await uploadToR2(key, buffer, contentType);
            if (hosted) imageUrl = hosted;
          }
        } catch (err) {
          logger.error(`Failed to rehost image ${name}: ${err}`);
        }
        md += `![${name}](${imageUrl} "${name}")`;
        break;
      }
      default: {
        if (contentType?.startsWith("text/") && size <= TEXT_INLINE_MAX_BYTES) {
          try {
            const res = await fetch(url);
            if (res.ok) {
              const text = await res.text();
              const fence = minFence(text);
              md += `\n**Attached: ${name}**\n${fence}\n${text}\n${fence}\n`;
            } else {
              md += `[${name}](${url})`;
            }
          } catch {
            md += `[${name}](${url})`;
          }
        } else {
          // Upload all other files (large text, PDFs, ZIPs, etc.) to R2
          // so the link doesn't expire with the Discord CDN URL.
          let fileUrl = url;
          try {
            const res = await fetch(url);
            if (res.ok) {
              const buffer = Buffer.from(await res.arrayBuffer());
              const key = `bot-uploads/discord/${messageId}/${name}`;
              const hosted = await uploadToR2(
                key,
                buffer,
                contentType ?? "application/octet-stream",
              );
              if (hosted) fileUrl = hosted;
            }
          } catch (err) {
            logger.error(`Failed to rehost file ${name}: ${err}`);
          }
          md += `[${name}](${fileUrl})`;
        }
        break;
      }
    }
  }
  return md;
}

async function getIssueBody(params: Message): Promise<string> {
  const { guildId, channelId, id, content, author, attachments } = params;
  const { globalName, avatar } = author;

  // Strip Markdown image syntax and HTML <img> tags from Discord message content
  // before embedding in the GitHub issue body. Without this, a Discord user writing
  // ![x](https://evil.com/pixel.gif) would cause GitHub's renderer to make outbound
  // requests to attacker-controlled servers. Attachment images are handled separately
  // via attachmentsToMarkdown, which applies the isImageUrlSafe allow-list.
  const safeContent = stripImageMarkdown(content);

  return (
    `<kbd>[![${globalName}](https://cdn.discordapp.com/avatars/${author.id}/${avatar}.webp?size=40)](https://discord.com/channels/${guildId}/${channelId}/${id})</kbd> [${globalName}](https://discord.com/channels/${guildId}/${channelId}/${id})  \`BOT\`\n\n` +
    `${safeContent}\n` +
    `${await attachmentsToMarkdown(attachments, id)}\n`
  );
}

const regexForDiscordCredentials =
  /https:\/\/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)(?=\))/;
export function getDiscordInfoFromGithubBody(body: string) {
  const match = body.match(regexForDiscordCredentials);
  if (!match || match.length !== 4)
    return { channelId: undefined, id: undefined };
  const [, , channelId, id] = match;
  return { channelId, id };
}

function formatIssuesToThreads(issues: GitIssue[]): Thread[] {
  const res: Thread[] = [];
  issues.forEach(({ title, body, number, node_id, locked, state }) => {
    const { id } = getDiscordInfoFromGithubBody(body);
    if (!id) return;
    res.push({
      id,
      title,
      number,
      body,
      node_id,
      locked,
      comments: [],
      appliedTags: [],
      archived: state === "closed",
    });
  });
  return res;
}

async function update(issue_number: number, state: "open" | "closed") {
  try {
    await octokit.rest.issues.update({
      ...repoCredentials,
      issue_number,
      state,
    });
    return true;
  } catch (err) {
    return err;
  }
}

export async function closeIssue(thread: Thread) {
  const { number: issue_number } = thread;

  if (!issue_number) {
    error("Thread does not have an issue number", thread);
    return;
  }

  const response = await update(issue_number, "closed");
  if (response === true) info(Actions.Closed, thread);
  else if (response instanceof Error)
    error(`Failed to close issue: ${response.message}`, thread);
  else error("Failed to close issue due to an unknown error", thread);
}

export async function openIssue(thread: Thread) {
  const { number: issue_number } = thread;

  if (!issue_number) {
    error("Thread does not have an issue number", thread);
    return;
  }

  const response = await update(issue_number, "open");
  if (response === true) info(Actions.Reopened, thread);
  else if (response instanceof Error)
    error(`Failed to open issue: ${response.message}`, thread);
  else error("Failed to open issue due to an unknown error", thread);
}

export async function lockIssue(thread: Thread) {
  const { number: issue_number } = thread;
  if (!issue_number) {
    error("Thread does not have an issue number", thread);
    return;
  }

  try {
    await octokit.rest.issues.lock({
      ...repoCredentials,
      issue_number,
    });

    info(Actions.Locked, thread);
  } catch (err) {
    if (err instanceof Error) {
      error(`Failed to lock issue: ${err.message}`, thread);
    } else {
      error("Failed to lock issue due to an unknown error", thread);
    }
  }
}

export async function unlockIssue(thread: Thread) {
  const { number: issue_number } = thread;
  if (!issue_number) {
    error("Thread does not have an issue number", thread);
    return;
  }

  try {
    await octokit.rest.issues.unlock({
      ...repoCredentials,
      issue_number,
    });

    info(Actions.Unlocked, thread);
  } catch (err) {
    if (err instanceof Error) {
      error(`Failed to unlock issue: ${err.message}`, thread);
    } else {
      error("Failed to unlock issue due to an unknown error", thread);
    }
  }
}

export async function createIssue(thread: Thread, params: Message) {
  const { title, appliedTags, number } = thread;

  if (number) {
    error("Thread already has an issue number", thread);
    return;
  }

  try {
    const labels = appliedTags?.map(
      (id) => threadRepository.getAvailableTags().find((item) => item.id === id)?.name || "",
    );

    const body = await getIssueBody(params);
    const response = await octokit.rest.issues.create({
      ...repoCredentials,
      labels,
      title,
      body,
    });

    if (response && response.data) {
      threadRepository.updateThread(thread.id, {
        node_id: response.data.node_id,
        body: response.data.body!,
        number: response.data.number,
      });
      info(Actions.Created, thread);
    } else {
      error("Failed to create issue - No response data", thread);
    }
  } catch (err) {
    if (err instanceof Error) {
      error(`Failed to create issue: ${err.message}`, thread);
    } else {
      error("Failed to create issue due to an unknown error", thread);
    }
  }
}

export async function createIssueComment(thread: Thread, params: Message) {
  const body = await getIssueBody(params);
  const { number: issue_number } = thread;

  if (!issue_number) {
    error("Thread does not have an issue number", thread);
    return;
  }

  try {
    const response = await octokit.rest.issues.createComment({
      ...repoCredentials,
      issue_number: thread.number!,
      body,
    });
    if (response && response.data) {
      const git_id = response.data.id;
      const id = params.id;
      thread.comments.push({ id, git_id });
      info(Actions.Commented, thread);
    } else {
      error("Failed to create comment - No response data", thread);
    }
  } catch (err) {
    if (err instanceof Error) {
      error(`Failed to create comment: ${err.message}`, thread);
    } else {
      error("Failed to create comment due to an unknown error", thread);
    }
  }
}

export async function deleteIssue(thread: Thread) {
  const { node_id } = thread;
  if (!node_id) {
    error("Thread does not have a node ID", thread);
    return;
  }

  try {
    await graphqlWithAuth(
      `mutation DeleteIssue($issueId: ID!) {
        deleteIssue(input: { issueId: $issueId }) { clientMutationId }
      }`,
      { issueId: node_id },
    );
    info(Actions.Deleted, thread);
  } catch (err) {
    if (err instanceof Error) {
      error(`Error deleting issue: ${err.message}`, thread);
    } else {
      error("Error deleting issue due to an unknown error", thread);
    }
  }
}

export async function deleteComment(thread: Thread, comment_id: number) {
  try {
    await octokit.rest.issues.deleteComment({
      ...repoCredentials,
      comment_id,
    });
    info(Actions.DeletedComment, thread);
  } catch (err) {
    if (err instanceof Error) {
      error(`Failed to delete comment: ${err.message}`, thread);
    } else {
      error("Failed to delete comment due to an unknown error", thread);
    }
  }
}

export async function getIssues() {
  try {
    // Use paginate to fetch all issues — listForRepo defaults to 30 per page
    // and would silently miss older issues on repos with more than 30 total.
    const data = await octokit.paginate(octokit.rest.issues.listForRepo, {
      ...repoCredentials,
      state: "all",
      per_page: 100,
    });

    const threads = formatIssuesToThreads(data as GitIssue[]);
    await fillCommentsData(threads); // Populate thread.comments before returning
    loadInto(threads); // Restore GitHub→Discord webhook message mappings from disk
    return threads;
  } catch (err) {
    if (err instanceof Error) {
      error(`Failed to get issues: ${err.message}`);
    } else {
      error("Failed to get issues due to an unknown error");
    }
    return [];
  }
}

async function fillCommentsData(threads: Thread[]) {
  try {
    const data = await octokit.paginate(octokit.rest.issues.listCommentsForRepo, {
      ...repoCredentials,
      per_page: 100,
    });

    data.forEach((comment) => {
      const { channelId, id } = getDiscordInfoFromGithubBody(comment.body ?? "");
      if (!channelId || !id) return;

      const thread = threads.find((i) => i.id === channelId);
      thread?.comments.push({ id, git_id: comment.id });
    });
  } catch (err) {
    if (err instanceof Error) {
      error(`Failed to load comments: ${err.message}`);
    } else {
      error("Failed to load comments due to an unknown error");
    }
  }
}
