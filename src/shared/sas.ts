/**
 * Azure Blob Storage service SAS signing, using only Web Crypto so it runs in
 * the default Convex runtime (queries, mutations and actions) and in browsers.
 *
 * Reference:
 * https://learn.microsoft.com/rest/api/storageservices/create-service-sas
 */

/**
 * The storage service version the SAS is signed for. The string-to-sign layout
 * depends on this version, so it is pinned rather than configurable.
 */
export const SAS_VERSION = "2022-11-02";

/**
 * The permissions this library signs, in the order Azure requires them to
 * appear in the `sp` field.
 *
 * - `r`: read the blob's content and properties.
 * - `c`: write a new blob, but not overwrite an existing one.
 * - `w`: create or overwrite the blob.
 * - `d`: delete the blob.
 */
const PERMISSION_ORDER = "rcwd";

export type BlobSasPermission = "r" | "c" | "w" | "d";

export type BlobLocation = {
  /** The storage account name. */
  accountName: string;
  /** The container the blob lives in. */
  containerName: string;
  /** The blob's name within the container. May contain `/`. */
  blobName: string;
  /**
   * The blob service endpoint. Defaults to
   * `https://<accountName>.blob.core.windows.net`. Set this for Azurite
   * (`http://127.0.0.1:10000/devstoreaccount1`) or sovereign clouds.
   */
  endpoint?: string;
};

export type BlobSasOptions = BlobLocation & {
  /** The base64-encoded storage account key. */
  accountKey: string;
  /** One or more of `r`, `c`, `w`, `d`, in any order. */
  permissions: string;
  /** When the SAS stops being valid, as a Date or milliseconds since epoch. */
  expiresOn: Date | number;
  /** When the SAS becomes valid. Omit for "immediately". */
  startsOn?: Date | number;
};

/** The unsigned URL of a blob. */
export function blobUrl(location: BlobLocation): string {
  const endpoint = (
    location.endpoint ?? `https://${location.accountName}.blob.core.windows.net`
  ).replace(/\/+$/, "");
  const path = [location.containerName, ...location.blobName.split("/")]
    .map(encodeURIComponent)
    .join("/");
  return `${endpoint}/${path}`;
}

/** Generates the SAS query string (without a leading `?`) for one blob. */
export async function generateBlobSasToken(
  options: BlobSasOptions,
): Promise<string> {
  const { accountName, accountKey, containerName, blobName } = options;
  if (!accountName) throw new Error("accountName is required");
  if (!accountKey) throw new Error("accountKey is required");
  if (!containerName) throw new Error("containerName is required");
  if (!blobName) throw new Error("blobName is required");

  const permissions = normalizePermissions(options.permissions);
  const start =
    options.startsOn === undefined ? "" : formatTime(options.startsOn);
  const expiry = formatTime(options.expiresOn);
  // Plain HTTP is only allowed when the endpoint itself is plain HTTP, which
  // in practice means a local emulator.
  const protocol = options.endpoint?.startsWith("http://")
    ? "https,http"
    : "https";
  const resource = "b";

  const stringToSign = [
    permissions,
    start,
    expiry,
    // The canonicalized resource uses the decoded blob name.
    `/blob/${accountName}/${containerName}/${blobName}`,
    "", // signedIdentifier
    "", // signedIP
    protocol,
    SAS_VERSION,
    resource,
    "", // signedSnapshotTime
    "", // signedEncryptionScope
    "", // rscc
    "", // rscd
    "", // rsce
    "", // rscl
    "", // rsct
  ].join("\n");

  const params = new URLSearchParams();
  params.set("sv", SAS_VERSION);
  params.set("sr", resource);
  params.set("sp", permissions);
  if (start) params.set("st", start);
  params.set("se", expiry);
  params.set("spr", protocol);
  params.set("sig", await hmacSha256Base64(accountKey, stringToSign));
  return params.toString();
}

/** Generates a full signed URL for one blob. */
export async function generateBlobSasUrl(
  options: BlobSasOptions,
): Promise<string> {
  return `${blobUrl(options)}?${await generateBlobSasToken(options)}`;
}

function normalizePermissions(permissions: string): string {
  if (permissions.length === 0) {
    throw new Error("At least one permission is required");
  }
  for (const permission of permissions) {
    if (!PERMISSION_ORDER.includes(permission)) {
      throw new Error(`Unsupported SAS permission: ${permission}`);
    }
  }
  return [...PERMISSION_ORDER].filter((p) => permissions.includes(p)).join("");
}

/** Formats a time as ISO 8601 UTC to the second, e.g. 2026-01-02T03:04:05Z. */
function formatTime(time: Date | number): string {
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid SAS time");
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function hmacSha256Base64(
  base64Key: string,
  message: string,
): Promise<string> {
  let keyBytes: Uint8Array<ArrayBuffer>;
  try {
    keyBytes = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
  } catch {
    throw new Error("accountKey must be base64-encoded");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}
