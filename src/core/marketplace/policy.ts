import { fetchCatalogueDoc } from '../catalogue/marketplace.js';
import type { MarketplaceConfig } from './address.js';
import type { Fetcher } from './source.js';

/**
 * Block + override policy (M9.6). A company marketplace ships policy
 * directives *inside its own `catalogue.json`* — there is deliberately
 * no per-user policy file; the rules travel with the marketplace.
 *
 * Two directives, both at qualified-name granularity (no version ranges,
 * no tag filters):
 *
 *   - `block`    — qualified names (`hex/lodash-helpers`) hidden from
 *                  discovery and refused by resolution.
 *   - `override` — a bare name is redirected to a qualified target
 *                  (`db-postgres` → `acme/db-postgres`), so bare-name
 *                  resolution prefers the company's version.
 *
 * Every configured marketplace may contribute. Blocks union; for an
 * override the first marketplace (declared order) to claim a bare name
 * wins, matching bare-name resolution precedence.
 */

/** The aggregated policy across all configured marketplaces. */
export type AggregatePolicy = {
  /** Qualified names blocked anywhere — `<marketplace>/<name>`. */
  blocked: Set<string>;
  /** Bare name → qualified target a marketplace wants resolution to prefer. */
  overrides: Map<string, string>;
  /** One line per marketplace whose policy could not be loaded. */
  warnings: string[];
};

export type LoadPolicyOpts = {
  /** Override the URL fetcher (test injection). */
  fetcher?: Fetcher;
};

/** The qualified name of a package in a marketplace. */
export function qualifiedName(marketplace: string, name: string): string {
  return `${marketplace}/${name}`;
}

/** Is `<marketplace>/<name>` blocked by the aggregate policy? */
export function isBlocked(policy: AggregatePolicy, marketplace: string, name: string): boolean {
  return policy.blocked.has(qualifiedName(marketplace, name));
}

/**
 * Fetch every configured marketplace's `catalogue.json` and fold their
 * `policy` blocks into one `AggregatePolicy`. A marketplace whose
 * catalogue cannot be loaded contributes a warning and is skipped — a
 * single unreachable registry must not erase everyone else's policy.
 */
export async function loadAggregatePolicy(
  marketplaces: MarketplaceConfig[],
  opts: LoadPolicyOpts = {},
): Promise<AggregatePolicy> {
  const blocked = new Set<string>();
  const overrides = new Map<string, string>();
  const warnings: string[] = [];

  for (const mkt of marketplaces) {
    let policy: { block: string[]; override: Array<{ name: string; use: string }> } | undefined;
    try {
      policy = (await fetchCatalogueDoc(mkt.registry, opts.fetcher)).policy;
    } catch (err) {
      warnings.push(`${mkt.id}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (!policy) continue;
    for (const q of policy.block) blocked.add(q);
    for (const o of policy.override) {
      // First marketplace to claim a bare name wins.
      if (!overrides.has(o.name)) overrides.set(o.name, o.use);
    }
  }

  return { blocked, overrides, warnings };
}

/** An empty policy — nothing blocked, nothing overridden. */
export function emptyPolicy(): AggregatePolicy {
  return { blocked: new Set(), overrides: new Map(), warnings: [] };
}
