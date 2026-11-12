import { actionGeneric, mutationGeneric, queryGeneric } from "convex/server";
import type {
  GenericActionCtx,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
  PaginationOptions,
  PaginationResult,
} from "convex/server";
import { v } from "convex/values";
import type { Infer } from "convex/values";
import type { ComponentApi } from "../component/_generated/component.js";
import { blobFields } from "../component/schema.js";
import { generateBlobSasUrl } from "../shared/sas.js";
import type { BlobSasPermission } from "../shared/sas.js";

export type { ComponentApi };

const blobMetadataValidator = v.object(blobFields);

/** What the component knows about one blob. */
export type BlobMetadata = Infer<typeof blobMetadataValidator>;

export type AzureBlobOptions = {
  /** Storage account name. Defaults to `AZURE_STORAGE_ACCOUNT`. */
  accountName?: string;
  /** Base64 storage account key. Defaults to `AZURE_STORAGE_ACCOUNT_KEY`. */
  accountKey?: string;
  /** Container name. Defaults to `AZURE_STORAGE_CONTAINER`. */
  containerName?: string;
  /**
   * Blob service endpoint. Defaults to `AZURE_STORAGE_ENDPOINT`, then to
   * `https://<accountName>.blob.core.windows.net`. Set this for Azurite or
   * sovereign clouds.
   */
  endpoint?: string;
  /** How long upload URLs stay valid, in seconds. Defaults to 15 minutes. */
  uploadUrlExpiresIn?: number;
  /** How long read URLs stay valid, in seconds. Defaults to 1 hour. */
  readUrlExpiresIn?: number;
};

const DEFAULT_UPLOAD_URL_EXPIRES_IN = 15 * 60;
const DEFAULT_READ_URL_EXPIRES_IN = 60 * 60;
/** Lifetime of the URLs this library signs for its own requests, in seconds. */
const INTERNAL_URL_EXPIRES_IN = 5 * 60;

type Config = {
  accountName: string;
  accountKey: string;
  containerName: string;
  endpoint?: string;
};

export class AzureBlob {
  constructor(
    public component: ComponentApi,
    public options: AzureBlobOptions = {},
  ) {}

  /**
   * Resolved lazily so that a missing environment variable fails the call
   * that needs it, not module load (which would break `convex dev`).
   */
  private config(): Config {
    const accountName =
      this.options.accountName ?? process.env.AZURE_STORAGE_ACCOUNT;
    const accountKey =
      this.options.accountKey ?? process.env.AZURE_STORAGE_ACCOUNT_KEY;
    const containerName =
      this.options.containerName ?? process.env.AZURE_STORAGE_CONTAINER;
    const endpoint =
      this.options.endpoint ?? process.env.AZURE_STORAGE_ENDPOINT;
    const missing = [
      !accountName && "AZURE_STORAGE_ACCOUNT",
      !accountKey && "AZURE_STORAGE_ACCOUNT_KEY",
      !containerName && "AZURE_STORAGE_CONTAINER",
    ].filter((name) => name !== false);
    if (!accountName || !accountKey || !containerName) {
      throw new Error(
        `Azure Blob Storage is not configured. Set ${missing.join(", ")} ` +
          "with `npx convex env set`, or pass the values to `new AzureBlob()`.",
      );
    }
    return { accountName, accountKey, containerName, endpoint };
  }

  /** The container this client reads from and writes to. */
  get containerName(): string {
    return this.config().containerName;
  }

  private async signedUrl(
    key: string,
    permissions: BlobSasPermission,
    expiresOn: number,
  ): Promise<string> {
    return await generateBlobSasUrl({
      ...this.config(),
      blobName: key,
      permissions,
      expiresOn,
    });
  }

  /**
   * Generates a short-lived URL the browser can `PUT` a file to, with the
   * header `x-ms-blob-type: BlockBlob`.
   *
   * The URL can create the blob but not overwrite it, so each URL is good for
   * one upload. It cannot limit the size or type of what is uploaded: check
   * those in `onUpload` once the metadata is synced.
   *
   * @param key The blob name. Defaults to a random UUID.
   */
  async generateUploadUrl(key?: string): Promise<{ url: string; key: string }> {
    const blobKey = key ?? crypto.randomUUID();
    const expiresIn =
      this.options.uploadUrlExpiresIn ?? DEFAULT_UPLOAD_URL_EXPIRES_IN;
    const url = await this.signedUrl(
      blobKey,
      "c",
      Date.now() + expiresIn * 1000,
    );
    return { url, key: blobKey };
  }

