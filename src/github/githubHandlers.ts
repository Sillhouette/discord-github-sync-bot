import { Request } from "express";
import {
  archiveThread,
  createComment,
  createThread,
  deleteThread,
  lockThread,
  unarchiveThread,
  unlockThread,
  updateComment,
} from "../discord/discordActions";
import { GitHubLabel } from "../interfaces";
import { logger } from "../logger";
import { store } from "../store";
import { getDiscordInfoFromGithubBody } from "./githubActions";

function getIssueNodeId(req: Request): string | undefined {
  return req.body.issue.node_id;
}

export async function handleOpened(req: Request) {
  if (!req.body.issue) return;
  const { node_id, number, title, user, body, labels } = req.body.issue;

  logger.info(`handleOpened: node_id=${node_id} title="${title}"`);

  if (store.threads.some((thread) => thread.node_id === node_id)) {
    logger.info(`handleOpened: skipping node_id=${node_id} — thread already tracked`);
    return;
  }

  const { login } = user;
  const appliedTags = (<GitHubLabel[]>labels)
    .map(
      (label) =>
        store.availableTags.find((tag) => tag.name === label.name)?.id || "",
    )
    .filter((i) => i);

  await createThread({ login, appliedTags, number, title, body, node_id });
}

export async function handleCreated(req: Request) {
  const { user, id, body } = req.body.comment;
  const { login, avatar_url, type: userType } = user;
  const { node_id } = req.body.issue;

  logger.info(`handleCreated: git_id=${id} login=${login} userType=${userType} node_id=${node_id}`);

  // Check if the comment already contains Discord info
  if (getDiscordInfoFromGithubBody(body).channelId) {
    // If it does, stop processing (assuming created with a bot)
    logger.info(`handleCreated: skipping git_id=${id} — body contains Discord URL`);
    return;
  }

  logger.info(`handleCreated: creating discord comment for git_id=${id}`);
  await createComment({
    git_id: id,
    body,
    login,
    avatar_url,
    node_id,
  });
}

export async function handleEdited(req: Request) {
  // issues.edited fires for issue title/body edits (no comment field) as well as
  // issue_comment.edited events — guard to avoid a crash on the former.
  if (!req.body.comment) return;

  const { id, body, user } = req.body.comment;
  const { node_id } = req.body.issue;
  const login = user?.login ?? "unknown";

  logger.info(`handleEdited: git_id=${id} login=${login} node_id=${node_id}`);

  // Skip comments that originated from the Discord bot
  if (getDiscordInfoFromGithubBody(body).channelId) {
    logger.info(`handleEdited: skipping git_id=${id} — body contains Discord URL`);
    return;
  }

  const thread = store.threads.find((t) => t.node_id === node_id);
  if (!thread) {
    logger.warn(`handleEdited: no thread found for node_id=${node_id} git_id=${id}`);
    return;
  }

  const comment = thread.comments.find((c) => c.git_id === id);
  if (!comment) {
    logger.warn(
      `handleEdited: no comment mapping for git_id=${id} in thread ${thread.id} ` +
        `(${thread.comments.length} comments tracked: [${thread.comments.map((c) => c.git_id).join(", ")}])`,
    );
    return;
  }

  logger.info(`handleEdited: updating discord_id=${comment.id} for git_id=${id}`);
  await updateComment({
    discord_id: comment.id,
    body,
    node_id,
  });
}

export async function handleClosed(req: Request) {
  const node_id = getIssueNodeId(req);
  await archiveThread(node_id);
}

export async function handleReopened(req: Request) {
  const node_id = getIssueNodeId(req);
  await unarchiveThread(node_id);
}

export async function handleLocked(req: Request) {
  const node_id = getIssueNodeId(req);
  await lockThread(node_id);
}

export async function handleUnlocked(req: Request) {
  const node_id = getIssueNodeId(req);
  await unlockThread(node_id);
}

export async function handleDeleted(req: Request) {
  // issue_comment.deleted echoes back as a "deleted" webhook event with a
  // comment field. Guard here to avoid nuking the Discord thread when the
  // bot deletes a comment and GitHub fires the echo.
  if (req.body.comment) return;
  const node_id = getIssueNodeId(req);
  await deleteThread(node_id);
}
