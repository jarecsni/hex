# Hex — idea

Status: **early** — working capture of the concept, not a spec. Expect this doc to churn.

## One-liner

A scaffolding tool that assembles applications from pluggable **components** under a **recipe**, and can **upgrade** those applications as components release new versions.

## Vocabulary

- **Component** — the only artifact type in Hex. A self-contained, templated subproject (API, DB, auth, UI shell, …) with a manifest, a `template/` folder, hooks, and migrations. Published and versioned. Fetched by Hex from a repo or the marketplace.
- **Template** — the scaffolding files inside a component, under `template/`. Substitutes user answers into file contents *and* file / directory names.
- **Recipe** — the **role** a component plays when its manifest declares `composes:` (a list of other components). A recipe owns the root-level orchestration files (`docker-compose.yml`, root `package.json` for workspaces, root README, …); its composed children own their own subtrees. Recipes are **not a separate artifact type** — they live in the marketplace alongside leaf components and use the same publish / version / upgrade flow.
- **Marketplace / catalogue** — an npmjs-style registry where devs register and version components (leaf or composing). Own package format TBD.
- **Application** — the generated project: the recipe component's root-orchestration tree plus its children's subtrees, retaining enough metadata to be upgraded.

## Component repo layout (draft)

The shape is the same for leaf components and recipes (composing components):

```
my-component/
  template/          # scaffolding files
  hooks/             # customisation hooks (pre/post generate, pre/post upgrade, ...)
  migrations/        # version-to-version migration scripts (upgrade story)
  deploy/            # pluggable deployment hook
  <manifest>         # version, prompts, kind, provides/consumes, composes (if recipe), ...
```

## Principles

- **Not fire-and-forget**: apps remember how they were built so newer component versions can be re-applied.
- **Components are self-contained subprojects** — each owns its own subtree of the generated app and never writes outside it. Cross-component "central wiring" lives in the **recipe** (a composing component) which owns the root-level orchestration files.
- **One artifact type, uniform marketplace** — leaf and composing components share the same repo layout, manifest shape, publish flow, versioning, and upgrade engine. "Recipe" is a role, not a type.
- **Pluggable components** — recipes can swap one component for another of the same kind, or **stub** it.
- **Stubbing reuses existing stub engines**; Hex defines integration points, doesn't build engines.
- **Pluggable deployment from day one** — contract in place even though we won't ship many plugins at start.

## Leaning decisions

### 1. Upgrade mechanism — steal from Copier + Nx

Don't reinvent. The design that best fits Hex:

- **Copier-style answers file + re-render + 3-way merge** for the textual side.
- **Nx / Angular-Schematics-style per-version migration scripts** for structural changes the template can't express.

**Stepwise chain.** An app on v1 upgrading to v4 does not require a v1→v4 migration. Hex walks the chain: 1→2, 2→3, 3→4, in order. Each bump ships only its single-hop migration.

**Pristine-tree model.** Migrations and renders operate on a reproducible pristine tree, not the user's working copy. User edits are merged in once at the end:

```
pristine_old  = render(v1, stored-answers)                ← rebuilt from lockfile
pristine_new  = render(v2) → migrate(1→2)
              → render(v3) → migrate(2→3)
              → render(v4) → migrate(3→4)                 ← single result
patch         = diff(pristine_old, pristine_new)
user_tree_new = apply(patch, user_tree) with 3-way merge at collisions
```

Why: migrations stay deterministic (they only see pristine input); user-tree merge happens once at the end, minimising conflict surface; the lockfile is the single enabler (stores `{recipe, components+versions, answers, hashes}`, enough to reconstruct `pristine_old`).

**Conflict UX.** Git-style `<<<<<<< ======= >>>>>>>` markers in place, so every editor / `git diff` understands them. Hex stops with "N conflicts — resolve and run `hex upgrade --continue`." Same mental model as `git rebase`.

