/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    blobs: {
      get: FunctionReference<
        "query",
        "internal",
        { container: string; key: string },
        {
          container: string;
          contentType?: string;
          etag: string;
          key: string;
          lastModified: number;
          size: number;
        } | null,
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        {
          container: string;
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            container: string;
            contentType?: string;
            etag: string;
            key: string;
            lastModified: number;
            size: number;
          }>;
        },
        Name
      >;
      remove: FunctionReference<
        "mutation",
        "internal",
        { container: string; key: string },
        boolean,
        Name
      >;
      upsert: FunctionReference<
        "mutation",
        "internal",
        {
          container: string;
          contentType?: string;
          etag: string;
          key: string;
          lastModified: number;
          size: number;
        },
        null,
        Name
      >;
    };
  };
