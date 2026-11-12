import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Which user owns which blob. The component tracks the blobs themselves;
  // the app decides who they belong to.
  images: defineTable({
    key: v.string(),
    owner: v.string(),
  })
    .index("by_owner", ["owner"])
    .index("by_key", ["key"]),
});