**Modify/delete and friends — handled by migration intent + safe default.**

Migration scripts get a small declarative vocabulary on top of arbitrary code:

- `delete(path)` — unconditional.
- `delete_if_unmodified(path)` — keep user-edited copy, otherwise remove.
- `rename(from, to)` — carry user edits to new path (rename by declaration, not heuristic).
- `replace(from, to)` — rename plus content change; 3-way-merge the user's edits into the new file.

Default when a file disappears and the user has edited it: **preserve and orphan**. Hex keeps the file, marks it orphaned in the lockfile, and surfaces a warning at the end: *"N orphaned files have your edits — kept in place, review and clean up if desired."* Opt-in interactive prompting for the brave.

**User-tree migrations (escape hatch).** Occasionally a migration genuinely needs to touch user code (e.g. codemod an import rename across the whole project). Allowed, but flagged `user_tree: true` in the manifest so the user sees what's coming: *"this migration will edit your code, review the diff."*

### 2. Component contracts — real interface, not just a label

Each component manifest declares:

- **`provides`** — what it contributes to the recipe: env vars, generated symbols, service URLs, file-layout promises, …
- **`consumes`** — what it needs from sibling components in the recipe.

At recipe resolve time Hex validates: every `consumes` slot has at least one `provides` satisfying it. Swap-ability falls out: any component with `kind: api` and matching `provides` fits the slot. A stub satisfies the same contract as the real component — that's what makes stubbing interchangeable without recipe edits.

Feeds Thread 1: migration scripts can target the declared contract rather than touching component internals, so unrelated components upgrading independently don't collide.

### 3. Composition — recipes are composing components

Components are self-contained: each owns one subtree and never writes outside it. There are no shared files (no `package.json` mutated by three components). Cross-component glue lives in a **recipe** — a composing component whose manifest declares `composes:` listing its children.

Same artifact type for both:

```yaml
# leaf
name: api-express
version: 1.2.0
kind: api
provides: [HTTP_PORT, api_routes_dir]
prompts:
  - port: { default: 3000 }
```

```yaml
# recipe (composing component)
name: fullstack-monorepo
version: 1.0.0
composes:
  api: api-express@^1.0
  db: db-postgres@^2.0
  ui: ui-react@^3.0
prompts:
  - app_name: { required: true }
  - containerize: { default: true }
```

The recipe owns the root-level orchestration files via its own `template/` (`docker-compose.yml`, root `package.json` for workspaces, root README, …). Each child fills its own subdirectory. Default subdirectory names come from the recipe's `composes:` keys; the user can override at prompt time.

Recipes can compose other recipes — recursion is free.

Versioning interacts naturally with Section 1: a recipe at v1.2 pins specific child versions; bumping the recipe to v1.3 may bump children, which kicks off transitive upgrades through the same engine. Conceptually like `npm update` of a top-level package.

### 4. Templating engine — Nunjucks (Jinja2 for JS)

One engine, applied to both file contents and file / directory names. Nunjucks gives:

- Variable substitution: `{{ project_name }}`.
- Conditionals: `{% if hasAuth %}` — needed because manifest-level "include this file or not" can't carry every case (you'll often want to switch a code block on/off inside an otherwise-unconditional file).
- Loops: `{% for entity in entities %}` — needed for codegen.
- Filters: `pluralize`, `camelCase`, `snake_case` — huge for codegen.
- Template inheritance + macros — lets a component share boilerplate across its own files.
- **Sandbox mode** — no arbitrary code execution from marketplace components.

Bonus alignment: Cookiecutter and Copier both use Jinja2. Component authors familiar with either are at home immediately, and their templates are studyable as references.

Conditional **file** inclusion (e.g. emit `Dockerfile` only if `containerize: true`) lives at the **manifest level**, not via `{% if %}` wrapping a whole file — cleaner, and easier to reason about during upgrade.

### 5. Prompts — recipe-level + component-level

