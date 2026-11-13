# Convex Azure Blob

[![npm version](https://badge.fury.io/js/convex-azure-blob.svg)](https://badge.fury.io/js/convex-azure-blob)

<!-- START: Include on https://convex.dev/components -->

Store and serve files with
[Azure Blob Storage](https://azure.microsoft.com/products/storage/blobs) from
your [Convex](https://convex.dev) app.

- Upload from the browser straight to Azure through short-lived signed URLs, so
  files never pass through your backend.
- Serve files with signed, read-only URLs generated inside your queries.
- Keep blob metadata (size, content type, ETag) in Convex, where it is reactive
  and queryable.
- Store files from actions, and delete them.
- No Azure SDK: it runs in the default Convex runtime.

```tsx
// React
const uploadFile = useUploadFile(api.files);
const key = await uploadFile(file);
```

```ts
// Convex
const url = await azureBlob.getUrl(key);
```

Found a bug? Feature request?
[File it here](https://github.com/jkwok678/convex-azure-blob/issues).

## Prerequisites

### Azure storage account

1. Create a
   [storage account](https://learn.microsoft.com/azure/storage/common/storage-account-create)
   and a container in it. Leave the container's public access level as
   **Private**: this component always signs its URLs.
2. Copy the account name and one of its
   [access keys](https://learn.microsoft.com/azure/storage/common/storage-account-keys-manage).
3. Add a CORS rule for the Blob service so browsers can upload. In the Azure
   portal this is under **Settings → Resource sharing (CORS) → Blob service**:

   | Field           | Value                                        |
   | --------------- | -------------------------------------------- |
   | Allowed origins | Your app's origin, e.g. `https://my-app.com` |
   | Allowed methods | `PUT`                                        |
   | Allowed headers | `x-ms-blob-type,content-type`                |
   | Exposed headers | (empty)                                      |
   | Max age         | `3600`                                       |

   Or with the Azure CLI:

   ```sh
   az storage cors add --services b --methods PUT \
     --origins https://my-app.com \
     --allowed-headers "x-ms-blob-type,content-type" \
     --max-age 3600 --account-name <account>
   ```

   Add one origin per environment (for example `http://localhost:5173` for local
   development).

> **The account key grants full access to the storage account.** Use a storage
> account dedicated to this app, and keep the key only in Convex environment
> variables.

### Convex environment variables

```sh
npx convex env set AZURE_STORAGE_ACCOUNT <account name>
npx convex env set AZURE_STORAGE_ACCOUNT_KEY <account key>
npx convex env set AZURE_STORAGE_CONTAINER <container name>
```

## Installation

```sh
npm install convex-azure-blob
```

Create a `convex.config.ts` file in your app's `convex/` folder and install the
component by calling `use`:

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import azureBlob from "convex-azure-blob/convex.config.js";

const app = defineApp();
app.use(azureBlob);

export default app;
```

## Uploading files from the browser

Create the client and export the functions the upload hook needs. The component
cannot see who your users are, so every check is required; throw to deny a
request.

```ts
// convex/files.ts
import { AzureBlob } from "convex-azure-blob";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";

export const azureBlob = new AzureBlob(components.azureBlob);

export const { generateUploadUrl, syncMetadata, getMetadata, deleteObject } =
  azureBlob.clientApi<DataModel>({
    checkUpload: async (ctx) => {
      if (!(await ctx.auth.getUserIdentity())) throw new Error("Unauthorized");
    },
    checkRead: async (ctx, key) => {
      // Throw unless this user may read `key`.
    },
    checkDelete: async (ctx, key) => {
      // Throw unless this user may delete `key`.
    },
    onUpload: async (ctx, blob) => {
      // Runs in an action, once per uploaded key.
      if (blob.size > 5 * 1024 * 1024) {
        await azureBlob.deleteObject(ctx, blob.key);
        throw new Error("File too large");
      }
      await ctx.runMutation(internal.files.saveFile, { key: blob.key });
    },
  });
```

Then upload from React:

```tsx
import { useUploadFile } from "convex-azure-blob/react";
import { api } from "../convex/_generated/api";

function Uploader() {
  const uploadFile = useUploadFile(api.files);
  return (
    <input
      type="file"
      onChange={async (event) => {
        const key = await uploadFile(event.target.files![0]);
      }}
    />
  );
}
```

`useUploadFile` asks for a signed URL, `PUT`s the file to Azure, then calls
`syncMetadata`, which records the blob's metadata and runs your `onUpload`.

### Validating uploads

An upload URL can only say _where_ a file goes. It cannot limit the file's size
or type, so check `blob.size` and `blob.contentType` in `onUpload`. To reject an
upload, delete it and throw, as above. Bear in mind the content type is whatever
the uploader claimed.

### Choosing your own keys

Keys default to a random UUID. To choose one, write your own mutation:

```ts
export const generateAvatarUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserId(ctx);
    return await azureBlob.generateUploadUrl(`avatars/${userId}/${Date.now()}`);
  },
});
```

An upload URL can create its blob but not overwrite it, so each URL is good for
one upload and a key cannot be reused until its blob is deleted.

## Serving files

`getUrl` signs a read-only URL locally, with no network request, so you can call
it in a query:

```ts
export const listFiles = query({
  args: {},
  handler: async (ctx) => {
    const files = await ctx.db.query("files").take(50);
    return await Promise.all(
      files.map(async (file) => ({
        ...file,
        url: await azureBlob.getUrl(file.key),
      })),
    );
  },
});
```

URLs last one hour by default; pass `{ expiresIn: seconds }` to change that.

The expiry is rounded up to a multiple of `expiresIn`, so the same URL is
returned until the window rolls over. That keeps URLs stable when a query
re-runs, which lets browsers cache the file. It also means a URL is valid for
between one and two times `expiresIn`, and that a page left open for longer
holds an expired URL until its query next re-runs.

## Storing files from an action

```ts
export const saveReport = action({
  args: {},
  handler: async (ctx) => {
    const response = await fetch("https://example.com/report.pdf");
    const key = await azureBlob.store(ctx, await response.blob());
    // Or choose the key and type:
    // await azureBlob.store(ctx, data, { key: "reports/1.pdf", type: "application/pdf" });
  },
});
```

`store` holds the whole file in memory, so it is limited by Convex's
[action memory limit](https://docs.convex.dev/production/state/limits). Unlike
an upload URL, it overwrites an existing blob with the same key.

## Deleting files

```ts
await azureBlob.deleteObject(ctx, key);
```

This deletes the blob from Azure and its metadata from Convex, and succeeds if
the blob is already gone. It makes a network request, so it must be called from
an action.

## Metadata

```ts
const blob = await azureBlob.getMetadata(ctx, key);
// { key, container, size, contentType, etag, lastModified } | null

const { page, isDone, continueCursor } = await azureBlob.listMetadata(
  ctx,
  paginationOpts,
);
```

Metadata lives in a Convex table, so these are ordinary reactive reads that
never call Azure. `listMetadata` returns blobs in key order.

Metadata is recorded when `syncMetadata` runs. Blobs written to the container by
other tools are not tracked until you call `azureBlob.syncMetadata(ctx, key)`
for them from an action.

## Configuration

```ts
const azureBlob = new AzureBlob(components.azureBlob, {
  // Each defaults to the environment variable shown.
  accountName: "...", // AZURE_STORAGE_ACCOUNT
  accountKey: "...", // AZURE_STORAGE_ACCOUNT_KEY
  containerName: "...", // AZURE_STORAGE_CONTAINER
  endpoint: "...", // AZURE_STORAGE_ENDPOINT
  uploadUrlExpiresIn: 15 * 60, // seconds
  readUrlExpiresIn: 60 * 60, // seconds
});
```

To use more than one container, create one `AzureBlob` per container.

`endpoint` defaults to `https://<account>.blob.core.windows.net`. Set it for
sovereign clouds, or for the [Azurite](https://github.com/Azure/Azurite)
emulator:

```sh
npx convex env set AZURE_STORAGE_ENDPOINT http://127.0.0.1:10000/devstoreaccount1
```

## Limitations

- **Single-request uploads.** Files are uploaded in one `PUT`, with no progress
  reporting, retry or resume. This suits files up to a few hundred megabytes.
- **Orphaned blobs.** If the browser closes after uploading but before
  `syncMetadata` runs, the blob stays in Azure with no metadata. Nothing cleans
  these up yet; an
  [Azure lifecycle rule](https://learn.microsoft.com/azure/storage/blobs/lifecycle-management-overview)
  can.
- **Account key only.** Microsoft Entra ID and managed identities are not
  supported yet.
- **Deletes and syncs need an action**, because they call Azure.

<!-- END: Include on https://convex.dev/components -->

## Development

```sh
pnpm install
pnpm run dev
```

`pnpm run dev` starts a file watcher that rebuilds the component, along with the
[example app](./example)'s backend, which installs and uses the component. Run
`pnpm run dev:frontend` to open the example in a Vite app. The example needs the
environment variables above; see [example/README.md](./example/README.md) to run
it against Azurite.

```sh
pnpm test                  # unit tests
pnpm run test:integration  # tests against a local Azurite emulator
```
