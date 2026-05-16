import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AddressError,
  type MarketplaceConfig,
  parseAddress,
  resolveAddress,
} from '../../../src/core/marketplace/address.js';
import {
  type SigningKeypair,
  generateSigningKeypair,
  packPackage,
} from '../../../src/core/marketplace/package.js';

let work: string;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'hex-addr-test-'));
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

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

/** Build a `file://` registry named `dirName` with packages signed by `keys`. */
async function buildRegistry(
  dirName: string,
  packages: Record<string, string[]>,
  keys: SigningKeypair,
): Promise<string> {
  const registryDir = join(work, dirName);
  await mkdir(registryDir, { recursive: true });
  for (const [name, versions] of Object.entries(packages)) {
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

describe('parseAddress', () => {
  it('parses qualified addresses', () => {
    // Two-component specs are normalised to a full triplet.
    expect(parseAddress('hex/api-express@^1.0')).toEqual({
      marketplace: 'hex',
      name: 'api-express',
      version: '^1.0.0',
    });
    expect(parseAddress('acme/db-postgres')).toEqual({
      marketplace: 'acme',
      name: 'db-postgres',
      version: 'latest',
    });
  });

  it('parses bare addresses', () => {
    expect(parseAddress('api-express@2.0.0')).toEqual({
      marketplace: null,
      name: 'api-express',
      version: '2.0.0',
    });
    expect(parseAddress('db-postgres')).toEqual({
      marketplace: null,
      name: 'db-postgres',
      version: 'latest',
    });
  });

  it('rejects malformed addresses', () => {
    expect(() => parseAddress('')).toThrow(AddressError);
    expect(() => parseAddress('hex/api/extra')).toThrow(/more than one/);
    expect(() => parseAddress('hex/api@')).toThrow(/empty version/);
    expect(() => parseAddress('/api-express')).toThrow(AddressError);
  });
});

describe('resolveAddress — qualified', () => {
  it('pins the named marketplace', async () => {
    const keys = generateSigningKeypair();
    const hex = await buildRegistry('hex-reg', { 'db-postgres': ['1.0.0', '2.0.0'] }, keys);
    const acme = await buildRegistry('acme-reg', { 'db-postgres': ['1.5.0'] }, keys);
    const marketplaces: MarketplaceConfig[] = [
      { id: 'hex', registry: hex },
      { id: 'acme', registry: acme },
    ];

    const result = await resolveAddress('acme/db-postgres@^1.0', {
      marketplaces,
      trustedKeys: { [keys.keyId]: keys.publicKeyPem },
      cacheDir: join(work, 'cache'),
    });
    expect(result.marketplace).toBe('acme');
    expect(result.version).toBe('1.5.0');
    expect(result.registry).toBe(acme);
  });

  it('fails clearly when the named marketplace is not configured', async () => {
    const keys = generateSigningKeypair();
    const hex = await buildRegistry('hex-reg', { 'db-postgres': ['1.0.0'] }, keys);
    await expect(
      resolveAddress('nope/db-postgres', {
        marketplaces: [{ id: 'hex', registry: hex }],
        trustedKeys: { [keys.keyId]: keys.publicKeyPem },
        cacheDir: join(work, 'cache'),
      }),
    ).rejects.toThrow(/marketplace "nope" is not configured \(configured: hex\)/);
  });
});

describe('resolveAddress — bare', () => {
  it('resolves from the first configured marketplace that has the package', async () => {
    const keys = generateSigningKeypair();
    // Both marketplaces carry db-postgres — first-configured wins.
    const hex = await buildRegistry('hex-reg', { 'db-postgres': ['2.0.0'] }, keys);
    const acme = await buildRegistry('acme-reg', { 'db-postgres': ['9.9.9'] }, keys);

    const result = await resolveAddress('db-postgres', {
      marketplaces: [
        { id: 'hex', registry: hex },
        { id: 'acme', registry: acme },
      ],
      trustedKeys: { [keys.keyId]: keys.publicKeyPem },
      cacheDir: join(work, 'cache'),
    });
    expect(result.marketplace).toBe('hex');
    expect(result.version).toBe('2.0.0');
  });

  it('falls through to a later marketplace when earlier ones lack the package', async () => {
    const keys = generateSigningKeypair();
    const hex = await buildRegistry('hex-reg', { 'api-express': ['1.0.0'] }, keys);
    const acme = await buildRegistry('acme-reg', { 'db-postgres': ['3.1.0'] }, keys);

    const result = await resolveAddress('db-postgres', {
      marketplaces: [
        { id: 'hex', registry: hex },
        { id: 'acme', registry: acme },
      ],
      trustedKeys: { [keys.keyId]: keys.publicKeyPem },
      cacheDir: join(work, 'cache'),
    });
    expect(result.marketplace).toBe('acme');
    expect(result.version).toBe('3.1.0');
  });

  it('fails when no configured marketplace provides the package', async () => {
    const keys = generateSigningKeypair();
    const hex = await buildRegistry('hex-reg', { 'api-express': ['1.0.0'] }, keys);
    await expect(
      resolveAddress('db-postgres', {
        marketplaces: [{ id: 'hex', registry: hex }],
        trustedKeys: { [keys.keyId]: keys.publicKeyPem },
        cacheDir: join(work, 'cache'),
      }),
    ).rejects.toThrow(/no configured marketplace provides "db-postgres@latest"/);
  });

  it('skips a marketplace whose versions do not satisfy the spec', async () => {
    const keys = generateSigningKeypair();
    const hex = await buildRegistry('hex-reg', { 'db-postgres': ['1.0.0'] }, keys);
    const acme = await buildRegistry('acme-reg', { 'db-postgres': ['2.4.0'] }, keys);

    const result = await resolveAddress('db-postgres@^2.0.0', {
      marketplaces: [
        { id: 'hex', registry: hex },
        { id: 'acme', registry: acme },
      ],
      trustedKeys: { [keys.keyId]: keys.publicKeyPem },
      cacheDir: join(work, 'cache'),
    });
    // hex only has 1.0.0 (fails ^2.0.0) → falls through to acme.
    expect(result.marketplace).toBe('acme');
    expect(result.version).toBe('2.4.0');
  });
});
