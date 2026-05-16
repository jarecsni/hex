import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMarketplaceCatalogue } from '../../../src/core/catalogue/marketplace.js';
import { CatalogueError } from '../../../src/core/catalogue/types.js';

let work: string;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'hex-cat-test-'));
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

type CataloguePkg = {
  name: string;
  type: 'component' | 'recipe';
  kind?: string;
  latest: string;
  description?: string;
  categories?: string[];
};

/**
 * Build a `file://` registry: write `catalogue.json` and a per-package
 * `<name>/index.json` for each entry. Returns the registry base URL.
 */
async function buildRegistry(
  packages: CataloguePkg[],
  indexes: Record<string, string[]> = {},
): Promise<string> {
  const registryDir = join(work, 'registry');
  await mkdir(registryDir, { recursive: true });
  await writeFile(
    join(registryDir, 'catalogue.json'),
    JSON.stringify({ packages }, null, 2),
    'utf8',
  );
  for (const [name, versions] of Object.entries(indexes)) {
    await mkdir(join(registryDir, name), { recursive: true });
    await writeFile(
      join(registryDir, name, 'index.json'),
      JSON.stringify(
        { name, versions: versions.map((v) => ({ version: v, package: `${name}-${v}.hexpkg` })) },
        null,
        2,
      ),
      'utf8',
    );
  }
  return pathToFileURL(registryDir).href;
}

const SAMPLE: CataloguePkg[] = [
  {
    name: 'db-postgres',
    type: 'component',
    kind: 'db',
    latest: '2.0.0',
    description: 'Postgres data access',
    categories: ['database', 'backend'],
  },
  {
    name: 'api-express',
    type: 'component',
    kind: 'api',
    latest: '1.4.0',
    description: 'Express HTTP layer',
    categories: ['backend'],
  },
  {
    name: 'node-ts-monorepo',
    type: 'recipe',
    latest: '0.5.0',
    description: 'TypeScript monorepo scaffold',
    categories: ['recipe'],
  },
];

describe('marketplace Catalogue — search', () => {
  it('matches on name, description, and category', async () => {
    const cat = createMarketplaceCatalogue(await buildRegistry(SAMPLE));

    expect((await cat.search('postgres')).map((e) => e.name)).toEqual(['db-postgres']);
    expect((await cat.search('express')).map((e) => e.name)).toEqual(['api-express']);
    // "backend" is a category on two packages.
    expect((await cat.search('backend')).map((e) => e.name).sort()).toEqual([
      'api-express',
      'db-postgres',
    ]);
  });

  it('is case-insensitive and returns everything for an empty query', async () => {
    const cat = createMarketplaceCatalogue(await buildRegistry(SAMPLE));
    expect((await cat.search('POSTGRES')).map((e) => e.name)).toEqual(['db-postgres']);
    expect((await cat.search('   ')).length).toBe(3);
  });

  it('returns an empty list when nothing matches', async () => {
    const cat = createMarketplaceCatalogue(await buildRegistry(SAMPLE));
    expect(await cat.search('nonexistent-thing')).toEqual([]);
  });

  it('surfaces full entry metadata', async () => {
    const cat = createMarketplaceCatalogue(await buildRegistry(SAMPLE));
    const [entry] = await cat.search('postgres');
    expect(entry).toEqual({
      name: 'db-postgres',
      type: 'component',
      kind: 'db',
      latest: '2.0.0',
      description: 'Postgres data access',
      categories: ['database', 'backend'],
    });
  });
});

describe('marketplace Catalogue — browse', () => {
  it('filters by category', async () => {
    const cat = createMarketplaceCatalogue(await buildRegistry(SAMPLE));
    expect((await cat.browse('database')).map((e) => e.name)).toEqual(['db-postgres']);
    expect((await cat.browse('backend')).map((e) => e.name).sort()).toEqual([
      'api-express',
      'db-postgres',
    ]);
  });

  it('returns an empty list for an unknown category', async () => {
    const cat = createMarketplaceCatalogue(await buildRegistry(SAMPLE));
    expect(await cat.browse('frontend')).toEqual([]);
  });
});

describe('marketplace Catalogue — listVersions', () => {
  it('returns published versions newest-first', async () => {
    const registry = await buildRegistry(SAMPLE, {
      'db-postgres': ['1.0.0', '2.0.0', '1.5.0'],
    });
    const cat = createMarketplaceCatalogue(registry);
    expect(await cat.listVersions('db-postgres')).toEqual(['2.0.0', '1.5.0', '1.0.0']);
  });

  it('throws CatalogueError for an unknown package', async () => {
    const cat = createMarketplaceCatalogue(await buildRegistry(SAMPLE));
    await expect(cat.listVersions('no-such-package')).rejects.toThrow(CatalogueError);
  });
});

describe('marketplace Catalogue — failure modes', () => {
  it('throws CatalogueError when the registry has no catalogue.json', async () => {
    const empty = pathToFileURL(join(work, 'empty-registry')).href;
    const cat = createMarketplaceCatalogue(empty);
    await expect(cat.search('anything')).rejects.toThrow(CatalogueError);
  });

  it('throws CatalogueError on a malformed catalogue.json', async () => {
    const registryDir = join(work, 'bad-registry');
    await mkdir(registryDir, { recursive: true });
    await writeFile(join(registryDir, 'catalogue.json'), '{ not valid json', 'utf8');
    const cat = createMarketplaceCatalogue(pathToFileURL(registryDir).href);
    await expect(cat.search('x')).rejects.toThrow(/not valid JSON/);
  });
});
