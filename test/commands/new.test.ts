import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { collectNewAnswers, executeNewRender } from '../../src/commands/new.js';
import { checklistFromTasks, writeChecklist } from '../../src/core/checklist/index.js';
import type { Prompter } from '../../src/core/prompts/types.js';
import { loadFromPath } from '../../src/core/sources/file-source.js';

let work: string;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'hex-cmd-new-'));
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

async function writeFileEnsure(path: string, body: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, body, 'utf8');
}

async function writeManifest(rootPath: string, body: string): Promise<void> {
  const hexDir = join(rootPath, '.hex');
  await mkdir(hexDir, { recursive: true });
  await writeFile(join(hexDir, 'manifest.yaml'), body, 'utf8');
}

/**
 * Build a recipe + 2 children where the recipe and one child carry setup
 * tasks. Mirrors the structure of `test/integration/recipe.test.ts` so the
 * CLI wiring is exercised against the same shape the recipe engine tests
 * cover, just through `collectNewAnswers` + `executeNewRender`.
 */
async function buildRecipeFixture(): Promise<string> {
  const recipeRoot = join(work, 'recipe');
  const apiRoot = join(work, 'children', 'api');
  const webRoot = join(work, 'children', 'web');

  await writeManifest(
    recipeRoot,
    `type: recipe
name: demo-app
version: 0.1.0

prompts:
  - workspace_name:
      type: string
      required: true
      description: Workspace name

composes:
  api: file:../children/api
  web: file:../children/web

setup:
  message: |
    Workspace scaffolded.
  tasks:
    - id: install-deps
      title: Install workspace dependencies
      detail: npm install
`,
  );
  await writeFileEnsure(join(recipeRoot, 'README.md'), '# {{ workspace_name }}\n');

  await writeManifest(
    apiRoot,
    `type: component
name: api
version: 0.1.0

prompts:
  - port:
      type: integer
      default: 3000

setup:
  tasks:
    - id: env-file
      title: Create .env from example
      detail: cp .env.example .env
`,
  );
  await writeFileEnsure(join(apiRoot, 'server.ts'), 'listen({{ port }})');

  await writeManifest(
    webRoot,
    `type: component
name: web
version: 0.1.0

prompts:
  - framework:
      type: string
      default: react
`,
  );
  await writeFileEnsure(join(webRoot, 'config.ts'), 'framework={{ framework }}');

  return recipeRoot;
}

function recipePrompter(answers: {
  workspace_name: string;
  api: { port: number };
  web: { framework: string };
}): Prompter {
  let currentChild: 'api' | 'web' | null = null;
  return {
    note(_body, title) {
      if (title === 'Configuring "api"') currentChild = 'api';
      else if (title === 'Configuring "web"') currentChild = 'web';
    },
    async text(opts) {
      if (opts.message === 'Workspace name') return answers.workspace_name;
      if (currentChild === 'api' && opts.message === 'port') return String(answers.api.port);
      if (currentChild === 'web' && opts.message === 'framework') return answers.web.framework;
      throw new Error(`unexpected text prompt (current=${currentChild}): ${opts.message}`);
    },
    async confirm(opts) {
      throw new Error(`unexpected confirm prompt: ${opts.message}`);
    },
    async select(opts) {
      throw new Error(`unexpected select prompt: ${opts.message}`);
    },
    async multiselect(opts) {
      throw new Error(`unexpected multiselect prompt: ${opts.message}`);
    },
    async password(opts) {
      throw new Error(`unexpected password prompt: ${opts.message}`);
    },
  };
}

