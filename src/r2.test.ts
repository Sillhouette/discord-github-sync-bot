import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted() runs before static imports — set env vars so r2.ts sees them,
// and stub fetch before any module code runs.
const { mockFetch } = vi.hoisted(() => {
  process.env.CLOUDFLARE_ACCOUNT_ID = "test-account";
  process.env.CLOUDFLARE_API_TOKEN = "test-token";
  const mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
  return { mockFetch };
});

import { uploadToR2 } from "./r2";

describe("uploadToR2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should upload to R2 and return the CDN URL on success", async () => {
    // Arrange
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK" });
    const buffer = Buffer.from("hello");

    // Act
    const result = await uploadToR2("bot-uploads/discord/msg1/img.png", buffer, "image/png");

    // Assert
    expect(result).toBe("https://cdn.theoatrix.app/bot-uploads/discord/msg1/img.png");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/r2/buckets/osrs-content/objects/"),
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
          "Content-Type": "image/png",
        }),
        body: buffer,
      }),
    );
  });

  it("should return null when credentials are not configured", async () => {
    // Arrange
    const savedAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
    const savedToken = process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;

    // Act — getCredentials() reads env at call time, so no module reset needed
    const result = await uploadToR2("some/key", Buffer.from("x"), "text/plain");

    // Assert
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();

    // Restore
    process.env.CLOUDFLARE_ACCOUNT_ID = savedAccount;
    process.env.CLOUDFLARE_API_TOKEN = savedToken;
  });

  it("should encode each path segment individually, preserving slashes", async () => {
    // Arrange — filename with a space, which Discord allows
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK" });
    const key = "bot-uploads/discord/msg1/My Screenshot.png";

    // Act
    const result = await uploadToR2(key, Buffer.from("x"), "image/png");

    // Assert — slashes preserved, space encoded to %20 in both API URL and CDN URL
    const expectedEncoded = "bot-uploads/discord/msg1/My%20Screenshot.png";
    expect(result).toBe(`https://cdn.theoatrix.app/${expectedEncoded}`);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(`/objects/${expectedEncoded}`),
      expect.anything(),
    );
  });

  it("should throw when the API returns a non-ok response", async () => {
    // Arrange
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403, statusText: "Forbidden" });

    // Act & Assert
    await expect(
      uploadToR2("some/key", Buffer.from("x"), "application/octet-stream"),
    ).rejects.toThrow("R2 upload failed: 403 Forbidden");
  });
});
