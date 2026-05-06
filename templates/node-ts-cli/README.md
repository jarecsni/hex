# {{ project_name }}

{{ description }}

## Install

```sh
npm install
```

## Develop

```sh
npm run dev hello   # tsx-driven, no build needed
```

## Build & run

```sh
npm run build
npm start hello
```

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Run the CLI from source via tsx |
| `npm run build` | Bundle to `dist/` with tsup |
| `npm start` | Run the bundled CLI |
| `npm test` | Run vitest |
| `npm run typecheck` | TypeScript type-check |
| `npm run lint` | Biome lint |
| `npm run format` | Biome format-write |

{% if include_publish_workflow %}## Releasing

`.github/workflows/publish.yml` publishes to npm on tag push:

```sh
npm version 0.1.0    # bumps package.json + creates a git tag
git push --follow-tags
```

The workflow needs the `NPM_TOKEN` repo secret set (`gh secret set NPM_TOKEN`).

{% endif %}## License

{{ license }}{% if author %} © {{ author }}{% endif %}
