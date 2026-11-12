import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/** What the component records about one blob in Azure. */
export const blobFields = {
  /** The blob's name within its container. */
  key: v.string(),
  /** The container the blob lives in. */
  container: v.string(),
  /** Size in bytes. */
  size: v.number(),
  /** The blob's Content-Type, if Azure reported one. */
  contentType: v.optional(v.string()),
  /** The blob's ETag, which changes whenever its content does. */
  etag: v.string(),
  /** When Azure last modified the blob, in milliseconds since the epoch. */
  lastModified: v.number(),
};

export default defineSchema({
  blobs: defineTable(blobFields).index("by_container_and_key", [
    "container",
    "key",
  ]),
});
