"use client";

import { useAction, useMutation } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useCallback } from "react";

/**
 * The functions `useUploadFile` needs, as exported from your app by
 * `azureBlob.clientApi()`. Pass the module they live in, e.g. `api.files`.
 */
export type UploadApi = {
  generateUploadUrl: FunctionReference<
    "mutation",
    "public",
    Record<string, never>,
    { url: string; key: string }
  >;
  syncMetadata: FunctionReference<"action", "public", { key: string }, null>;
};

/**
 * Uploads a file straight from the browser to Azure Blob Storage: gets a
 * signed URL, `PUT`s the file to it, then syncs the blob's metadata into
 * Convex. Exported for use outside React; in components use `useUploadFile`.
 *
 * @returns The key of the uploaded blob.
 */
export async function uploadFile(
  file: Blob,
  functions: {
    generateUploadUrl: () => Promise<{ url: string; key: string }>;
    syncMetadata: (args: { key: string }) => Promise<null>;
  },
): Promise<string> {
  const { url, key } = await functions.generateUploadUrl();
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "x-ms-blob-type": "BlockBlob",
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });
  if (!response.ok) {
    throw new Error(`Upload to Azure Blob Storage failed: ${response.status}`);
  }
  await functions.syncMetadata({ key });
  return key;
}

/**
 * Returns a function that uploads a file to Azure Blob Storage and resolves
 * to its key.
 *
 * ```tsx
 * const uploadFile = useUploadFile(api.files);
 * const key = await uploadFile(event.target.files[0]);
 * ```
 */
export function useUploadFile(api: UploadApi) {
  const generateUploadUrl = useMutation(api.generateUploadUrl);
  const syncMetadata = useAction(api.syncMetadata);
  return useCallback(
    (file: Blob) =>
      uploadFile(file, {
        generateUploadUrl: () => generateUploadUrl({}),
        syncMetadata,
      }),
    [generateUploadUrl, syncMetadata],
  );
}
