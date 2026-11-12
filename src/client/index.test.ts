import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { defineTestApp } from "convex-test";
import { defineSchema, paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { AzureBlob } from "./index.js";
import type { BlobMetadata } from "./index.js";
import componentTest from "../test.js";

// The well-known Azurite development account. Not a secret.
const accountName = "devstoreaccount1";
const accountKey =
  "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==";
const origin = `https://${accountName}.blob.core.windows.net`;

/** An in-memory stand-in for Azure, keyed by URL path. */
const azure = new Map<string, { size: number; type: string }>();
const requests: { method: string; url: URL }[] = [];
let failNext: number | null = null;

async function fakeFetch(input: string | URL | Request, init?: RequestInit) {
  const url = new URL(input instanceof Request ? input.url : input);
  const method = init?.method ?? "GET";
  requests.push({ method, url });
  const permissions = url.searchParams.get("sp") ?? "";
  if (!url.searchParams.get("sig")) return new Response(null, { status: 403 });
  if (failNext !== null) {
    const status = failNext;
    failNext = null;
    return new Response(null, {
      status,
      headers: { "x-ms-error-code": "ServerBusy" },
    });
  }
  const notFound = new Response(null, {
    status: 404,
    headers: { "x-ms-error-code": "BlobNotFound" },
  });
  const existing = azure.get(url.pathname);
  if (method === "PUT") {
    if (existing && !permissions.includes("w")) {
      return new Response(null, { status: 403 });
    }
    const headers = new Headers(init?.headers);
    if (headers.get("x-ms-blob-type") !== "BlockBlob") {
      return new Response(null, { status: 400 });
    }
    const body = await new Response(init?.body).arrayBuffer();
    azure.set(url.pathname, {
      size: body.byteLength,
      type: headers.get("content-type") ?? "",
    });
    return new Response(null, { status: 201 });
  }
  if (method === "HEAD") {
    if (!permissions.includes("r")) return new Response(null, { status: 403 });
    if (!existing) return notFound;
    return new Response(null, {
      status: 200,
      headers: {
        "content-length": String(existing.size),
        "content-type": existing.type,
        etag: '"0x1"',
        "last-modified": "Thu, 12 Nov 2026 22:57:52 GMT",
      },
    });
  }
  if (method === "DELETE") {
    if (!permissions.includes("d")) return new Response(null, { status: 403 });
    if (!existing) return notFound;
    azure.delete(url.pathname);
    return new Response(null, { status: 202 });
  }
  return new Response(null, { status: 405 });
}

/** What the browser does with an upload URL. */
async function browserUpload(url: string, body: string, type: string) {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": type },
    body,
  });
  expect(response.status).toBe(201);
}

// A small host app for the client, without generated app files.
const app = defineTestApp({
  schema: defineSchema({}),
  components: { azureBlob: componentTest },
});
const azureBlob = new AzureBlob(app.components.azureBlob, {
  accountName,
  accountKey,
  containerName: "c1",
});
const uploads: BlobMetadata[] = [];
let onUpload: (blob: BlobMetadata) => void | Promise<void> = () => {};

async function requireUser(ctx: {
  auth: { getUserIdentity: () => Promise<unknown> };
}) {
  if (!(await ctx.auth.getUserIdentity())) throw new Error("Unauthorized");
}

