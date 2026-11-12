# Developing guide

## Running locally

```sh
npm i
npm run dev
```

## Testing

```sh
npm ci
npm run clean
npm run typecheck
npm run lint
npm run test
npm run test:integration
```

`npm run test:integration` starts a local
[Azurite](https://github.com/Azure/Azurite) emulator and runs the client against
it, to check that Azure accepts the URLs the component signs.
