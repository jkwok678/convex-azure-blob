# Developing guide

## Running locally

```sh
pnpm install
pnpm run dev
```

## Testing

```sh
pnpm install --frozen-lockfile
pnpm run build:clean
pnpm run typecheck
pnpm run lint
pnpm run fallow
pnpm run test
pnpm run test:integration
```

`pnpm run test:integration` starts a local
[Azurite](https://github.com/Azure/Azurite) emulator and runs the client against
it, to check that Azure accepts the URLs the component signs.

`pnpm run fallow` runs [fallow](https://fallow.tools), which checks for unused
code and dependencies, import cycles, duplicated code and overly complex
functions. Its settings are in [.fallowrc.json](./.fallowrc.json).