Both layers are real. UX flow:

1. Recipe-level prompts first (project name, license, target environment, `containerize`, …).
2. Then component sections in turn ("Configuring `api-express`…").
3. Components can read recipe-level answers (so a child can branch on `containerize`).
4. Components can see which siblings are present in the recipe (so an `api` component can branch on whether `auth` is in play, for example).

Refinement TBD: exact shape of the templating context — namespacing of recipe vs. component answers and of sibling-presence facts. Treat as a refinement, not a blocker.

### 6. Stubbing — components ship their own stub support

Stubs are a **dev + CI** concern. The contract work in Section 2 makes them mostly fall out for free.

**Components ship their stub support.** A stubbable component declares a `stub:` section in its manifest:

```yaml
name: db-postgres
version: 1.2.0
kind: db
provides: [DB_URL, schema_migrator]
prompts:
  - port: { default: 5432 }
  - seed_data: { default: minimal, when: stub }
stub:
  engine: pg-mem
  fixtures: fixtures/
```

`stub:` is optional — components without it are real-only. Marketplace can badge "stubbable: yes/no" to nudge authors.

**Single source of truth, single version.** Real and stub ship together, in lockstep, by the same author. No marketplace drift. Same manifest, same publish flow, same upgrade engine. A separate `*-stub` component remains a fallback for cases the real-component author didn't cover (e.g. someone else's paid SaaS) — escape hatch, not the primary pattern.

**Recipes enable stub mode per slot:**

```yaml
composes:
  api: api-express@^1.0
  db:
    component: db-postgres@^2.0
    stub: true                 # this slot runs in stub mode
  auth:
    component: auth-jwt@^1.0   # real
```

`stub: true` flows into the templating context as a well-known answer. Manifest-level conditional file inclusion gates stub-only / real-only files. Inside files, Nunjucks branches on `stub_enabled` for code-block-level differences.

**No stubs in the production build — by convention, not by recipe knob.** Stubbable components structure their template so prod builds exclude stub code:

- **Separate entry points** — `src/index.ts` (prod, real only) vs `src/index.dev.ts` (dev, imports stubs). `package.json` scripts: `dev` uses the dev entry, `build` / `start` use the prod entry. Bundlers tree-shake; the prod artifact never references stub code.
- **devDependencies for stub engines** — `pg-mem`, `msw`, etc. live in `devDependencies` only. Prod `npm install --omit=dev` pulls none of it.
- **Docker compose profiles** — stub services tagged `profiles: [dev]`. `docker-compose up` runs the prod-shape topology; `docker-compose --profile dev up` adds the stubs.

Marketplace lint/badge can verify these conventions ("stubs prod-clean: ✓").

**Engine reuse — split by engine kind:**

- **In-process libraries** (pg-mem, MSW, ioredis-mock, mongodb-memory-server) — npm packages each component declares as devDeps. Dedup is the package manager's job (workspaces / pnpm hoisting); Hex doesn't intervene.
- **Out-of-process services** (Wiremock, Mockoon, testcontainers-style) — Hex detects overlap at recipe instantiation: if multiple components declare `engine: wiremock`, the recipe's root `docker-compose.yml` gets one Wiremock service the components share, each with its own mappings/fixtures.

**Fixtures** scaffold into the user's tree (`<component>/fixtures/`) so they can be edited and version-controlled.

**Pristine + upgrade still works.** `stub: true` is just another stored answer in the lockfile; pristine reconstruction reproduces the right tree. Stub-mode flips don't break the upgrade engine.

**Swap (Section 2) is still available, separately.** If you want a *completely different* component (`db-postgres` → `db-sqlite`), that's contract-based swap — different mechanism, still works. Stubbing is "same component, dev mode"; swapping is "different component, same contract".

### 7. Hooks & sandbox — declarative first, sandboxed JS as escape hatch

Components ship customisation logic via two tiers, in order of preference:

