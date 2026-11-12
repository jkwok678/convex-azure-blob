import { afterEach, describe, expect, test, vi } from "vitest";
import { uploadFile } from "./index.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup(status = 201) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => {
    calls.push("put");
    return new Response(null, { status });
  });
  vi.stubGlobal("fetch", fetchMock);
  const functions = {
    generateUploadUrl: vi.fn(async () => {
      calls.push("generateUploadUrl");
      return {
        url: "https://acct.blob.core.windows.net/c1/k1?sig=x",
        key: "k1",
      };
    }),
    syncMetadata: vi.fn(async (_args: { key: string }) => {
      calls.push("syncMetadata");
      return null;
    }),
  };
  return { calls, fetchMock, functions };
}

describe("uploadFile", () => {
  test("gets a URL, uploads, then syncs, and returns the key", async () => {
    const { calls, fetchMock, functions } = setup();
    const file = new Blob(["hello"], { type: "image/png" });

    expect(await uploadFile(file, functions)).toBe("k1");

    expect(calls).toEqual(["generateUploadUrl", "put", "syncMetadata"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://acct.blob.core.windows.net/c1/k1?sig=x");
    expect(init.method).toBe("PUT");
    expect(init.headers).toEqual({
      "x-ms-blob-type": "BlockBlob",
      "Content-Type": "image/png",
    });
    expect(init.body).toBe(file);
    expect(functions.syncMetadata).toHaveBeenCalledWith({ key: "k1" });
  });

  test("falls back to a generic content type", async () => {
    const { fetchMock, functions } = setup();
    await uploadFile(new Blob(["x"]), functions);
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      "Content-Type": "application/octet-stream",
    });
  });

  test("does not sync when the upload fails", async () => {
    const { functions } = setup(403);
    await expect(uploadFile(new Blob(["x"]), functions)).rejects.toThrow(
      "Upload to Azure Blob Storage failed: 403",
    );
    expect(functions.syncMetadata).not.toHaveBeenCalled();
  });
});