  /**
   * Generates a read-only URL for a blob. Signed locally, so it is safe to
   * call in a query.
   *
   * The expiry is rounded up to a multiple of `expiresIn`, so repeated calls
   * return the same URL until the window rolls over. That keeps URLs stable
   * across query re-runs so browsers can cache the file. A URL is therefore
   * valid for between `expiresIn` and twice `expiresIn`.
   */
  async getUrl(key: string, options?: { expiresIn?: number }): Promise<string> {
    const expiresIn =
      options?.expiresIn ??
      this.options.readUrlExpiresIn ??
      DEFAULT_READ_URL_EXPIRES_IN;
    if (!(expiresIn > 0)) throw new Error("expiresIn must be positive");
    const windowMs = expiresIn * 1000;
    const expiresOn = (Math.floor(Date.now() / windowMs) + 2) * windowMs;
    return await this.signedUrl(key, "r", expiresOn);
  }

  /**
   * Reads a blob's properties from Azure and records them in the component.
   * Must be called from an action. Throws if the blob does not exist.
   */
  async syncMetadata(ctx: RunActionCtx, key: string): Promise<BlobMetadata> {
    const container = this.containerName;
    const url = await this.signedUrl(key, "r", internalExpiry());
    const response = await fetch(url, { method: "HEAD" });
    if (response.status === 404) {
      await ctx.runMutation(this.component.blobs.remove, { container, key });
      throw new Error(`Blob not found in Azure: ${key}`);
    }
    if (!response.ok) throw azureError("read properties of", key, response);
    const lastModified = Date.parse(
      response.headers.get("last-modified") ?? "",
    );
    const contentType = response.headers.get("content-type");
    const metadata: BlobMetadata = {
      key,
      container,
      size: Number(response.headers.get("content-length") ?? 0),
      etag: response.headers.get("etag") ?? "",
      lastModified: Number.isNaN(lastModified) ? Date.now() : lastModified,
      ...(contentType ? { contentType } : {}),
    };
    await ctx.runMutation(this.component.blobs.upsert, metadata);
    return metadata;
  }

  /** Returns a blob's synced metadata, or null if it has not been synced. */
  async getMetadata(
    ctx: RunQueryCtx,
    key: string,
  ): Promise<BlobMetadata | null> {
    return await ctx.runQuery(this.component.blobs.get, {
      container: this.containerName,
      key,
    });
  }

  /** Lists the synced blobs in the container, ordered by key. */
  async listMetadata(
    ctx: RunQueryCtx,
    paginationOpts: PaginationOptions,
  ): Promise<PaginationResult<BlobMetadata>> {
    return await ctx.runQuery(this.component.blobs.list, {
      container: this.containerName,
      paginationOpts,
    });
  }

  /**
   * Uploads data to Azure from an action and records its metadata. Overwrites
   * any existing blob with the same key. The whole payload is held in memory.
   *
   * @returns The blob's key.
   */
  async store(
    ctx: RunActionCtx,
    data: Blob | ArrayBuffer | Uint8Array<ArrayBuffer> | string,
    options?: { key?: string; type?: string },
  ): Promise<string> {
    const key = options?.key ?? crypto.randomUUID();
    const type =
      options?.type ||
      (data instanceof Blob && data.type) ||
      "application/octet-stream";
    const url = await this.signedUrl(key, "w", internalExpiry());
    const response = await fetch(url, {
      method: "PUT",
      headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": type },
      body: data,
    });
    if (!response.ok) throw azureError("store", key, response);
    await this.syncMetadata(ctx, key);
    return key;
  }

  /**
   * Deletes a blob from Azure and removes its metadata. Must be called from
   * an action. Succeeds if the blob is already gone.
   */
  async deleteObject(ctx: RunActionCtx, key: string): Promise<void> {
    const url = await this.signedUrl(key, "d", internalExpiry());
    const response = await fetch(url, { method: "DELETE" });
    if (!response.ok && response.status !== 404) {
      throw azureError("delete", key, response);
    }
    await ctx.runMutation(this.component.blobs.remove, {
      container: this.containerName,
      key,
    });
  }

