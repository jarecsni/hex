import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatSearchTable, searchMarketplaces } from '../../src/commands/search.js';
import type { MarketplaceConfig } from '../../src/core/marketplace/address.js';

let work: string;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'hex-search-test-'));
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

type CataloguePkg = {
  name: string;
  type: 'component' | 'recipe';
  latest: string;
  description?: string;
  categories?: string[];
};
type Policy = { block?: string[]; override?: Array<{ name: string; use: string }> };

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

describe('searchMarketplaces', () => {
  it('aggregates hits across every configured marketplace', async () => {
    const hex = await buildRegistry('hex', [
      { name: 'api-express', type: 'component', latest: '1.0.0', description: 'Express layer' },
    ]);
    const acme = await buildRegistry('acme', [
      { name: 'acme-api', type: 'component', latest: '2.0.0', description: 'Express layer' },
    ]);
    const marketplaces: MarketplaceConfig[] = [
      { id: 'hex', registry: hex },
      { id: 'acme', registry: acme },
    ];

    const { results, warnings } = await searchMarketplaces(marketplaces, 'express');
    expect(warnings).toEqual([]);
    expect(results.map((e) => `${e.marketplace}/${e.name}`)).toEqual([
      'hex/api-express',
      'acme/acme-api',
    ]);
  });

  it('respects block policy — a blocked entry is absent from results', async () => {
    const hex = await buildRegistry('hex', [
      { name: 'lodash-helpers', type: 'component', latest: '1.0.0' },
      { name: 'api-express', type: 'component', latest: '1.0.0' },
    ]);
    const acme = await buildRegistry('acme', [], { block: ['hex/lodash-helpers'] });

    const { results } = await searchMarketplaces(
      [
        { id: 'hex', registry: hex },
        { id: 'acme', registry: acme },
      ],
      '',
    );
    expect(results.map((e) => `${e.marketplace}/${e.name}`)).toEqual(['hex/api-express']);
  });

  it('collects a warning when a marketplace is unreachable', async () => {
    const hex = await buildRegistry('hex', [
      { name: 'api-express', type: 'component', latest: '1.0.0' },
    ]);
    const dead = pathToFileURL(join(work, 'no-registry')).href;

    const { results, warnings } = await searchMarketplaces(
      [
        { id: 'hex', registry: hex },
        { id: 'dead', registry: dead },
      ],
      'api',
    );
    expect(results.map((e) => e.marketplace)).toEqual(['hex']);
    // One warning from the policy load, one from the search fan-out.
    expect(warnings.some((w) => w.startsWith('dead: '))).toBe(true);
  });
});

describe('formatSearchTable', () => {
  it('renders qualified-name@version rows with descriptions', () => {
    const out = formatSearchTable([
      {
        marketplace: 'hex',
        name: 'db-postgres',
        type: 'component',
        latest: '2.0.0',
        description: 'Postgres data access',
        categories: [],
      },
    ]);
    expect(out).toContain('hex/db-postgres');
    expect(out).toContain('@2.0.0');
    expect(out).toContain('component');
    expect(out).toContain('Postgres data access');
  });
});
