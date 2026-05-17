import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type MigrationStep,
  UpgradeChainError,
  buildVersionChain,
  walkUpgradeChain,
} from '../../../src/core/upgrade/chain.js';

let work: string;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'hex-chain-test-'));
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

describe('buildVersionChain', () => {
  it('includes both ends and every published version between', () => {
    expect(buildVersionChain('1.0.0', '1.3.0', ['1.0.0', '1.1.0', '1.2.0', '1.3.0'])).toEqual([
      '1.0.0',
      '1.1.0',
      '1.2.0',
      '1.3.0',
    ]);
  });

  it('sorts the available versions by semver, ignoring input order', () => {
    expect(buildVersionChain('1.0.0', '2.0.0', ['2.0.0', '1.1.0', '1.0.0'])).toEqual([
      '1.0.0',
      '1.1.0',
      '2.0.0',
    ]);
  });

  it('walks only the versions that were actually published (gaps allowed)', () => {
    // No 1.2.0 was ever published — the chain hops 1.1.0 → 1.3.0 directly.
    expect(buildVersionChain('1.1.0', '1.3.0', ['1.0.0', '1.1.0', '1.3.0'])).toEqual([
      '1.1.0',
      '1.3.0',
    ]);
  });

  it('throws when the current version is not published', () => {
    expect(() => buildVersionChain('1.0.5', '1.2.0', ['1.0.0', '1.1.0', '1.2.0'])).toThrow(
      UpgradeChainError,
    );
  });

  it('throws when the target version is not published', () => {
    expect(() => buildVersionChain('1.0.0', '9.9.9', ['1.0.0', '1.1.0', '1.2.0'])).toThrow(
      UpgradeChainError,
    );
  });

  it('throws when the target is not newer than the current version', () => {
    expect(() => buildVersionChain('2.0.0', '1.0.0', ['1.0.0', '2.0.0'])).toThrow(/not newer/);
    expect(() => buildVersionChain('1.0.0', '1.0.0', ['1.0.0'])).toThrow(UpgradeChainError);
  });
});

describe('walkUpgradeChain', () => {
  /** A `renderVersion` that makes a real temp dir tagged with the version. */
  function trackingRenderer(): {
    renderVersion: (v: string) => Promise<string>;
    dirs: Map<string, string>;
  } {
    const dirs = new Map<string, string>();
    return {
      dirs,
      async renderVersion(v) {
        const dir = await mkdtemp(join(work, `v${v}-`));
        await writeFile(join(dir, 'VERSION'), v, 'utf8');
        dirs.set(v, dir);
        return dir;
      },
    };
  }

  it('runs each hop migration in order, from old to new', async () => {
    const { renderVersion } = trackingRenderer();
    const steps: Array<[string, string]> = [];

    const result = await walkUpgradeChain({
      from: '1.0.0',
      to: '3.0.0',
      available: ['1.0.0', '2.0.0', '3.0.0'],
      renderVersion,
      async runMigration(step: MigrationStep) {
        steps.push([step.from, step.to]);
      },
    });

    expect(result.chain).toEqual(['1.0.0', '2.0.0', '3.0.0']);
    expect(steps).toEqual([
      ['1.0.0', '2.0.0'],
      ['2.0.0', '3.0.0'],
    ]);
  });

  it('threads the prior step tree through as fromTree', async () => {
    const { renderVersion } = trackingRenderer();
    const seen: MigrationStep[] = [];

    await walkUpgradeChain({
      from: '1.0.0',
      to: '3.0.0',
      available: ['1.0.0', '2.0.0', '3.0.0'],
      renderVersion,
      async runMigration(step) {
        seen.push({ ...step });
      },
    });

    // Hop 2's fromTree is hop 1's toTree — the chain is threaded.
    expect(seen[0]?.toTree).toBe(seen[1]?.fromTree);
  });

  it('keeps pristine_old and pristine_new, cleans the intermediate trees', async () => {
    const { renderVersion, dirs } = trackingRenderer();
    const result = await walkUpgradeChain({
      from: '1.0.0',
      to: '3.0.0',
      available: ['1.0.0', '2.0.0', '3.0.0'],
      renderVersion,
      async runMigration() {},
    });

    expect(result.pristineOld).toBe(dirs.get('1.0.0'));
    expect(result.pristineNew).toBe(dirs.get('3.0.0'));
    expect(existsSync(result.pristineOld)).toBe(true);
    expect(existsSync(result.pristineNew)).toBe(true);
    // The 2.0.0 step tree was scratch — removed.
    expect(existsSync(dirs.get('2.0.0') as string)).toBe(false);
  });

  it('removes every temp tree and rethrows when a migration fails mid-chain', async () => {
    const { renderVersion, dirs } = trackingRenderer();

    await expect(
      walkUpgradeChain({
        from: '1.0.0',
        to: '3.0.0',
        available: ['1.0.0', '2.0.0', '3.0.0'],
        renderVersion,
        async runMigration(step) {
          if (step.to === '3.0.0') throw new Error('migration 2.0.0→3.0.0 missing');
        },
      }),
    ).rejects.toThrow(/2\.0\.0→3\.0\.0/);

    // Clean state — nothing the walk produced survives.
    for (const dir of dirs.values()) {
      expect(existsSync(dir)).toBe(false);
    }
  });
});