**Tier 1 — declarative rules in the manifest.** Most hooks are simple: rename if X, delete if Y, set a default if Z. Express these as YAML rules under the manifest's `hooks:` section. No code, no sandbox concerns, easy to reason about during upgrade.

**Tier 2 — JavaScript files in `hooks/`.** For real conditional logic, authors write plain JS:

```js
// hooks/post_render.js
export default async function({ answers, project, log }) {
  if (answers.framework === 'react') await project.delete('src/index.vue');
  log.info('Cleaned up Vue files');
}
```

**Runtime: QuickJS compiled to WASM** (Shopify's Functions architecture — Javy-style). Hooks execute inside the embedded engine, *not* in the host Node process. Capabilities are exposed as injected host functions and are deliberately narrow:

- `project.read(path)` / `write(path, content)` / `delete(path)` / `exists(path)` / `list(dir)` — scoped to the generated tree, cannot escape it.
- `answers` — the recipe + component prompt answers.
- `recipe` — recipe metadata (composed children, versions).
- `log` — info/warn/error.
- **No** `process.spawn`, **no** network, **no** filesystem outside the project tree, **no** env-var access, **no** `npm` packages inside hooks.

**Lifecycle.** Per-component: `pre_render`, `post_render`, `pre_upgrade`, `post_upgrade`. Recipes get the same lifecycle at the orchestration level, fired around child execution.

**Trust gradient.** Local-path components (dev workflow) can be allowed to run hooks unsandboxed via an explicit `--trust-local` flag — convenient while developing your own components. Anything fetched from git or the marketplace is sandboxed unconditionally. The sandbox is the default, the bypass is loud.

**Tradeoff.** QuickJS is a JS subset — no Node APIs, no npm packages inside hooks. Acceptable price: npm-in-hook would be a supply-chain footgun across thousands of marketplace components anyway. Authors who need a real package for a hook should depend on it from the *generated app's* `package.json` and have the hook write code that uses it at runtime — not pull it in at scaffold time.

### 8. Host CLI runtime — Node + TypeScript

Hex itself is built in **Node + TypeScript**.

- **Distribution**: `npm install -g @hex/cli` and `npx @hex/cli init …`. Target audience (web/full-stack devs) already has Node. No new runtime to install.
- **Ecosystem fit**: Nunjucks (Section 4) is native JS. Mature libraries for everything Hex needs — git ops (`isomorphic-git` or shelling to `git`), prompts (`@clack/prompts`, `inquirer`), YAML (`yaml`), 3-way merge (`diff3`), filesystem walks, semver.
- **Hook sandbox embeds cleanly**: QuickJS-WASM (Section 7) runs in-process in Node via `@bjorn3/quickjs-emscripten` or wasmtime-node — no separate runtime process to manage.
- **Prior art alignment**: Yeoman, Backstage Software Templates, Cruft-via-Python aside, the JS-scaffolder lineage is well-trodden.

**Tradeoff acknowledged.** Single-binary distribution (Go, Rust) would be cleaner for users who don't want Node — particularly for non-JS target stacks (a Python team using Hex to scaffold a Django+React app shouldn't need Node just to run Hex). If that becomes a real complaint, ship a standalone binary later via `bun build --compile` or `pkg` — same TS source, additional distribution channel. Don't pre-optimise.

**Why not Go / Rust / Swift now**: Go forces re-picking the templating engine away from Nunjucks (or embedding a JS runtime, which negates the simplicity). Rust same plus slower iteration. Swift loses cross-platform — Linux/Windows are second-class.

## Open threads

_(All major threads landed — see Section 5 for the templating-context refinement and Section 6 for marketplace-lint conventions; both are detail-work, not blockers.)_

## Incremental build plan

Every slice leaves a usable tool. Upgrade (5) sits before contracts (6) on purpose — it's the hardest, most load-bearing piece, so we de-risk it with a single component before building multi-component abstractions on top. Marketplace infra is deliberately late.

