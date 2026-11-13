/**
 * Runs the client against a real Azurite emulator, to check that Azure
 * accepts what we sign. Run with `pnpm run test:integration`.
 */
import { describe, expect, inject, test } from "vitest";
import { defineTestApp } from "convex-test";
import { defineSchema } from "convex/server";
import { v } from "convex/values";
import { AzureBlob } from "./index.js";
import componentTest from "../test.js";
import { generateBlobSasUrl } from "../shared/sas.js";

declare module "vitest" {
  export interface ProvidedContext {
    azurite: {
      accountName: string;
      accountKey: string;
      containerName: string;
      endpoint: string;
    };
  }
}

const azurite = inject("azurite");

const app = defineTestApp({
  schema: defineSchema({}),
  components: { azureBlob: componentTest },
});
const azureBlob = new AzureBlob(app.components.azureBlob, azurite);
const allow = async () => {};
const { api, createTest } = app.defineModules({
  files: {
    ...azureBlob.clientApi({
      checkUpload: allow,
      checkRead: allow,
      checkDelete: allow,
    }),
    generateUploadUrlFor: app.mutation({
      args: { key: v.string() },
      handler: async (_ctx, args) => {
        return await azureBlob.generateUploadUrl(args.key);
      },
    }),
    getUrl: app.query({
      args: { key: v.string() },
      returns: v.string(),
      handler: async (_ctx, args) => await azureBlob.getUrl(args.key),
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
  },
});

function put(url: string, body: string, type = "text/plain") {
  return fetch(url, {
    method: "PUT",
    headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": type },
    body,
  });
}

describe("against Azurite", () => {
  test("browser upload, sync, read and delete", async () => {
    const t = createTest();
    const { url, key } = await t.mutation(api.files.generateUploadUrl, {});
    expect((await put(url, "hello azure", "image/png")).status).toBe(201);

    await t.action(api.files.syncMetadata, { key });
    const metadata = await t.query(api.files.getMetadata, { key });
    expect(metadata).toMatchObject({
      key,
      container: azurite.containerName,
      size: 11,
      contentType: "image/png",
    });
    expect(metadata?.etag).toMatch(/^".+"$/);
    expect(Math.abs(metadata!.lastModified - Date.now())).toBeLessThan(60_000);

    const readUrl = await t.query(api.files.getUrl, { key });
    const read = await fetch(readUrl);
    expect(read.status).toBe(200);
    expect(read.headers.get("content-type")).toBe("image/png");
    expect(await read.text()).toBe("hello azure");

    await t.action(api.files.deleteObject, { key });
    expect((await fetch(readUrl)).status).toBe(404);
    expect(await t.query(api.files.getMetadata, { key })).toBeNull();
    // Deleting again is not an error.
    await t.action(api.files.deleteObject, { key });
  });

  test("an upload URL creates a blob but cannot overwrite or read it", async () => {
    const { url } = await createTest().mutation(
      api.files.generateUploadUrl,
      {},
    );
    expect((await put(url, "first")).status).toBe(201);
    const overwrite = await put(url, "second");
    expect(overwrite.status).toBe(403);
    await overwrite.text();
    const read = await fetch(url);
    expect(read.status).toBe(403);
    await read.text();
  });

  test("a read URL cannot write or delete", async () => {
    const t = createTest();
    const key = await t.action(api.files.store, { text: "read only" });
    const readUrl = await t.query(api.files.getUrl, { key });
    const write = await put(readUrl, "changed");
    expect(write.status).toBe(403);
    await write.text();
    const del = await fetch(readUrl, { method: "DELETE" });
    expect(del.status).toBe(403);
    await del.text();
    expect(await (await fetch(readUrl)).text()).toBe("read only");
  });

  test("store overwrites an existing key", async () => {
    const t = createTest();
    const key = `overwrite-${crypto.randomUUID()}.txt`;
    await t.action(api.files.store, { text: "v1", key });
    await t.action(api.files.store, { text: "version 2", key });
    expect((await t.query(api.files.getMetadata, { key }))?.size).toBe(9);
    const readUrl = await t.query(api.files.getUrl, { key });
    expect(await (await fetch(readUrl)).text()).toBe("version 2");
  });

  test("keys with slashes, spaces and non-ASCII characters round-trip", async () => {
    const t = createTest();
    const key = `users/${crypto.randomUUID()}/été photo #1 +(a&b)?.txt`;
    const { url } = await t.mutation(api.files.generateUploadUrlFor, { key });
    expect((await put(url, "tricky")).status).toBe(201);
    await t.action(api.files.syncMetadata, { key });
    expect((await t.query(api.files.getMetadata, { key }))?.size).toBe(6);
    const readUrl = await t.query(api.files.getUrl, { key });
    expect(await (await fetch(readUrl)).text()).toBe("tricky");
    await t.action(api.files.deleteObject, { key });
    expect((await fetch(readUrl)).status).toBe(404);
  });

  test("syncing a key that was never uploaded fails", async () => {
    await expect(
      createTest().action(api.files.syncMetadata, { key: "never-uploaded" }),
    ).rejects.toThrow("Blob not found in Azure");
  });

  test("expired and tampered URLs are rejected", async () => {
    const t = createTest();
    const key = await t.action(api.files.store, { text: "secret" });

    const expired = await fetch(
      await generateBlobSasUrl({
        ...azurite,
        blobName: key,
        permissions: "r",
        expiresOn: Date.now() - 60_000,
      }),
    );
    expect(expired.status).toBe(403);
    await expired.text();

    // A URL signed for one blob must not open another.
    const other = await t.action(api.files.store, { text: "other" });
    const tampered = (await t.query(api.files.getUrl, { key: other })).replace(
      other,
      key,
    );
    const response = await fetch(tampered);
    expect(response.status).toBe(403);
    await response.text();
  });
});