const { api, createTest } = app.defineModules({
  files: {
    ...azureBlob.clientApi({
      checkUpload: requireUser,
      checkRead: requireUser,
      checkDelete: async (ctx, key) => {
        await requireUser(ctx);
        if (key.startsWith("locked/")) throw new Error("Locked");
      },
      onUpload: async (_ctx, blob) => {
        uploads.push(blob);
        await onUpload(blob);
      },
    }),
    getUrl: app.query({
      args: { key: v.string(), expiresIn: v.optional(v.number()) },
      returns: v.string(),
      handler: async (_ctx, args) => {
        return await azureBlob.getUrl(args.key, { expiresIn: args.expiresIn });
      },
    }),
    list: app.query({
      args: { paginationOpts: paginationOptsValidator },
      handler: async (ctx, args) => {
        return await azureBlob.listMetadata(ctx, args.paginationOpts);
      },
    }),
    store: app.action({
      args: { text: v.string(), key: v.optional(v.string()) },
      returns: v.string(),
      handler: async (ctx, args) => {
        return await azureBlob.store(ctx, args.text, {
          key: args.key,
          type: "text/plain",
        });
      },
    }),
    storeBlob: app.action({
      args: {},
      returns: v.string(),
      handler: async (ctx) => {
        return await azureBlob.store(
          ctx,
          new Blob(["<p>hi</p>"], { type: "text/html" }),
        );
      },
    }),
    sync: app.action({
      args: { key: v.string() },
      handler: async (ctx, args) => {
        return await azureBlob.syncMetadata(ctx, args.key);
      },
    }),
    unconfigured: app.query({
      args: {},
      handler: async () => {
        return await new AzureBlob(app.components.azureBlob).getUrl("x");
      },
    }),
  },
});

