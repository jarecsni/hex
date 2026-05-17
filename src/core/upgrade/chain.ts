import { rm } from 'node:fs/promises';
import { compareVersions } from '../marketplace/source.js';

/**
 * The stepwise migration chain walker (M11.2) — `idea.md` §1,
 * "stepwise chain".
 *
 * An app on v1 upgrading to v4 walks v1→v2, v2→v3, v3→v4: each hop runs
 * that bump's migration, so a template author never has to write (or
 * maintain) a v1→v4 migration. This module builds that ordered chain
 * and walks it.
 *
 * The walker is deliberately decoupled from *how* a version is rendered
 * and *how* a migration is applied — both arrive as injected callbacks.
 * Rendering a specific version is a generalisation of M11.1's pristine
 * reconstruction; applying a migration is M11.3. Wiring the real
 * implementations is the `hex upgrade` command's job (M11.5). That keeps
 * this module a pure orchestrator: chain arithmetic + temp-dir lifecycle.
 */

export class UpgradeChainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpgradeChainError';
  }
}

/**
 * Build the ordered version chain from `from` to `to`, drawn from the
 * `available` published versions. Both ends are included:
 * `buildVersionChain('1.0.0', '1.3.0', [...])` → every published version
 * in `[1.0.0 … 1.3.0]`, ascending.
 *
 * Throws when `from` or `to` is not a published version, or when `from`
 * is not strictly older than `to` — there is nothing to upgrade
 * otherwise.
 */
export function buildVersionChain(from: string, to: string, available: string[]): string[] {
  const sorted = [...new Set(available)].sort(compareVersions);

  const fromIdx = sorted.findIndex((v) => compareVersions(v, from) === 0);
  if (fromIdx === -1) {
    throw new UpgradeChainError(`current version ${from} is not among the published versions`);
  }
  const toIdx = sorted.findIndex((v) => compareVersions(v, to) === 0);
  if (toIdx === -1) {
    throw new UpgradeChainError(`target version ${to} is not among the published versions`);
  }
  if (toIdx <= fromIdx) {
    throw new UpgradeChainError(
      `target version ${to} is not newer than the current version ${from}`,
    );
  }
  return sorted.slice(fromIdx, toIdx + 1);
}

/** One hop of the chain, handed to the injected migration runner. */
export type MigrationStep = {
  /** The version stepped from. */
  from: string;
  /** The version stepped to. */
  to: string;
  /** Pristine tree rendered at `from` (the prior step). Read-only input. */
  fromTree: string;
  /** Pristine tree rendered at `to` — the migration mutates this in place. */
  toTree: string;
};

export type WalkChainInput = {
  /** The app's current (locked) version. */
  from: string;
  /** The version to upgrade to. */
  to: string;
  /** Every published version of the template. */
  available: string[];
  /**
   * Render a version's pristine tree, returning its (temp) path. A
   * generalisation of M11.1's `reconstructPristine`; the walker owns the
   * returned directories' lifecycle.
   */
  renderVersion: (version: string) => Promise<string>;
  /**
   * Apply the `from`→`to` migration to `step.toTree`. Supplied by M11.3.
   * A hop with no migration is a no-op — the runner simply returns.
   */
  runMigration: (step: MigrationStep) => Promise<void>;
};

export type UpgradeChainResult = {
  /** The version chain walked, inclusive of both ends. */
  chain: string[];
  /** Pristine tree at the start version — `pristine_old`. */
  pristineOld: string;
  /** Pristine tree at the target version, post-migrations — `pristine_new`. */
  pristineNew: string;
};

/**
 * Walk the upgrade chain. For each hop it renders the next version's
 * pristine tree and runs that hop's migration against it, threading the
 * prior step's tree through as `fromTree`.
 *
 * The walker only ever writes to the temp directories `renderVersion`
 * hands back — never the user's working tree. On *any* failure it
 * removes every directory it created (including `pristine_old`) and
 * rethrows, so a mid-chain abort leaves nothing behind. On success it
 * keeps `pristine_old` and `pristine_new` for the caller (the 3-way
 * merge, M11.4) and cleans up the intermediate step trees.
 */
export async function walkUpgradeChain(input: WalkChainInput): Promise<UpgradeChainResult> {
  const chain = buildVersionChain(input.from, input.to, input.available);
  const created: string[] = [];

  try {
    const pristineOld = await input.renderVersion(chain[0] as string);
    created.push(pristineOld);

    let fromTree = pristineOld;
    let fromVersion = chain[0] as string;
    for (let i = 1; i < chain.length; i++) {
      const toVersion = chain[i] as string;
      const toTree = await input.renderVersion(toVersion);
      created.push(toTree);
      await input.runMigration({ from: fromVersion, to: toVersion, fromTree, toTree });
      fromTree = toTree;
      fromVersion = toVersion;
    }
    const pristineNew = fromTree;

    // Drop the intermediate step trees; keep only old + new.
    await Promise.all(
      created
        .filter((dir) => dir !== pristineOld && dir !== pristineNew)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
    return { chain, pristineOld, pristineNew };
  } catch (err) {
    // Mid-chain failure — remove every temp tree the walk produced.
    await Promise.all(created.map((dir) => rm(dir, { recursive: true, force: true })));
    throw err;
  }
}
