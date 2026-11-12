import { describe, expect, test } from "vitest";
import {
  blobUrl,
  generateBlobSasToken,
  generateBlobSasUrl,
  SAS_VERSION,
} from "./sas.js";

// The well-known Azurite development account. Not a secret.
const accountName = "devstoreaccount1";
const accountKey =
  "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==";
const expiresOn = new Date("2030-01-02T03:04:05Z");
const base = { accountName, accountKey, containerName: "c1", expiresOn };

describe("generateBlobSasToken", () => {
  // Expected signatures were produced by @azure/storage-blob's
  // generateBlobSASQueryParameters with the same inputs and version.
  test.each([
    {
      permissions: "r",
      blobName: "photo.png",
      startsOn: undefined,
      sig: "J7zzvHrpSJeLCj1DxWjV6gewRTEjR6EsTOsVSRvrpL4=",
    },
    {
      permissions: "c",
      blobName: "users/1/a b+c.png",
      startsOn: new Date("2026-01-01T00:00:00Z"),
      sig: "GbRHlRvkKCH/K4sfJz148MFJYmXzDOLkHit0zdiWXoY=",
    },
    {
      permissions: "d",
      blobName: "ünï/côde.txt",
      startsOn: undefined,
      sig: "pKMT98W4q0eUoUwxP808WyuP0B9uVA/cura4N7SvaAg=",
    },
    {
      permissions: "rcwd",
      blobName: "x",
      startsOn: undefined,
      sig: "FLPKM0+1KhBPTQj/q+kDujBb8Z718PZ2FCZSIVDS8bI=",
    },
  ])(
    "matches the Azure SDK for $permissions on $blobName",
    async ({ permissions, blobName, startsOn, sig }) => {
      const token = await generateBlobSasToken({
        ...base,
        blobName,
        permissions,
        startsOn,
      });
      expect(new URLSearchParams(token).get("sig")).toBe(sig);
    },
  );

  test("sets the expected query parameters", async () => {
    const params = new URLSearchParams(
      await generateBlobSasToken({
        ...base,
        blobName: "photo.png",
        permissions: "r",
        startsOn: Date.parse("2026-01-01T00:00:00.789Z"),
      }),
    );
    expect(Object.fromEntries(params)).toEqual({
      sv: SAS_VERSION,
      sr: "b",
      sp: "r",
      st: "2026-01-01T00:00:00Z",
      se: "2030-01-02T03:04:05Z",
      spr: "https",
      sig: expect.any(String),
    });
  });

  test("omits the start time unless given", async () => {
    const params = new URLSearchParams(
      await generateBlobSasToken({
        ...base,
        blobName: "x",
        permissions: "r",
      }),
    );
    expect(params.has("st")).toBe(false);
  });

  test("orders permissions as Azure requires", async () => {
    const ordered = await generateBlobSasToken({
      ...base,
      blobName: "x",
      permissions: "rcwd",
    });
    const shuffled = await generateBlobSasToken({
      ...base,
      blobName: "x",
      permissions: "dwcr",
    });
    expect(shuffled).toBe(ordered);
    expect(new URLSearchParams(shuffled).get("sp")).toBe("rcwd");
  });

  test("allows plain HTTP only for a plain HTTP endpoint", async () => {
    const params = new URLSearchParams(
      await generateBlobSasToken({
        ...base,
        blobName: "x",
        permissions: "r",
        endpoint: "http://127.0.0.1:10000/devstoreaccount1",
      }),
    );
    expect(params.get("spr")).toBe("https,http");
  });

  test("is deterministic", async () => {
    const options = { ...base, blobName: "x", permissions: "r" };
    expect(await generateBlobSasToken(options)).toBe(
      await generateBlobSasToken(options),
    );
  });

  test("rejects invalid input", async () => {
    const options = { ...base, blobName: "x", permissions: "r" };
    await expect(
      generateBlobSasToken({ ...options, permissions: "" }),
    ).rejects.toThrow("At least one permission");
    await expect(
      generateBlobSasToken({ ...options, permissions: "rl" }),
    ).rejects.toThrow("Unsupported SAS permission: l");
    await expect(
      generateBlobSasToken({ ...options, blobName: "" }),
    ).rejects.toThrow("blobName is required");
    await expect(
      generateBlobSasToken({ ...options, accountKey: "not base64!" }),
    ).rejects.toThrow("accountKey must be base64-encoded");
    await expect(
      generateBlobSasToken({ ...options, expiresOn: NaN }),
    ).rejects.toThrow("Invalid SAS time");
  });
});

describe("blobUrl", () => {
  test("uses the public Azure endpoint by default", () => {
    expect(
      blobUrl({ accountName: "acct", containerName: "c1", blobName: "a.png" }),
    ).toBe("https://acct.blob.core.windows.net/c1/a.png");
  });

  test("encodes each path segment but keeps slashes", () => {
    expect(
      blobUrl({
        accountName: "acct",
        containerName: "c1",
        blobName: "users/1/a b+c?.png",
      }),
    ).toBe("https://acct.blob.core.windows.net/c1/users/1/a%20b%2Bc%3F.png");
  });

  test("honours a custom endpoint and trims trailing slashes", () => {
    expect(
      blobUrl({
        accountName,
        containerName: "c1",
        blobName: "a.png",
        endpoint: "http://127.0.0.1:10000/devstoreaccount1/",
      }),
    ).toBe("http://127.0.0.1:10000/devstoreaccount1/c1/a.png");
  });
});

describe("generateBlobSasUrl", () => {
  test("joins the blob URL and the token", async () => {
    const options = { ...base, blobName: "dir/a b.png", permissions: "r" };
    expect(await generateBlobSasUrl(options)).toBe(
      `https://devstoreaccount1.blob.core.windows.net/c1/dir/a%20b.png?${await generateBlobSasToken(options)}`,
    );
  });
});
