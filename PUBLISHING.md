# Publishing

This package is published to npm with [pnpm](https://pnpm.io). You need an npmjs
account with permission to publish `convex-azure-blob`; run `pnpm login` once to
sign in.

## Before every release

Add an entry for the new version to [CHANGELOG.md](./CHANGELOG.md) and commit
it. The release scripts require a clean working tree.

## Alpha release

```sh
pnpm run alpha
```

This runs every check, bumps the version to the next prerelease (for example
`0.1.1-alpha.0`), commits and tags it, publishes under the `alpha` tag, and
pushes the commit and tag. Users install it with
`npm install convex-azure-blob@alpha`.

To publish an alpha of a specific version, set it explicitly instead:

```sh
pnpm run release:check
pnpm version 0.2.0-alpha.0
pnpm publish --tag alpha
git push --follow-tags
```

## Release

```sh
pnpm run release
```

This runs every check, bumps the patch version, commits and tags it, publishes
to npm, and pushes the commit and tag. For a minor or major release:

```sh
pnpm run release:check
pnpm version minor # or major
pnpm publish
git push --follow-tags
```

## Trying a build before publishing

```sh
pnpm run build:clean
pnpm pack
```

`pnpm pack` creates a `.tgz` file you can install in another project with
`npm install ./path/to/convex-azure-blob-<version>.tgz`. Delete it afterwards.

## What the checks cover

`pnpm run release:check` installs from the lockfile, rebuilds from scratch, and
runs the unit tests, the Azurite integration tests, lint and typecheck.
