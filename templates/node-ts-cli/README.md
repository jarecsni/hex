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

## License

{{ license }}{% if author %} © {{ author }}{% endif %}
