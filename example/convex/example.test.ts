import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { initConvexTest } from "./setup.test";
import { api } from "./_generated/api";

/** A minimal in-memory stand-in for Azure Blob Storage. */
const azure = new Map<string, { size: number; type: string }>();

async function fakeFetch(input: string | URL | Request, init?: RequestInit) {
  const { pathname } = new URL(input instanceof Request ? input.url : input);
  const method = init?.method ?? "GET";
  const blob = azure.get(pathname);
  if (method === "PUT") {
    const body = await new Response(init?.body).arrayBuffer();
    azure.set(pathname, {
      size: body.byteLength,
      type: new Headers(init?.headers).get("content-type") ?? "",
    });
    return new Response(null, { status: 201 });
  }
  if (!blob) return new Response(null, { status: 404 });
  if (method === "DELETE") {
    azure.delete(pathname);
    return new Response(null, { status: 202 });
  }
  return new Response(null, {
    status: 200,
    headers: {
      "content-length": String(blob.size),
      "content-type": blob.type,
      etag: '"0x1"',
      "last-modified": "Thu, 12 Nov 2026 22:57:52 GMT",
    },
  });
}

type TestUser = ReturnType<ReturnType<typeof initConvexTest>["withIdentity"]>;

/** What the `useUploadFile` hook does in the browser. */
async function upload(t: TestUser, body: string, type: string) {
  const { url, key } = await t.mutation(api.example.generateUploadUrl, {});
  await fetch(url, {
    method: "PUT",
    headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": type },
    body,
  });
  await t.action(api.example.syncMetadata, { key });
  return key;
}

beforeEach(() => {
  azure.clear();
  vi.stubGlobal("fetch", fakeFetch);
  vi.stubEnv("AZURE_STORAGE_ACCOUNT", "devstoreaccount1");
  // The well-known Azurite development key. Not a secret.
  vi.stubEnv(
    "AZURE_STORAGE_ACCOUNT_KEY",
    "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==",
  );
  vi.stubEnv("AZURE_STORAGE_CONTAINER", "images");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("example", () => {
  test("a user uploads an image and sees it in their list", async () => {
    const t = initConvexTest();
    const alice = t.withIdentity({ tokenIdentifier: "alice" });
    const key = await upload(alice, "fake png bytes", "image/png");

    const images = await alice.query(api.example.listImages, {});
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      key,
      size: 14,
      contentType: "image/png",
    });
    expect(images[0].url).toContain(`/images/${key}?`);
    expect(new URL(images[0].url).searchParams.get("sp")).toBe("r");
  });

  test("users only see and read their own images", async () => {
    const t = initConvexTest();
    const alice = t.withIdentity({ tokenIdentifier: "alice" });
    const bob = t.withIdentity({ tokenIdentifier: "bob" });
    const key = await upload(alice, "fake png bytes", "image/png");

    expect(await bob.query(api.example.listImages, {})).toEqual([]);
    await expect(bob.query(api.example.getMetadata, { key })).rejects.toThrow(
      "Not your image",
    );
    expect(await alice.query(api.example.getMetadata, { key })).toMatchObject({
      key,
    });
  });

  test("another user cannot claim an uploaded key by re-syncing it", async () => {
    const t = initConvexTest();
    const alice = t.withIdentity({ tokenIdentifier: "alice" });
    const bob = t.withIdentity({ tokenIdentifier: "bob" });
    const key = await upload(alice, "fake png bytes", "image/png");

    await expect(bob.action(api.example.syncMetadata, { key })).rejects.toThrow(
      "Blob already synced",
    );
    expect(await bob.query(api.example.listImages, {})).toEqual([]);
  });

  test("uploads that are not images are rejected and deleted", async () => {
    const t = initConvexTest();
    const alice = t.withIdentity({ tokenIdentifier: "alice" });
    await expect(upload(alice, "#!/bin/sh", "text/x-sh")).rejects.toThrow(
      "Only images up to 5 MB are allowed",
    );
    expect(azure.size).toBe(0);
    expect(await alice.query(api.example.listImages, {})).toEqual([]);
  });

  test("oversized images are rejected and deleted", async () => {
    const t = initConvexTest();
    const alice = t.withIdentity({ tokenIdentifier: "alice" });
    const tooBig = "x".repeat(5 * 1024 * 1024 + 1);
    await expect(upload(alice, tooBig, "image/png")).rejects.toThrow(
      "Only images up to 5 MB are allowed",
    );
    expect(azure.size).toBe(0);
  });

  test("only the owner can delete an image", async () => {
    const t = initConvexTest();
    const alice = t.withIdentity({ tokenIdentifier: "alice" });
    const bob = t.withIdentity({ tokenIdentifier: "bob" });
    const key = await upload(alice, "fake png bytes", "image/png");

    await expect(bob.action(api.example.deleteImage, { key })).rejects.toThrow(
      "Not your image",
    );
    expect(azure.size).toBe(1);

    await alice.action(api.example.deleteImage, { key });
    expect(azure.size).toBe(0);
    expect(await alice.query(api.example.listImages, {})).toEqual([]);
  });
});
