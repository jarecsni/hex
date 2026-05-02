# @hexology/hex

Scaffolding tool that assembles applications from templated components — honeycomb-style. Part of the [Hexology](https://github.com/textologylabs/hex) toolset.

Status: **0.1.0 — CLI scaffold only, not yet published.** No render, no recipes yet. See [`idea.md`](./idea.md) for the design and [`CHANGELOG.md`](./CHANGELOG.md) for what's in.

Once published you'll install with `npm install -g @hexology/hex` and run `hex`.

## Try it

```sh
npm install
npm run build
node dist/cli.js doctor
```

Or in dev:

```sh
npm run dev -- doctor
```

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Run the CLI from source via `tsx`. |
| `npm run build` | Bundle to `dist/` via `tsup`. |
| `npm run start` | Run the built binary. |
| `npm test` | Vitest run. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | Biome check. |
| `npm run format` | Biome format (write). |
| `npm run check` | Typecheck + lint + test. |

## Layout

```
src/
  cli.ts              entry (shebang, commander wiring)
  brand/
    glyphs.ts         hex cell glyphs + ASCII fallback
    colors.ts         honey palette (picocolors)
    splash.ts         banner
  util/
    tty.ts            terminal capability detection
  commands/
    doctor.ts         hex doctor
test/
  brand/glyphs.test.ts
```

## Roadmap

See `idea.md` § *Incremental build plan*. Next: Slice 1 — single local component, prompts, render.
