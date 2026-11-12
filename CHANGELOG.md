# Changelog

## 0.1.0

- Initial release.
- Browser uploads straight to Azure Blob Storage through short-lived,
  create-only signed URLs, with a `useUploadFile` React hook.
- Signed read-only URLs that can be generated inside queries.
- Blob metadata synced into a Convex table, with `getMetadata` and
  `listMetadata`.
- `store` and `deleteObject` for use in actions.
- `clientApi()` to expose upload, metadata and delete functions behind your own
  auth checks.
