import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import type { QueryCtx } from "./_generated/server.js";
import type { Doc } from "./_generated/dataModel.js";
import { blobFields } from "./schema.js";

const blobValidator = v.object(blobFields);

/** Strips system fields, so apps never depend on the component's row IDs. */
function toBlob(doc: Doc<"blobs">) {
  const { _id, _creationTime, ...blob } = doc;
  return blob;
}

/** Finds the row for one blob, if it has been synced. */
async function findBlob(ctx: QueryCtx, container: string, key: string) {
  return await ctx.db
    .query("blobs")
    .withIndex("by_container_and_key", (q) =>
      q.eq("container", container).eq("key", key),
    )
    .unique();
}

/** Records a blob's metadata, replacing any existing row for the same key. */
export const upsert = mutation({
  args: blobFields,
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await findBlob(ctx, args.container, args.key);
    if (existing) {
      await ctx.db.replace("blobs", existing._id, args);
    } else {
      await ctx.db.insert("blobs", args);
    }
    return null;
  },
});

/** Returns a blob's metadata, or null if it has not been synced. */
export const get = query({
  args: { container: v.string(), key: v.string() },
  returns: v.union(blobValidator, v.null()),
  handler: async (ctx, args) => {
    const doc = await findBlob(ctx, args.container, args.key);
    return doc ? toBlob(doc) : null;
  },
});

/**
 * Lists the synced blobs in a container, ordered by key.
 *
 * `ctx.db.paginate()` is not available inside components, so this pages
 * manually: the cursor is the last key of the previous page.
 */
export const list = query({
  args: { container: v.string(), paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(blobValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const { numItems, cursor } = args.paginationOpts;
    const limit = Math.max(1, Math.floor(numItems));
    const docs = await ctx.db
      .query("blobs")
      .withIndex("by_container_and_key", (q) => {
        const inContainer = q.eq("container", args.container);
        return cursor === null ? inContainer : inContainer.gt("key", cursor);
      })
      .take(limit + 1);
    const page = docs.slice(0, limit).map(toBlob);
    return {
      page,
      isDone: docs.length <= limit,
      continueCursor: page.at(-1)?.key ?? cursor ?? "",
    };
  },
});

/** Removes a blob's metadata. Returns whether a row existed. */
export const remove = mutation({
  args: { container: v.string(), key: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const existing = await findBlob(ctx, args.container, args.key);
    if (!existing) return false;
    await ctx.db.delete("blobs", existing._id);
    return true;
  },
});
