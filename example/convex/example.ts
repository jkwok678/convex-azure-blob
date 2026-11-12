import { ConvexError, v } from "convex/values";
import { AzureBlob } from "convex-azure-blob";
import type { CheckCtx } from "convex-azure-blob";
import { components, internal } from "./_generated/api.js";
import type { DataModel } from "./_generated/dataModel.js";
import {
  action,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server.js";
import type { QueryCtx } from "./_generated/server.js";
import type { Auth } from "convex/server";

// Reads AZURE_STORAGE_ACCOUNT, AZURE_STORAGE_ACCOUNT_KEY and
// AZURE_STORAGE_CONTAINER from the deployment's environment variables.
const azureBlob = new AzureBlob(components.azureBlob);

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * This example has no auth provider configured, so every visitor shares one
 * "anonymous" identity. In a real app, throw here when there is no identity.
 */
async function getUserId(ctx: { auth: Auth }): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.tokenIdentifier ?? "anonymous";
}

async function requireOwner(
  ctx: CheckCtx<DataModel>,
  key: string,
): Promise<void> {
  const owner: string | null = await ctx.runQuery(internal.example.ownerOf, {
    key,
  });
  if (owner === null || owner !== (await getUserId(ctx))) {
    throw new Error("Not your image");
  }
}

// The functions the `useUploadFile` hook calls from the browser.
export const { generateUploadUrl, syncMetadata, getMetadata } =
  azureBlob.clientApi<DataModel>({
    checkUpload: async (ctx) => {
      // Anyone may upload in this demo. A real app would require sign-in.
      await getUserId(ctx);
    },
    checkRead: requireOwner,
    checkDelete: requireOwner,
    onUpload: async (ctx, blob) => {
      // An upload URL cannot limit what is uploaded, so validate here.
      const isImage = blob.contentType?.startsWith("image/") ?? false;
      if (!isImage || blob.size > MAX_IMAGE_BYTES) {
        await azureBlob.deleteObject(ctx, blob.key);
        // A ConvexError's message reaches the browser in production.
        throw new ConvexError("Only images up to 5 MB are allowed");
      }
      await ctx.runMutation(internal.example.saveImage, {
        key: blob.key,
        owner: await getUserId(ctx),
      });
    },
  });

/** The current user's images, newest first, with signed URLs to show them. */
export const listImages = query({
  args: {},
  returns: v.array(
    v.object({
      key: v.string(),
      url: v.string(),
      size: v.union(v.number(), v.null()),
      contentType: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const owner = await getUserId(ctx);
    const images = await ctx.db
      .query("images")
      .withIndex("by_owner", (q) => q.eq("owner", owner))
      .order("desc")
      .take(50);
    return await Promise.all(
      images.map(async ({ key }) => {
        const metadata = await azureBlob.getMetadata(ctx, key);
        return {
          key,
          url: await azureBlob.getUrl(key),
          size: metadata?.size ?? null,
          contentType: metadata?.contentType ?? null,
        };
      }),
    );
  },
});

/** Deletes one of the current user's images from Azure and from the app. */
export const deleteImage = action({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.key);
    await azureBlob.deleteObject(ctx, args.key);
    await ctx.runMutation(internal.example.removeImage, { key: args.key });
    return null;
  },
});

async function findImage(ctx: QueryCtx, key: string) {
  return await ctx.db
    .query("images")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
}

export const ownerOf = internalQuery({
  args: { key: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const image = await findImage(ctx, args.key);
    return image?.owner ?? null;
  },
});

export const saveImage = internalMutation({
  args: { key: v.string(), owner: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("images", args);
    return null;
  },
});

export const removeImage = internalMutation({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const image = await findImage(ctx, args.key);
    if (image) await ctx.db.delete("images", image._id);
    return null;
  },
});
