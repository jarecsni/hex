import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { browseCategory, formatCategories, listCategories } from '../../src/commands/browse.js';
import type { MarketplaceConfig } from '../../src/core/marketplace/address.js';

let work: string;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'hex-browse-test-'));
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

type CataloguePkg = {
  name: string;
  type: 'component' | 'recipe';
  latest: string;
  categories?: string[];
};
type Policy = { block?: string[] };

async function buildRegistry(
  dirName: string,
  packages: CataloguePkg[],
  policy?: Policy,
): Promise<string> {
  const registryDir = join(work, dirName);
  await mkdir(registryDir, { recursive: true });
  await writeFile(
    join(registryDir, 'catalogue.json'),
    JSON.stringify({ packages, policy }, null, 2),
    'utf8',
  );
  return pathToFileURL(registryDir).href;
}

describe('listCategories', () => {
  it('tallies distinct categories across marketplaces, alphabetical', async () => {
    const hex = await buildRegistry('hex', [
      { name: 'api-express', type: 'component', latest: '1.0.0', categories: ['backend'] },
      {
        name: 'db-postgres',
        type: 'component',
        latest: '1.0.0',
        categories: ['backend', 'database'],
      },
    ]);
    const acme = await buildRegistry('acme', [
      { name: 'acme-ui', type: 'component', latest: '1.0.0', categories: ['frontend'] },
      { name: 'acme-api', type: 'component', latest: '1.0.0', categories: ['backend'] },
    ]);
    const marketplaces: MarketplaceConfig[] = [
      { id: 'hex', registry: hex },
      { id: 'acme', registry: acme },
    ];

    const { categories, warnings } = await listCategories(marketplaces);
    expect(warnings).toEqual([]);
    expect(categories).toEqual([
      { name: 'backend', count: 3 },
      { name: 'database', count: 1 },
      { name: 'frontend', count: 1 },
    ]);
  });

  it('excludes blocked entries from the category tally', async () => {
    const hex = await buildRegistry('hex', [
      { name: 'lodash-helpers', type: 'component', latest: '1.0.0', categories: ['utils'] },
      { name: 'api-express', type: 'component', latest: '1.0.0', categories: ['backend'] },
    ]);
    const acme = await buildRegistry('acme', [], { block: ['hex/lodash-helpers'] });

    const { categories } = await listCategories([
      { id: 'hex', registry: hex },
      { id: 'acme', registry: acme },
    ]);
    // `utils` only came from the blocked package — it must not appear.
    expect(categories.map((c) => c.name)).toEqual(['backend']);
  });

  it('warns when a marketplace is unreachable', async () => {
    const hex = await buildRegistry('hex', [
      { name: 'api-express', type: 'component', latest: '1.0.0', categories: ['backend'] },
    ]);
    const dead = pathToFileURL(join(work, 'no-registry')).href;

    const { categories, warnings } = await listCategories([
      { id: 'hex', registry: hex },
      { id: 'dead', registry: dead },
    ]);
    expect(categories.map((c) => c.name)).toEqual(['backend']);
    expect(warnings.some((w) => w.startsWith('dead: '))).toBe(true);
  });
});

describe('browseCategory', () => {
  it('lists the entries filed under a category across marketplaces', async () => {
    const hex = await buildRegistry('hex', [
      { name: 'api-express', type: 'component', latest: '1.0.0', categories: ['backend'] },
      { name: 'acme-ui', type: 'component', latest: '1.0.0', categories: ['frontend'] },
    ]);
    const acme = await buildRegistry('acme', [
      { name: 'acme-api', type: 'component', latest: '2.0.0', categories: ['backend'] },
    ]);

    const { category, results } = await browseCategory(
      [
        { id: 'hex', registry: hex },
        { id: 'acme', registry: acme },
      ],
      'backend',
    );
    expect(category).toBe('backend');
    expect(results.map((e) => `${e.marketplace}/${e.name}`)).toEqual([
      'hex/api-express',
      'acme/acme-api',
    ]);
  });

  it('returns no entries for an unknown category', async () => {
    const hex = await buildRegistry('hex', [
      { name: 'api-express', type: 'component', latest: '1.0.0', categories: ['backend'] },
    ]);
    const { results } = await browseCategory([{ id: 'hex', registry: hex }], 'nonexistent');
    expect(results).toEqual([]);
  });
});

describe('formatCategories', () => {
  it('renders name + count rows', () => {
    const out = formatCategories([
      { name: 'backend', count: 3 },
      { name: 'database', count: 1 },
    ]);
    expect(out).toContain('backend');
    expect(out).toContain('(3)');
    expect(out).toContain('database');
    expect(out).toContain('(1)');
  });
});
