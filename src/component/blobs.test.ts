import { describe, expect, test } from "vitest";
import { api } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";

const photo = {
  key: "photo.png",
  container: "c1",
  size: 123,
  contentType: "image/png",
  etag: '"0x1"',
  lastModified: 1_700_000_000_000,
};

describe("blobs", () => {
  test("upsert then get returns the metadata without system fields", async () => {
    const t = initConvexTest();
    await t.mutation(api.blobs.upsert, photo);
    expect(
      await t.query(api.blobs.get, { container: "c1", key: "photo.png" }),
    ).toEqual(photo);
  });

  test("get returns null for an unknown key", async () => {
    const t = initConvexTest();
    expect(
      await t.query(api.blobs.get, { container: "c1", key: "missing" }),
    ).toBeNull();
  });

  test("upsert replaces the row for the same container and key", async () => {
    const t = initConvexTest();
    await t.mutation(api.blobs.upsert, photo);
    // No contentType this time: the old one must not linger.
    const { contentType: _, ...withoutType } = photo;
    const updated = { ...withoutType, size: 456, etag: '"0x2"' };
    await t.mutation(api.blobs.upsert, updated);
    expect(
      await t.query(api.blobs.get, { container: "c1", key: "photo.png" }),
    ).toEqual(updated);
    const all = await t.run((ctx) => ctx.db.query("blobs").collect());
    expect(all).toHaveLength(1);
  });

  test("the same key in different containers is kept separately", async () => {
    const t = initConvexTest();
    await t.mutation(api.blobs.upsert, photo);
    await t.mutation(api.blobs.upsert, { ...photo, container: "c2", size: 9 });
    expect(
      (await t.query(api.blobs.get, { container: "c1", key: "photo.png" }))
        ?.size,
    ).toBe(123);
    expect(
      (await t.query(api.blobs.get, { container: "c2", key: "photo.png" }))
        ?.size,
    ).toBe(9);
  });

  test("list paginates one container's blobs in key order", async () => {
    const t = initConvexTest();
    for (const key of ["b", "c", "a"]) {
      await t.mutation(api.blobs.upsert, { ...photo, key });
    }
    await t.mutation(api.blobs.upsert, { ...photo, container: "c2", key: "z" });

    const first = await t.query(api.blobs.list, {
      container: "c1",
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(first.page.map((b) => b.key)).toEqual(["a", "b"]);
    expect(first.isDone).toBe(false);

    const second = await t.query(api.blobs.list, {
      container: "c1",
      paginationOpts: { numItems: 2, cursor: first.continueCursor },
    });
    expect(second.page.map((b) => b.key)).toEqual(["c"]);
    expect(second.isDone).toBe(true);
  });

  test("remove deletes the row and reports whether it existed", async () => {
    const t = initConvexTest();
    await t.mutation(api.blobs.upsert, photo);
    const args = { container: "c1", key: "photo.png" };
    expect(await t.mutation(api.blobs.remove, args)).toBe(true);
    expect(await t.query(api.blobs.get, args)).toBeNull();
    expect(await t.mutation(api.blobs.remove, args)).toBe(false);
  });
});
