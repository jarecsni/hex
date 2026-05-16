import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAggregateCatalogue } from '../../../src/core/catalogue/aggregate.js';
import {
  AddressError,
  type MarketplaceConfig,
  resolveAddress,
} from '../../../src/core/marketplace/address.js';
import {
  type SigningKeypair,
  generateSigningKeypair,
  packPackage,
} from '../../../src/core/marketplace/package.js';
import { loadAggregatePolicy } from '../../../src/core/marketplace/policy.js';

let work: string;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'hex-policy-test-'));
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

type CataloguePkg = { name: string; type: 'component' | 'recipe'; latest: string };
type Policy = {
  block?: string[];
  override?: Array<{ name: string; use: string }>;
};
type RegistrySpec = {
  packages?: CataloguePkg[];
  indexes?: Record<string, string[]>;
  policy?: Policy;
};

async function writeBundle(name: string, version: string): Promise<string> {
  const root = join(work, `src-${name}-${version}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(root, '.hex'), { recursive: true });
  await writeFile(
    join(root, '.hex', 'manifest.yaml'),
    `type: component\nname: ${name}\nversion: ${version}\n`,
    'utf8',
  );
  await writeFile(join(root, 'index.ts'), `export const v = '${version}';\n`, 'utf8');
  return root;
}

/** Build a `file://` registry with a catalogue (+ optional policy) and packages. */
async function buildRegistry(
  dirName: string,
  spec: RegistrySpec,
  keys: SigningKeypair,
): Promise<string> {
  const registryDir = join(work, dirName);
  await mkdir(registryDir, { recursive: true });
  await writeFile(
    join(registryDir, 'catalogue.json'),
    JSON.stringify({ packages: spec.packages ?? [], policy: spec.policy }, null, 2),
    'utf8',
  );
  for (const [name, versions] of Object.entries(spec.indexes ?? {})) {
    await mkdir(join(registryDir, name), { recursive: true });
    const indexVersions: Array<{ version: string; package: string }> = [];
    for (const version of versions) {
      const bundle = await writeBundle(name, version);
      const pkgName = `${name}-${version}.hexpkg`;
      await packPackage(bundle, join(registryDir, pkgName), { privateKeyPem: keys.privateKeyPem });
      indexVersions.push({ version, package: pkgName });
    }
    await writeFile(
      join(registryDir, name, 'index.json'),
      JSON.stringify({ name, versions: indexVersions }, null, 2),
      'utf8',
    );
  }
  return pathToFileURL(registryDir).href;
}

describe('loadAggregatePolicy', () => {
  it('unions block lists and takes the first override for a bare name', async () => {
    const keys = generateSigningKeypair();
    const hex = await buildRegistry('hex', { policy: { block: ['hex/old-thing'] } }, keys);
    const acme = await buildRegistry(
      'acme',
      {
        policy: {
          block: ['hex/lodash-helpers'],
          override: [{ name: 'db-postgres', use: 'acme/db-postgres' }],
        },
      },
      keys,
    );

    const policy = await loadAggregatePolicy([
      { id: 'hex', registry: hex },
      { id: 'acme', registry: acme },
    ]);
    expect([...policy.blocked].sort()).toEqual(['hex/lodash-helpers', 'hex/old-thing']);
    expect(policy.overrides.get('db-postgres')).toBe('acme/db-postgres');
    expect(policy.warnings).toEqual([]);
  });

  it('warns but does not fail when a marketplace catalogue is unreachable', async () => {
    const keys = generateSigningKeypair();
    const hex = await buildRegistry('hex', { policy: { block: ['hex/x'] } }, keys);
    const dead = pathToFileURL(join(work, 'no-registry')).href;

    const policy = await loadAggregatePolicy([
      { id: 'hex', registry: hex },
      { id: 'dead', registry: dead },
    ]);
    expect([...policy.blocked]).toEqual(['hex/x']);
    expect(policy.warnings).toHaveLength(1);
    expect(policy.warnings[0]).toMatch(/^dead: /);
  });
});

describe('block — discovery filtering', () => {
  it('drops a blocked qualified entry from aggregate search', async () => {
    const keys = generateSigningKeypair();
    const hex = await buildRegistry(
      'hex',
      {
        packages: [
          { name: 'lodash-helpers', type: 'component', latest: '1.0.0' },
          { name: 'api-express', type: 'component', latest: '1.0.0' },
        ],
      },
      keys,
    );
    const acme = await buildRegistry('acme', { policy: { block: ['hex/lodash-helpers'] } }, keys);
    const marketplaces: MarketplaceConfig[] = [
      { id: 'hex', registry: hex },
      { id: 'acme', registry: acme },
    ];
    const policy = await loadAggregatePolicy(marketplaces);

    const { entries } = await createAggregateCatalogue(marketplaces, { policy }).search('');
    // hex/lodash-helpers is blocked; hex/api-express survives.
    expect(entries.map((e) => `${e.marketplace}/${e.name}`)).toEqual(['hex/api-express']);
  });
});

describe('block — resolution', () => {
  it('refuses to resolve a blocked qualified address', async () => {
    const keys = generateSigningKeypair();
    const hex = await buildRegistry('hex', { indexes: { 'lodash-helpers': ['1.0.0'] } }, keys);
    const acme = await buildRegistry('acme', { policy: { block: ['hex/lodash-helpers'] } }, keys);
    const marketplaces: MarketplaceConfig[] = [
      { id: 'hex', registry: hex },
      { id: 'acme', registry: acme },
    ];
    const policy = await loadAggregatePolicy(marketplaces);

    await expect(
      resolveAddress('hex/lodash-helpers', {
        marketplaces,
        trustedKeys: { [keys.keyId]: keys.publicKeyPem },
        cacheDir: join(work, 'cache'),
        policy,
      }),
    ).rejects.toThrow(/"hex\/lodash-helpers" is blocked by marketplace policy/);
  });
});

describe('override — bare-name resolution prefers the local version', () => {
  it('redirects a bare name to the override target marketplace', async () => {
    const keys = generateSigningKeypair();
    // Both marketplaces publish db-postgres — without policy, hex (first) wins.
    const hex = await buildRegistry('hex', { indexes: { 'db-postgres': ['2.0.0'] } }, keys);
    const acme = await buildRegistry(
      'acme',
      {
        indexes: { 'db-postgres': ['5.0.0'] },
        policy: { override: [{ name: 'db-postgres', use: 'acme/db-postgres' }] },
      },
      keys,
    );
    const marketplaces: MarketplaceConfig[] = [
      { id: 'hex', registry: hex },
      { id: 'acme', registry: acme },
    ];
    const trustedKeys = { [keys.keyId]: keys.publicKeyPem };
    const cacheDir = join(work, 'cache');

    // Without policy: first-configured (hex) wins.
    const plain = await resolveAddress('db-postgres', { marketplaces, trustedKeys, cacheDir });
    expect(plain.marketplace).toBe('hex');

    // With policy: the override redirects to acme's local version.
    const policy = await loadAggregatePolicy(marketplaces);
    const overridden = await resolveAddress('db-postgres', {
      marketplaces,
      trustedKeys,
      cacheDir,
      policy,
    });
    expect(overridden.marketplace).toBe('acme');
    expect(overridden.version).toBe('5.0.0');
  });

  it('keeps the caller version spec when following an override', async () => {
    const keys = generateSigningKeypair();
    const acme = await buildRegistry(
      'acme',
      {
        indexes: { 'db-postgres': ['2.1.0', '3.0.0'] },
        policy: { override: [{ name: 'db-postgres', use: 'acme/db-postgres' }] },
      },
      keys,
    );
    const marketplaces: MarketplaceConfig[] = [{ id: 'acme', registry: acme }];
    const policy = await loadAggregatePolicy(marketplaces);

    const result = await resolveAddress('db-postgres@^2.0.0', {
      marketplaces,
      trustedKeys: { [keys.keyId]: keys.publicKeyPem },
      cacheDir: join(work, 'cache'),
      policy,
    });
    // ^2.0.0 against the override target → 2.1.0, not 3.0.0.
    expect(result.marketplace).toBe('acme');
    expect(result.version).toBe('2.1.0');
  });

  it('rejects an override pointing at an unconfigured marketplace', async () => {
    const keys = generateSigningKeypair();
    const hex = await buildRegistry(
      'hex',
      {
        indexes: { 'db-postgres': ['1.0.0'] },
        policy: { override: [{ name: 'db-postgres', use: 'ghost/db-postgres' }] },
      },
      keys,
    );
    const marketplaces: MarketplaceConfig[] = [{ id: 'hex', registry: hex }];
    const policy = await loadAggregatePolicy(marketplaces);

    await expect(
      resolveAddress('db-postgres', {
        marketplaces,
        trustedKeys: { [keys.keyId]: keys.publicKeyPem },
        cacheDir: join(work, 'cache'),
        policy,
      }),
    ).rejects.toThrow(AddressError);
  });
});
