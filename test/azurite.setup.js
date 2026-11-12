// Vitest global setup: starts an in-memory Azurite blob emulator on a free
// port, creates a container, and tells the tests where to find it.
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

// The well-known Azurite development account. Not a secret.
const ACCOUNT = "devstoreaccount1";
const KEY =
  "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==";
const CONTAINER = "integration";
const API_VERSION = "2022-11-02";

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Creates the container with Shared Key authorization. A blob SAS cannot
 * create containers, and the component never needs to, so this lives here
 * rather than in the library.
 */
async function createContainer(endpoint) {
  const date = new Date().toUTCString();
  const stringToSign = [
    "PUT",
    ...Array(11).fill(""),
    `x-ms-date:${date}`,
    `x-ms-version:${API_VERSION}`,
    // Azurite's path-style URLs repeat the account name.
    `/${ACCOUNT}/${ACCOUNT}/${CONTAINER}`,
    "restype:container",
  ].join("\n");
  const signature = createHmac("sha256", Buffer.from(KEY, "base64"))
    .update(stringToSign, "utf8")
    .digest("base64");
  return await fetch(`${endpoint}/${CONTAINER}?restype=container`, {
    method: "PUT",
    headers: {
      "x-ms-date": date,
      "x-ms-version": API_VERSION,
      Authorization: `SharedKey ${ACCOUNT}:${signature}`,
    },
  });
}

export default async function setup(project) {
  const port = await freePort();
  const endpoint = `http://127.0.0.1:${port}/${ACCOUNT}`;
  const bin = fileURLToPath(
    new URL("../node_modules/.bin/azurite-blob", import.meta.url),
  );
  const azurite = spawn(
    bin,
    ["--inMemoryPersistence", "--silent", "--blobPort", String(port)],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  const stop = () => azurite.kill();

  // Wait for Azurite to accept requests, then create the container.
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const response = await createContainer(endpoint);
      if (response.status === 201 || response.status === 409) break;
      stop();
      throw new Error(
        `Azurite refused to create the container: ${response.status} ` +
          (await response.text()),
      );
    } catch (error) {
      if (error?.cause?.code !== "ECONNREFUSED" || Date.now() > deadline) {
        stop();
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  project.provide("azurite", {
    accountName: ACCOUNT,
    accountKey: KEY,
    containerName: CONTAINER,
    endpoint,
  });
  return stop;
}
