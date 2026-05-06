# @hexology/hex

Scaffolding tool that assembles applications from templated components — honeycomb-style. Part of the [Hexology](https://github.com/textologylabs/hex) toolset.

Status: **Phase 1 complete — single-template render pipeline + source discovery (local + git).** Milestones M1–M3 are in. See [`idea.md`](./idea.md) for the roadmap and [`CHANGELOG.md`](./CHANGELOG.md) for what's released.

Install once published: `npm install -g @hexology/hex` and run `hex`.

## Configuring source roots

Hex discovers templates by walking configured *source roots*. Add them
to `~/.hex/config.yaml` (override the directory with `HEX_CONFIG_DIR`):

```yaml
sources:
  - path: ~/dev/my-templates                          # local directory
  - git: https://github.com/acme/templates            # git remote, default branch
    ref: main
  - git: git@github.com:acme/internal-templates.git   # ssh, default branch
```

Each `path` is walked one level deep for templates (directories with a
`.hex/manifest.{yaml,yml}`). Each `git` URL is cloned lazily into
`~/.hex/cache/git/...` (override with `HEX_CACHE_DIR`) on first use,
then walked the same way.

`hex list` enumerates discovered templates. `hex sources` reports cache
+ drift status per source (no network on cache hit). `hex sources
refresh` force-refreshes every git source.

Drift detection runs at most once per 6h per (url, ref) using
`git ls-remote`; when upstream is ahead of the cache, `hex list` prints a
warning and tells you to `hex sources refresh`. Network failures are
silent — Hex never blocks offline use.

> **Note on SHA refs.** `ref:` accepts branches, tags, and commit SHAs.
> SHA fetches work uniformly against the local protocol, GitHub, and
> GitLab. Self-hosted servers may need `uploadpack.allowAnySHA1InWant=true`
> for arbitrary commits not reachable from a default branch — branches
> and tags don't need this.

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

## Roadmap

See `idea.md` § *Incremental build plan*. Phase 1 (configurable scaffolder) is shipped through M3; next is Phase 2 — deploy + CI/CD adapters.
