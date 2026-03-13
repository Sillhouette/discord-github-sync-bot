import dotenv from "dotenv";

dotenv.config();

const {
  DISCORD_TOKEN,
  GITHUB_ACCESS_TOKEN,
  GITHUB_USERNAME,
  GITHUB_REPOSITORY,
  DISCORD_CHANNEL_ID,
  GITHUB_WEBHOOK_SECRET,
} = process.env;

if (
  !DISCORD_TOKEN ||
  !GITHUB_ACCESS_TOKEN ||
  !GITHUB_USERNAME ||
  !GITHUB_REPOSITORY ||
  !DISCORD_CHANNEL_ID
) {
  throw new Error("Missing environment variables");
}

export const config = {
  DISCORD_TOKEN,
  GITHUB_ACCESS_TOKEN,
  GITHUB_USERNAME,
  GITHUB_REPOSITORY,
  DISCORD_CHANNEL_ID,
  // Optional in development — required in production to verify GitHub webhook signatures.
  // Generate a strong secret: openssl rand -hex 32
  // Then set the same value in GitHub → repo Settings → Webhooks → Secret.
  GITHUB_WEBHOOK_SECRET,
};
