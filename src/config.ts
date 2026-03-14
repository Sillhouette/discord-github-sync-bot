import dotenv from "dotenv";

dotenv.config();

const {
  DISCORD_TOKEN,
  GITHUB_ACCESS_TOKEN,
  GITHUB_USERNAME,
  GITHUB_REPOSITORY,
  DISCORD_CHANNEL_ID,
  // Optional — security hardening for webhook signature verification
  GITHUB_WEBHOOK_SECRET,
  // Optional — R2 image re-hosting feature
  R2_BUCKET,
  R2_CDN_BASE_URL,
} = process.env;

// Required vars — throw immediately so the bot fails fast on misconfiguration
const missing = (
  [
    ["DISCORD_TOKEN", DISCORD_TOKEN],
    ["GITHUB_ACCESS_TOKEN", GITHUB_ACCESS_TOKEN],
    ["GITHUB_USERNAME", GITHUB_USERNAME],
    ["GITHUB_REPOSITORY", GITHUB_REPOSITORY],
    ["DISCORD_CHANNEL_ID", DISCORD_CHANNEL_ID],
  ] as [string, string | undefined][]
)
  .filter(([, v]) => !v)
  .map(([k]) => k);

if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
}

// Startup warning when webhook signature verification is disabled
if (!GITHUB_WEBHOOK_SECRET) {
  console.warn(
    "[SECURITY] \u26a0 GITHUB_WEBHOOK_SECRET not set \u2014 webhook endpoint is unauthenticated. Set this in production.",
  );
}

export const config = {
  // Required — throw guard above guarantees these are defined
  DISCORD_TOKEN: DISCORD_TOKEN as string,
  GITHUB_ACCESS_TOKEN: GITHUB_ACCESS_TOKEN as string,
  GITHUB_USERNAME: GITHUB_USERNAME as string,
  GITHUB_REPOSITORY: GITHUB_REPOSITORY as string,
  DISCORD_CHANNEL_ID: DISCORD_CHANNEL_ID as string,
  // Optional — undefined when not set; callers must guard before use
  GITHUB_WEBHOOK_SECRET: GITHUB_WEBHOOK_SECRET as string | undefined,
  R2_BUCKET: R2_BUCKET as string | undefined,
  R2_CDN_BASE_URL: R2_CDN_BASE_URL as string | undefined,
};