**Slice 1 — Single local component, prompts, render.**
Node + TS CLI (Section 8). Component on disk with manifest + `template/`. Prompts (`@clack/prompts`-style), renders to an output path using Nunjucks (sandboxed). Hooks: declarative-only at this slice; JS-on-WASM (Section 7) lands when marketplace fetches do (Slice 3). **Already useful**: Cookiecutter-equivalent minus catalogue.

**Slice 2 — Recipe component composing multiple local children.**
A composing component (recipe) references N local children. Hex resolves, prompts recipe-level then per-child, places each child in its own subdirectory, and emits root-level orchestration from the recipe's own `template/`. Children are self-contained subtrees — no file-merge by construction. **Real applications now buildable.**

**Slice 3 — Git as a source + JS hook sandbox.**
Components fetched from git URL + tag, cached locally. No registry infra yet. JS hooks (Section 7) now run in QuickJS-WASM since fetched code is no longer trusted; local-path components keep the unsandboxed path behind `--trust-local`. **Teams can share components.**

**Slice 4 — Lockfile.**
`hex-lock.yml` records recipe + components + versions + answers + hashes. Generated app becomes self-describing. Sets the table for Slice 5.

**Slice 5 — Upgrade engine (the differentiator).**
Pristine reconstruction, stepwise chain, 3-way merge, `hex upgrade --continue`, migration script vocabulary (`rename` / `delete_if_unmodified` / `replace` / …). **Hex stops being "another scaffolder".**

**Slice 6 — Contracts (`provides` / `consumes`) + swap.**
Typed slots in recipes; kind-based resolution. Swap `api-express` for `api-fastify` with one recipe edit. **Pluggability becomes real.**

**Slice 7 — Stub integration.**
Stub is a component satisfying the same contract as the real thing. Integrations with the first 1–2 external stub engines. **Stubbing pitch lands.**

**Slice 8 — Marketplace / registry + package format.**
Publish, discover, version. Website + index.

**Slice 9 — Pluggable deployment (one reference plugin).**
Contract in place, one concrete adapter.

Tradeoff flagged: **Slice 4 has no visible user value by itself** — it's scaffolding for Slice 5. Could fold into Slice 5; keeping them separate buys a smaller Slice 5 and an inspectable artifact along the way.

## Prior art

Tools Hex is learning from — read these when in doubt about a mechanism.

- **[Copier](https://copier.readthedocs.io/)** (Python) — upgrade-first scaffolder. `.copier-answers.yml` + re-render + 3-way merge + per-version migration tasks. **Closest single reference** for Thread 1.
- **[Cruft](https://cruft.github.io/cruft/)** — wraps Cookiecutter to give it an upgrade story; conceptually similar to Copier but bolted on. Useful as a contrast.
- **[Cookiecutter](https://cookiecutter.readthedocs.io/)** — the OG prompt-driven project scaffolder. No native upgrade. Reference for prompt UX.
- **[Nx generators + `nx migrate`](https://nx.dev/features/automate-updating-dependencies)** — per-version migration scripts shipped alongside the package; runs them in order on upgrade. Reference for Thread 1's structural-migration layer.
- **[Angular Schematics + `ng update`](https://angular.dev/tools/cli/schematics)** — same pattern as Nx (they're siblings). Good example of codemod-style user-tree migrations.
- **[Yeoman](https://yeoman.io/)** — prior generation of JS scaffolders. Composability ideas; no upgrade story.
- **[Backstage Software Templates](https://backstage.io/docs/features/software-templates/)** — catalogue-driven scaffolding inside a dev portal. Reference for the marketplace side (entity kinds, scaffolder actions).
- **Django / Rails migrations** — stepwise, ordered, each assumes the previous ran. Canonical reference for the chained-migration mental model.

## Deliberately not doing

- Building our own stub engines.
- Shipping many deployment plugins at launch — pluggability only.
