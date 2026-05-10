import { cp, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderRecipe } from '../../src/core/recipe/render.js';
import { resolveRecipe } from '../../src/core/recipe/resolve.js';
import { loadFromPath } from '../../src/core/sources/file-source.js';

// Repo-relative paths to the reference templates exercised here.
const REPO_ROOT = join(__dirname, '..', '..');
const TEMPLATES = join(REPO_ROOT, 'templates');

let work: string;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'hex-swap-int-'));
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

/**
 * Build a sources/ directory containing only the chosen api template plus the
 * fullstack recipe — gives the slot resolver a single, deterministic match.
 */
async function stageSourceRoot(apiName: 'api-express' | 'api-fastify'): Promise<string> {
  const sourcesDir = join(work, `sources-${apiName}`);
  await mkdir(sourcesDir, { recursive: true });
  await cp(join(TEMPLATES, apiName), join(sourcesDir, apiName), { recursive: true });
  await cp(join(TEMPLATES, 'node-ts-fullstack'), join(sourcesDir, 'node-ts-fullstack'), {
    recursive: true,
  });
  return sourcesDir;
}

async function readTree(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        out.set(relative(root, full), await readFile(full, 'utf8'));
      }
    }
  }
  await walk(root);
  return out;
}

async function renderWithApi(apiName: 'api-express' | 'api-fastify'): Promise<{
  out: string;
  files: Map<string, string>;
}> {
  const sourcesDir = await stageSourceRoot(apiName);
  const recipeBundle = await loadFromPath(join(sourcesDir, 'node-ts-fullstack'));
  const resolved = await resolveRecipe(recipeBundle, {
    config: { sources: [{ kind: 'path', path: sourcesDir }] },
  });
  expect(resolved.children.get('api')?.bundle.manifest.name).toBe(apiName);

  const out = join(work, `out-${apiName}`);
  await renderRecipe(resolved, out, { app_name: 'demo', api: { port: 4000 } });
  return { out, files: await readTree(out) };
}

describe('integration — kind-based slot swap (M6.5)', () => {
  it('renders the same recipe with two interchangeable api components', async () => {
    const expressRun = await renderWithApi('api-express');
    const fastifyRun = await renderWithApi('api-fastify');

    // Recipe-root file is identical across the two passes — the swap is
    // contained to the api subtree.
    expect(expressRun.files.get('README.md')).toBe(fastifyRun.files.get('README.md'));
    expect(expressRun.files.get('README.md')).toContain('demo');

    // The api/ subtree differs. Each api-server stub names its own framework.
    expect(expressRun.files.get(join('api', 'server.ts'))).toContain('express');
    expect(fastifyRun.files.get(join('api', 'server.ts'))).toContain('fastify');
    expect(expressRun.files.get(join('api', 'server.ts'))).not.toBe(
      fastifyRun.files.get(join('api', 'server.ts')),
    );

    // Every difference between the two rendered trees is contained to the
    // api subtree — no recipe-root or sibling-subtree drift.
    const allPaths = new Set([...expressRun.files.keys(), ...fastifyRun.files.keys()]);
    const differing = [...allPaths].filter(
      (p) => expressRun.files.get(p) !== fastifyRun.files.get(p),
    );
    expect(differing.length).toBeGreaterThan(0);
    for (const path of differing) {
      expect(path.startsWith(`api${sep}`)).toBe(true);
    }
  });

  it('both api stubs declare matching `provides` symbols (M6.4 contract)', async () => {
    const expressManifest = await loadFromPath(join(TEMPLATES, 'api-express'));
    const fastifyManifest = await loadFromPath(join(TEMPLATES, 'api-fastify'));

    const expressProvides = expressManifest.manifest.provides;
    const fastifyProvides = fastifyManifest.manifest.provides;
    expect(expressProvides).toBeDefined();
    expect(fastifyProvides).toBeDefined();

    // Both ship the symbol→expression form — the symbol set must match so
    // either can satisfy a sibling that consumes them.
    const symbols = (p: typeof expressProvides) => (Array.isArray(p) ? p : Object.keys(p ?? {}));
    expect(symbols(expressProvides).sort()).toEqual(symbols(fastifyProvides).sort());
    expect(symbols(expressProvides).sort()).toEqual(['API_FRAMEWORK', 'HTTP_PORT']);
  });
});
