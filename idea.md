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

## Open threads

### Stubbing integration

a. **Where does the stub live** — separate component (`db-postgres-stub` alongside `db-postgres`), flag/mode on the real component, or both supported.
b. **Wiring style** — runtime toggle (env var flips real ↔ stub) vs. scaffold-time choice. Likely a mix: runtime for stub-mode of the same component, scaffold-time for swapping to a different stub component.
c. **Stub-engine adapter contract** — minimal interface for talking to Wiremock / pg-mem / Mockoon / etc. uniformly: install, configure, expose start / stop, wire into npm scripts; fixture (seed data) location.

## Incremental build plan

Every slice leaves a usable tool. Upgrade (5) sits before contracts (6) on purpose — it's the hardest, most load-bearing piece, so we de-risk it with a single component before building multi-component abstractions on top. Marketplace infra is deliberately late.

**Slice 1 — Single local component, prompts, render.**
Component on disk with manifest + `template/`. Prompts, renders to an output path using Nunjucks (sandboxed). **Already useful**: Cookiecutter-equivalent minus catalogue.

**Slice 2 — Recipe component composing multiple local children.**
A composing component (recipe) references N local children. Hex resolves, prompts recipe-level then per-child, places each child in its own subdirectory, and emits root-level orchestration from the recipe's own `template/`. Children are self-contained subtrees — no file-merge by construction. **Real applications now buildable.**

**Slice 3 — Git as a source.**
Components fetched from git URL + tag, cached locally. No registry infra yet. **Teams can share components.**

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
