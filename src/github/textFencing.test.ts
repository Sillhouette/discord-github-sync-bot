import { describe, it, expect, vi, beforeEach } from "vitest";
import { Attachment, Collection } from "discord.js";

// ac_id: AC-4
// These tests specifically verify that text attachments containing triple-backtick
// content do not break issue body formatting (tilde fencing prevents backtick injection).

vi.mock("../r2", () => ({ uploadToR2: vi.fn() }));
vi.mock("../config", () => ({
  config: {
    GITHUB_ACCESS_TOKEN: "test-token",
    GITHUB_USERNAME: "testuser",
    GITHUB_REPOSITORY: "testrepo",
    DISCORD_TOKEN: "test-discord-token",
    DISCORD_CHANNEL_ID: "test-channel-id",
  },
}));
vi.mock("../logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
  Actions: {},
  Triggerer: {},
  getGithubUrl: vi.fn(),
}));
vi.mock("../store", () => ({ store: { threads: [] } }));

import { attachmentsToMarkdown } from "./githubActions";

function makeAttachment(fields: Partial<Attachment> & { size?: number }): Attachment {
  return {
    url: "https://cdn.discordapp.com/attachments/default.txt",
    name: "default.txt",
    contentType: "text/plain",
    size: 100,
    ...fields,
  } as unknown as Attachment;
}

function makeCollection(items: Attachment[]): Collection<string, Attachment> {
  const col = new Collection<string, Attachment>();
  items.forEach((item, i) => col.set(String(i), item));
  return col;
}

/** Returns true if the content is properly wrapped: fence open, content verbatim, fence close. */
function isProperlyFenced(result: string, content: string): boolean {
  const fenceMatch = result.match(/^(~{3,})$/m);
  if (!fenceMatch) return false;
  const fence = fenceMatch[1];
  return result.includes(`${fence}\n${content}\n${fence}`);
}

describe("text attachment fencing (AC-4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("AC-4: text file containing triple-backticks does not break the fence", async () => {
    // ac_id: AC-4
    // The attachment body contains ```, which would close a backtick fence early.
    // Tilde fencing (~~~) prevents this — the content renders intact.

    // Arrange
    const contentWithBackticks = "Here is some code:\n```\nconst x = 1;\n```\nEnd of file.";
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      text: async () => contentWithBackticks,
    } as unknown as Response);

    const attachments = makeCollection([
      makeAttachment({ name: "code.txt", contentType: "text/plain", size: contentWithBackticks.length }),
    ]);

    // Act
    const result = await attachmentsToMarkdown(attachments, "msg-ac4");

    // Assert — content is verbatim inside a tilde fence.
    // isProperlyFenced verifies the fence delimiter is tildes, not backticks.
    // (The content itself contains ``` on its own line, which is fine inside a tilde fence.)
    expect(isProperlyFenced(result, contentWithBackticks)).toBe(true);
  });

  it("AC-4: tilde fence does not use backtick fencing for text attachments", async () => {
    // ac_id: AC-4

    // Arrange
    const simpleContent = "Hello, world!";
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      text: async () => simpleContent,
    } as unknown as Response);

    const attachments = makeCollection([
      makeAttachment({ name: "hello.txt", contentType: "text/plain", size: 13 }),
    ]);

    // Act
    const result = await attachmentsToMarkdown(attachments, "msg-ac4b");

    // Assert — content without tildes uses the minimal ~~~ fence
    expect(result).toContain("~~~\n" + simpleContent + "\n~~~");
    expect(result).not.toMatch(/^```\s*$/m);
  });

  it("AC-4 edge: normal text content is still rendered inside tilde fence", async () => {
    // ac_id: AC-4

    // Arrange
    const normalContent = "A regular log file\nWith multiple lines\nNo special chars";
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      text: async () => normalContent,
    } as unknown as Response);

    const attachments = makeCollection([
      makeAttachment({ name: "log.txt", contentType: "text/plain", size: normalContent.length }),
    ]);

    // Act
    const result = await attachmentsToMarkdown(attachments, "msg-ac4c");

    // Assert
    expect(result).toContain("**Attached: log.txt**");
    expect(isProperlyFenced(result, normalContent)).toBe(true);
  });

  it("AC-4 security: content containing ~~~ uses a longer fence (~~~~ or more)", async () => {
    // ac_id: AC-4
    // A tilde fence can be broken by a line of exactly ~~~ in the content, just as
    // backtick fences are broken by ```. The fix: compute the minimum fence length
    // that cannot appear as a prefix of any interior line.

    // Arrange — content that would escape a fixed ~~~ fence
    const maliciousContent = "safe line\n~~~\n![injected](http://evil.com)\nmore content";
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      text: async () => maliciousContent,
    } as unknown as Response);

    const attachments = makeCollection([
      makeAttachment({ name: "evil.txt", contentType: "text/plain", size: maliciousContent.length }),
    ]);

    // Act
    const result = await attachmentsToMarkdown(attachments, "msg-ac4-bypass");

    // Assert — fence must be longer than any interior ~~~ run, and content verbatim
    expect(isProperlyFenced(result, maliciousContent)).toBe(true);
    // The opening fence must be ~~~~ or longer (>3 tildes) to contain the interior ~~~
    expect(result).toMatch(/^~{4,}$/m);
  });

  it("AC-4 security: content containing ~~~~ uses a fence of ~~~~~ or more", async () => {
    // ac_id: AC-4 — fence length scales with the longest interior tilde run

    // Arrange
    const content = "line one\n~~~~\nline two";
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      text: async () => content,
    } as unknown as Response);

    const attachments = makeCollection([
      makeAttachment({ name: "nested.txt", contentType: "text/plain", size: content.length }),
    ]);

    // Act
    const result = await attachmentsToMarkdown(attachments, "msg-ac4-deep");

    // Assert — fence must be ~~~~~ or longer to enclose the ~~~~ interior run
    expect(isProperlyFenced(result, content)).toBe(true);
    expect(result).toMatch(/^~{5,}$/m);
  });
});
