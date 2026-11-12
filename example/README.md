# Example app

An image gallery: upload images straight to Azure Blob Storage, list your own
images, and delete them. See [convex/example.ts](./convex/example.ts).

Run the example and convex commands from the root of the repo:

```sh
pnpm install
pnpm run dev            # Convex backend
pnpm run dev:frontend   # Vite app, in another terminal
```

## Running against Azurite

You can try the example without an Azure account by using the
[Azurite](https://github.com/Azure/Azurite) emulator, which is installed as a
dev dependency.

1. Start Azurite:

   ```sh
   pnpm exec azurite-blob --inMemoryPersistence
   ```

2. Create a container called `images` and add a CORS rule, using the
   [Azure CLI](https://learn.microsoft.com/cli/azure/) with Azurite's well-known
   development connection string:

   ```sh
   export AZURE_STORAGE_CONNECTION_STRING="DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;"
   az storage container create --name images
   az storage cors add --services b --methods PUT \
     --origins http://localhost:5173 \
     --allowed-headers "x-ms-blob-type,content-type" --max-age 3600
   ```

3. Point the Convex deployment at it:

   ```sh
   pnpm exec convex env set AZURE_STORAGE_ACCOUNT devstoreaccount1
   pnpm exec convex env set AZURE_STORAGE_ACCOUNT_KEY "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw=="
   pnpm exec convex env set AZURE_STORAGE_CONTAINER images
   pnpm exec convex env set AZURE_STORAGE_ENDPOINT http://127.0.0.1:10000/devstoreaccount1
   ```

This only works with a local Convex deployment, since a cloud deployment cannot
reach an emulator on your machine.

The example has no auth provider, so every visitor shares one identity. A real
app should require sign-in in its checks.