describe('hex new — recipe dispatch wiring', () => {
  it('drives a recipe through collect + render and aggregates setup tasks', async () => {
    const recipePath = await buildRecipeFixture();
    const bundle = await loadFromPath(recipePath);
    expect(bundle.manifest.type).toBe('recipe');

    const ctx = await collectNewAnswers(
      bundle,
      recipePrompter({
        workspace_name: 'demo',
        api: { port: 4000 },
        web: { framework: 'svelte' },
      }),
      { sources: [] },
    );

    // The recipe branch resolves children and produces a tree-shaped answers
    // object — recipe-level at root, children nested under their composes key.
    expect(ctx.resolved).toBeDefined();
    expect(ctx.resolved && [...ctx.resolved.children.keys()]).toEqual(['api', 'web']);
    expect(ctx.answers.workspace_name).toBe('demo');
    expect(ctx.answers.api).toEqual({ port: 4000 });
    expect(ctx.answers.web).toEqual({ framework: 'svelte' });

    const out = join(work, 'out');
    const summary = await executeNewRender(bundle, out, ctx, { force: false });

    // Children land in their subdirs; recipe owns the root file. Three writes
    // total: README.md (recipe), api/server.ts, web/config.ts.
    expect(summary.written).toBe(3);
    expect(summary.childCount).toBe(2);
    expect(existsSync(join(out, 'README.md'))).toBe(true);
    expect(existsSync(join(out, 'api', 'server.ts'))).toBe(true);
    expect(existsSync(join(out, 'web', 'config.ts'))).toBe(true);
    expect(await readFile(join(out, 'api', 'server.ts'), 'utf8')).toBe('listen(4000)');

    // Setup tasks aggregated across the tree: recipe-level bare id first,
    // then api's tasks prefixed with the child key. web has no tasks.
    expect(summary.tasks.map((t) => t.id)).toEqual(['install-deps', 'api-env-file']);
    expect(summary.setupMessage).toContain('Workspace scaffolded');

    // The .action() handler writes the checklist after executeNewRender —
    // assert the bytes round-trip through that same helper.
    await writeChecklist(out, checklistFromTasks(summary.tasks));
    const checklist = parseYaml(await readFile(join(out, '.hex', 'checklist.yaml'), 'utf8')) as {
      tasks: Array<{ id: string; status: string }>;
    };
    expect(checklist.tasks.map((t) => t.id)).toEqual(['install-deps', 'api-env-file']);
    expect(checklist.tasks.every((t) => t.status === 'pending')).toBe(true);
  });

  it('returns an empty task list for a recipe + children that declare no setup', async () => {
    const recipeRoot = join(work, 'recipe');
    const apiRoot = join(work, 'children', 'api');
    await writeManifest(
      recipeRoot,
      `type: recipe
name: empty
version: 0.1.0
composes:
  api: file:../children/api
`,
    );
    await writeFileEnsure(join(recipeRoot, 'README.md'), 'no setup');
    await writeManifest(
      apiRoot,
      `type: component
name: api
version: 0.1.0
`,
    );
    await writeFileEnsure(join(apiRoot, 'index.ts'), 'export {}');

    const bundle = await loadFromPath(recipeRoot);
    const ctx = await collectNewAnswers(bundle, recipePrompter({} as never), { sources: [] });
    const out = join(work, 'out');
    const summary = await executeNewRender(bundle, out, ctx, { force: false });

    expect(summary.tasks).toEqual([]);
    expect(summary.setupMessage).toBeUndefined();
    expect(summary.childCount).toBe(1);
    // The .action() would skip writeChecklist when tasks is empty — assert
    // executeNewRender itself does not produce the file.
    expect(existsSync(join(out, '.hex', 'checklist.yaml'))).toBe(false);
  });

  it('still handles a component bundle through the same helpers (no regression)', async () => {
    // Sanity: the existing component path lands flat answers, no childCount,
    // and surfaces the manifest's own setup.tasks unchanged.
    const componentRoot = join(work, 'one-shot');
    await writeManifest(
      componentRoot,
      `type: component
name: one-shot
version: 0.1.0

prompts:
  - project_name:
      type: string
      required: true

setup:
  message: Done.
  tasks:
    - id: install
      title: npm install
`,
    );
    await writeFileEnsure(join(componentRoot, 'package.json'), '{"name": "{{ project_name }}"}\n');

    const bundle = await loadFromPath(componentRoot);
    expect(bundle.manifest.type).toBe('component');

    const prompter: Prompter = {
      async text(opts) {
        if (opts.message === 'project_name') return 'my-app';
        throw new Error(`unexpected text prompt: ${opts.message}`);
      },
      async confirm() {
        throw new Error('confirm not used');
      },
      async select() {
        throw new Error('select not used');
      },
      async multiselect() {
        throw new Error('multiselect not used');
      },
      async password() {
        throw new Error('password not used');
      },
    };
    const ctx = await collectNewAnswers(bundle, prompter, { sources: [] });
    expect(ctx.resolved).toBeUndefined();
    expect(ctx.answers).toEqual({ project_name: 'my-app' });

    const out = join(work, 'out');
    const summary = await executeNewRender(bundle, out, ctx, { force: false });
    expect(summary.childCount).toBe(0);
    expect(summary.written).toBe(1);
    expect(summary.tasks.map((t) => t.id)).toEqual(['install']);
    expect(summary.setupMessage).toBe('Done.');
    const pkg = JSON.parse(await readFile(join(out, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('my-app');
  });
});