beforeEach(() => {
  azure.clear();
  requests.length = 0;
  uploads.length = 0;
  failNext = null;
  onUpload = () => {};
  vi.stubGlobal("fetch", fakeFetch);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-12T10:20:30Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const asUser = () => createTest().withIdentity({ subject: "user1" });

describe("upload flow", () => {
  test("uploads through a signed URL, then syncs metadata", async () => {
    const t = asUser();
    const { url, key } = await t.mutation(api.files.generateUploadUrl, {});
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(`${origin}/c1/${key}`);
    // Create-only, expiring in 15 minutes.
    expect(parsed.searchParams.get("sp")).toBe("c");
    expect(parsed.searchParams.get("se")).toBe("2026-11-12T10:35:30Z");

    await browserUpload(url, "hello", "text/plain");
    expect(await t.query(api.files.getMetadata, { key })).toBeNull();

    await t.action(api.files.syncMetadata, { key });
    const expected = {
      key,
      container: "c1",
      size: 5,
      contentType: "text/plain",
      etag: '"0x1"',
      lastModified: Date.parse("2026-11-12T22:57:52Z"),
    };
    expect(await t.query(api.files.getMetadata, { key })).toEqual(expected);
    expect(uploads).toEqual([expected]);
  });

  test("an upload URL cannot overwrite an existing blob", async () => {
    const { url } = await asUser().mutation(api.files.generateUploadUrl, {});
    await browserUpload(url, "one", "text/plain");
    const again = await fetch(url, {
      method: "PUT",
      headers: { "x-ms-blob-type": "BlockBlob" },
      body: "two",
    });
    expect(again.status).toBe(403);
  });

  test("a key can only be synced once through the client API", async () => {
    const base = createTest();
    const t = base.withIdentity({ subject: "user1" });
    const { url, key } = await t.mutation(api.files.generateUploadUrl, {});
    await browserUpload(url, "hello", "text/plain");
    await t.action(api.files.syncMetadata, { key });
    await expect(
      base
        .withIdentity({ subject: "user2" })
        .action(api.files.syncMetadata, { key }),
    ).rejects.toThrow("Blob already synced");
    expect(uploads).toHaveLength(1);
  });

  test("a failing onUpload undoes the sync so it can be retried", async () => {
    const t = asUser();
    const { url, key } = await t.mutation(api.files.generateUploadUrl, {});
    await browserUpload(url, "hello", "text/plain");
    onUpload = () => {
      throw new Error("Too big");
    };
    await expect(t.action(api.files.syncMetadata, { key })).rejects.toThrow(
      "Too big",
    );
    expect(await t.query(api.files.getMetadata, { key })).toBeNull();

    onUpload = () => {};
    await t.action(api.files.syncMetadata, { key });
    expect(await t.query(api.files.getMetadata, { key })).not.toBeNull();
  });

  test("syncing a key that was never uploaded fails", async () => {
    await expect(
      asUser().action(api.files.syncMetadata, { key: "nope" }),
    ).rejects.toThrow("Blob not found in Azure: nope");
    expect(uploads).toHaveLength(0);
  });
});

describe("auth checks", () => {
  test("every exposed function runs its check first", async () => {
    const t = createTest();
    await expect(t.mutation(api.files.generateUploadUrl, {})).rejects.toThrow(
      "Unauthorized",
    );
    await expect(
      t.action(api.files.syncMetadata, { key: "k" }),
    ).rejects.toThrow("Unauthorized");
    await expect(t.query(api.files.getMetadata, { key: "k" })).rejects.toThrow(
      "Unauthorized",
    );
    await expect(
      t.action(api.files.deleteObject, { key: "k" }),
    ).rejects.toThrow("Unauthorized");
    expect(requests).toHaveLength(0);
  });

  test("checkDelete receives the key and blocks the delete", async () => {
    const t = asUser();
    await t.action(api.files.store, { text: "keep", key: "locked/a.txt" });
    await expect(
      t.action(api.files.deleteObject, { key: "locked/a.txt" }),
    ).rejects.toThrow("Locked");
    expect(azure.has("/c1/locked/a.txt")).toBe(true);
  });
});

describe("store", () => {
  test("uploads from an action and records metadata", async () => {
    const t = asUser();
    const key = await t.action(api.files.store, { text: "hello world" });
    expect(azure.get(`/c1/${key}`)).toEqual({ size: 11, type: "text/plain" });
    expect(await t.query(api.files.getMetadata, { key })).toMatchObject({
      key,
      size: 11,
      contentType: "text/plain",
    });
  });

  test("uses a Blob's own type and overwrites an existing key", async () => {
    const t = asUser();
    const key = await t.action(api.files.storeBlob, {});
    expect(azure.get(`/c1/${key}`)?.type).toBe("text/html");

    await t.action(api.files.store, { text: "v1", key: "a/b.txt" });
    await t.action(api.files.store, { text: "version 2", key: "a/b.txt" });
    expect(
      (await t.query(api.files.getMetadata, { key: "a/b.txt" }))?.size,
    ).toBe(9);
  });

  test("surfaces Azure errors without leaking the signed URL", async () => {
    failNext = 503;
    const error = await asUser()
      .action(api.files.store, { text: "x", key: "k" })
      .catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      'failed to store "k": 503 ServerBusy',
    );
    expect((error as Error).message).not.toContain("sig=");
  });
});

describe("deleteObject", () => {
  test("deletes the blob and its metadata", async () => {
    const t = asUser();
    const key = await t.action(api.files.store, { text: "bye" });
    await t.action(api.files.deleteObject, { key });
    expect(azure.size).toBe(0);
    expect(await t.query(api.files.getMetadata, { key })).toBeNull();
  });

  test("succeeds when the blob is already gone", async () => {
    const t = asUser();
    const key = await t.action(api.files.store, { text: "bye" });
    azure.clear();
    await t.action(api.files.deleteObject, { key });
    expect(await t.query(api.files.getMetadata, { key })).toBeNull();
  });

  test("keeps the metadata if Azure fails", async () => {
    const t = asUser();
    const key = await t.action(api.files.store, { text: "bye" });
    failNext = 500;
    await expect(t.action(api.files.deleteObject, { key })).rejects.toThrow(
      "failed to delete",
    );
    expect(await t.query(api.files.getMetadata, { key })).not.toBeNull();
  });
});

describe("syncMetadata", () => {
  test("removes a stale row when the blob has gone from Azure", async () => {
    const t = asUser();
    const key = await t.action(api.files.store, { text: "x" });
    azure.clear();
    await expect(t.action(api.files.sync, { key })).rejects.toThrow(
      "Blob not found",
    );
    expect(await t.query(api.files.getMetadata, { key })).toBeNull();
  });
});

describe("listMetadata", () => {
  test("paginates the container's blobs", async () => {
    const t = asUser();
    for (const key of ["b", "a", "c"]) {
      await t.action(api.files.store, { text: key, key });
    }
    const result = await t.query(api.files.list, {
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(result.page.map((blob) => blob.key)).toEqual(["a", "b"]);
    expect(result.isDone).toBe(false);
    const rest = await t.query(api.files.list, {
      paginationOpts: { numItems: 2, cursor: result.continueCursor },
    });
    expect(rest.page.map((blob) => blob.key)).toEqual(["c"]);
    expect(rest.isDone).toBe(true);
  });
});

describe("getUrl", () => {
  test("returns a read-only URL", async () => {
    const url = new URL(await asUser().query(api.files.getUrl, { key: "a/b" }));
    expect(url.origin + url.pathname).toBe(`${origin}/c1/a/b`);
    expect(url.searchParams.get("sp")).toBe("r");
  });

  test("is stable within a window and valid for 1x to 2x expiresIn", async () => {
    const t = asUser();
    const args = { key: "k", expiresIn: 600 };
    // 10:20:30 falls in the 10:20-10:30 window, so the URL expires at 10:40.
    const first = await t.query(api.files.getUrl, args);
    expect(new URL(first).searchParams.get("se")).toBe("2026-11-12T10:40:00Z");

    vi.setSystemTime(new Date("2026-11-12T10:29:59Z"));
    expect(await t.query(api.files.getUrl, args)).toBe(first);

    vi.setSystemTime(new Date("2026-11-12T10:30:00Z"));
    const next = await t.query(api.files.getUrl, args);
    expect(new URL(next).searchParams.get("se")).toBe("2026-11-12T10:50:00Z");
  });

  test("defaults to one hour", async () => {
    const url = await asUser().query(api.files.getUrl, { key: "k" });
    expect(new URL(url).searchParams.get("se")).toBe("2026-11-12T12:00:00Z");
  });
});

describe("configuration", () => {
  test("reads credentials from environment variables", async () => {
    vi.stubEnv("AZURE_STORAGE_ACCOUNT", "envaccount");
    vi.stubEnv("AZURE_STORAGE_ACCOUNT_KEY", accountKey);
    vi.stubEnv("AZURE_STORAGE_CONTAINER", "envcontainer");
    const url = new URL(await asUser().query(api.files.unconfigured, {}));
    expect(url.origin + url.pathname).toBe(
      "https://envaccount.blob.core.windows.net/envcontainer/x",
    );
  });

  test("honours an endpoint override", async () => {
    vi.stubEnv("AZURE_STORAGE_ACCOUNT", accountName);
    vi.stubEnv("AZURE_STORAGE_ACCOUNT_KEY", accountKey);
    vi.stubEnv("AZURE_STORAGE_CONTAINER", "c1");
    vi.stubEnv("AZURE_STORAGE_ENDPOINT", "http://127.0.0.1:10000/dev");
    const url = new URL(await asUser().query(api.files.unconfigured, {}));
    expect(url.origin + url.pathname).toBe("http://127.0.0.1:10000/dev/c1/x");
    expect(url.searchParams.get("spr")).toBe("https,http");
  });

  test("names the missing environment variables", async () => {
    vi.stubEnv("AZURE_STORAGE_ACCOUNT", "envaccount");
    vi.stubEnv("AZURE_STORAGE_ACCOUNT_KEY", "");
    vi.stubEnv("AZURE_STORAGE_CONTAINER", "");
    await expect(asUser().query(api.files.unconfigured, {})).rejects.toThrow(
      "Set AZURE_STORAGE_ACCOUNT_KEY, AZURE_STORAGE_CONTAINER",
    );
  });
});
