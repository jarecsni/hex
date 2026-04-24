# Hex — idea

Status: **early** — working capture of the concept, not a spec. Expect this doc to churn.

## One-liner

A scaffolding tool that assembles applications from pluggable **components** under a **recipe**, and can **upgrade** those applications as components release new versions.

## Vocabulary

- **Component** — an application subsystem (API, DB, auth, UI shell, …), published as a package and fetched by Hex from its repo or, preferably, from the marketplace. Versioned.
- **Template** — the project-scaffolding files a component contributes. Lives under `template/` inside the component repo.
- **Recipe** — a manifest describing an application type as a combination of components.
- **Marketplace / catalogue** — an npmjs-style registry where devs register and version components. Own package format TBD.
- **Application** — the generated project, retaining enough metadata (what components at what versions, what recipe, what answers) to be upgraded later.

## Component repo layout (draft)

```
my-component/
  template/          # scaffolding files
  hooks/             # customisation hooks (pre/post generate, pre/post upgrade, ...)
  migrations/        # version-to-version migration scripts (upgrade story)
  deploy/            # pluggable deployment hook
  <manifest>         # component meta: version, prompts, kind/slot, deps, ...
```

## Principles

- **Not fire-and-forget**: apps remember how they were built so newer component versions can be re-applied.
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

## Open threads

### 3. Template authoring format

Text templating (Handlebars/EJS/Liquid) vs. copy-with-substitution (cookiecutter-style `{{ foo }}`)? Binary files? How do multiple components' `template/` folders **compose** into a single output tree — who owns which file, how are conflicts resolved?

### 4. Recipe authoring

Hand-written YAML / JSON, or generated via interactive wizard? Does a recipe itself live in the marketplace (so a dev can publish a recipe), or is it user-local?

### 5. Stubbing integration

Is a stub a separate component published alongside the real one, or a flag on the real one? How does a component declare which stub engine drives it, and how does Hex wire that up during generation?

### 6. Prompt layers

Confirmed: prompts live on components. Open: are there also recipe-level prompts (app name, org, shared config every component would otherwise re-ask)?

## Incremental build plan

Every slice leaves a usable tool. Upgrade (5) sits before contracts (6) on purpose — it's the hardest, most load-bearing piece, so we de-risk it with a single component before building multi-component abstractions on top. Marketplace infra is deliberately late.

**Slice 1 — Single local component, prompts, render.**
Component on disk with manifest + `template/`. Prompts, renders to an output path. Pick an off-the-shelf templating engine (Handlebars / Nunjucks / EJS). **Already useful**: Cookiecutter-equivalent minus catalogue.

**Slice 2 — Recipe composing multiple local components.**
Recipe file references N local components. Hex resolves, prompts each, composes template outputs into one tree (deliberate conflict policy for same-path files). **Real applications now buildable.**

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