  /**
   * Generates the functions the browser calls, for re-export from your app:
   *
   * ```ts
   * export const { generateUploadUrl, syncMetadata, getMetadata, deleteObject } =
   *   azureBlob.clientApi<DataModel>({
   *     checkUpload: async (ctx) => { ... },
   *     checkRead: async (ctx, key) => { ... },
   *     checkDelete: async (ctx, key) => { ... },
   *     onUpload: async (ctx, blob) => { ... },
   *   });
   * ```
   *
   * The component cannot see who the user is, so every check is required.
   * Each should throw to deny the request.
   */
  clientApi<DataModel extends GenericDataModel = GenericDataModel>(opts: {
    /**
     * Runs before an upload URL is issued and before an upload is synced.
     */
    checkUpload: (ctx: CheckCtx<DataModel>) => void | Promise<void>;
    /** Runs before a blob's metadata is returned. */
    checkRead: (ctx: CheckCtx<DataModel>, key: string) => void | Promise<void>;
    /** Runs before a blob is deleted. */
    checkDelete: (
      ctx: CheckCtx<DataModel>,
      key: string,
    ) => void | Promise<void>;
    /**
     * Runs in an action once an upload's metadata is synced, exactly once per
     * key. Use it to link the key to your own tables, via `ctx.runMutation`.
     *
     * An upload URL cannot restrict size or type, so validate `blob.size` and
     * `blob.contentType` here. If this throws, the sync is undone; to reject
     * an upload, call `deleteObject(ctx, blob.key)` and then throw.
     */
    onUpload?: (
      ctx: GenericActionCtx<DataModel>,
      blob: BlobMetadata,
    ) => void | Promise<void>;
  }) {
    return {
      generateUploadUrl: mutationGeneric({
        args: {},
        returns: v.object({ url: v.string(), key: v.string() }),
        handler: async (ctx: GenericMutationCtx<DataModel>) => {
          await opts.checkUpload(ctx);
          return await this.generateUploadUrl();
        },
      }),
      syncMetadata: actionGeneric({
        args: { key: v.string() },
        returns: v.null(),
        handler: async (ctx: GenericActionCtx<DataModel>, args) => {
          await opts.checkUpload(ctx);
          // A key is synced once. Without this, a caller who learned someone
          // else's key could re-run `onUpload` and have the app link that
          // blob to them.
          if (await this.getMetadata(ctx, args.key)) {
            throw new Error(`Blob already synced: ${args.key}`);
          }
          const blob = await this.syncMetadata(ctx, args.key);
          try {
            await opts.onUpload?.(ctx, blob);
          } catch (error) {
            // Undo the sync so a failed upload can be retried.
            await ctx.runMutation(this.component.blobs.remove, {
              container: blob.container,
              key: blob.key,
            });
            throw error;
          }
          return null;
        },
      }),
      getMetadata: queryGeneric({
        args: { key: v.string() },
        returns: v.union(blobMetadataValidator, v.null()),
        handler: async (ctx: GenericQueryCtx<DataModel>, args) => {
          await opts.checkRead(ctx, args.key);
          return await this.getMetadata(ctx, args.key);
        },
      }),
      deleteObject: actionGeneric({
        args: { key: v.string() },
        returns: v.null(),
        handler: async (ctx: GenericActionCtx<DataModel>, args) => {
          await opts.checkDelete(ctx, args.key);
          await this.deleteObject(ctx, args.key);
          return null;
        },
      }),
    };
  }
}

function internalExpiry(): number {
  return Date.now() + INTERNAL_URL_EXPIRES_IN * 1000;
}

/** Builds an error that never includes the signed URL. */
function azureError(verb: string, key: string, response: Response): Error {
  const code = response.headers.get("x-ms-error-code");
  return new Error(
    `Azure Blob Storage failed to ${verb} "${key}": ${response.status}` +
      (code ? ` ${code}` : ""),
  );
}

// Convenient types for `ctx` args, that only include the bare minimum.

/**
 * The context passed to checks: the part of `ctx` that queries, mutations and
 * actions all share.
 */
export type CheckCtx<DataModel extends GenericDataModel = GenericDataModel> =
  Pick<GenericActionCtx<DataModel>, "auth" | "runQuery">;

type RunQueryCtx = Pick<GenericActionCtx<GenericDataModel>, "runQuery">;
type RunActionCtx = Pick<
  GenericActionCtx<GenericDataModel>,
  "runQuery" | "runMutation" | "runAction"
>;
