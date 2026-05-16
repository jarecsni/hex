import { createMarketplaceCatalogue } from '../catalogue/marketplace.js';
import { CatalogueError } from '../catalogue/types.js';
import type { TrustedKeys } from './package.js';
import { type AggregatePolicy, emptyPolicy, isBlocked, qualifiedName } from './policy.js';
import {
  type Fetcher,
  type MarketplaceResolveResult,
  pickVersion,
  resolveMarketplaceSource,
} from './source.js';

/**
 * Qualified-name addressing (M9.4). A template or component is named by
 * an *address* in one of these forms:
 *
 *   hex/api-express@^1.0      qualified  — a specific marketplace
 *   hex/api-express           qualified  — version defaults to `latest`
 *   api-express@^1.0          bare       — walk marketplaces in order
 *   api-express               bare       — walk + default `latest`
 *
 * The `/` separates a marketplace id from the package name and is
 * reserved — neither id nor name may contain it (`idea.md` §9). A
 * qualified address pins exactly one marketplace; a bare address is
 * resolved by trying each configured marketplace in order, first hit
 * wins.
 *
 * The ordered marketplace list is passed in (wired from
 * `~/.hex/config.yaml` by M9.5). `resolveAddress` also honours the M9.6
 * block/override policy when one is supplied.
 */

export class AddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AddressError';
  }
}

/** A parsed address — `marketplace` is `null` for the bare form. */
export type ParsedAddress = {
  /** Marketplace id, or `null` when the address is bare. */
  marketplace: string | null;
  /** Package name. */
  name: string;
  /** Semver spec; `latest` when the address carried no `@version`. */
  version: string;
};

/** A configured marketplace: a stable id mapped to a registry URL. */
export type MarketplaceConfig = {
  /** Short id used as the qualifier in `<id>/<name>` addresses. */
  id: string;
  /** Registry base URL — `https://…/` or `file://…/`. */
  registry: string;
};

// Marketplace ids map to config keys / URL namespaces — keep them tight.
const MARKETPLACE_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
// Names just may not contain the reserved `/`, the `@` separator, or space.
const NAME_RE = /^[^/@\s]+$/;

/**
 * Normalise a version spec to a full `MAJOR.MINOR.PATCH` triplet so the
 * shared `versionSatisfies` matcher accepts it. Two-component specs like
 * `^1.0` (used in this epic's own examples) are padded with `.0`;
 * `latest` and `*` pass through untouched, as does anything not in
 * recognisable `[op]digits` shape (downstream reports the bad spec).
 */
export function normalizeVersionSpec(spec: string): string {
  if (spec === 'latest' || spec === '*') return spec;
  const m = /^(\^|~|>=|<=|>|<|=)?(\d+)(?:\.(\d+))?(?:\.(\d+))?(.*)$/.exec(spec);
  if (!m) return spec;
  const [, op = '', maj, min = '0', pat = '0', suffix = ''] = m;
  return `${op}${maj}.${min}.${pat}${suffix}`;
}

/**
 * Parse an address string into its `{ marketplace, name, version }`
 * parts. Throws `AddressError` on a malformed address.
 */
export function parseAddress(input: string): ParsedAddress {
  const raw = input.trim();
  if (raw.length === 0) throw new AddressError('empty address');

  let marketplace: string | null = null;
  let rest = raw;

  const slash = raw.indexOf('/');
  if (slash !== -1) {
    marketplace = raw.slice(0, slash);
    rest = raw.slice(slash + 1);
    if (!MARKETPLACE_ID_RE.test(marketplace)) {
      throw new AddressError(`invalid marketplace id in address: "${input}"`);
    }
    if (rest.includes('/')) {
      throw new AddressError(`address has more than one "/": "${input}"`);
    }
  }

  let name = rest;
  let version = 'latest';
  const at = rest.indexOf('@');
  if (at !== -1) {
    name = rest.slice(0, at);
    const rawVersion = rest.slice(at + 1);
    if (rawVersion.length === 0) throw new AddressError(`address has an empty version: "${input}"`);
    version = normalizeVersionSpec(rawVersion);
  }

  if (!NAME_RE.test(name)) {
    throw new AddressError(`invalid package name in address: "${input}"`);
  }

  return { marketplace, name, version };
}

export type ResolveAddressOpts = {
  /** Configured marketplaces, in resolution order (first hit wins for bare names). */
  marketplaces: MarketplaceConfig[];
  /** keyId → SPKI public-key PEM, forwarded to package verification. */
  trustedKeys: TrustedKeys;
  /** Override the cache root. */
  cacheDir?: string;
  /** Force a re-fetch. */
  refresh?: boolean;
  /** Override the URL fetcher (test injection). */
  fetcher?: Fetcher;
  /**
   * Block/override policy (M9.6). Blocked qualified names are refused;
   * a bare name with an override is redirected to the override target.
   * Defaults to an empty policy.
   */
  policy?: AggregatePolicy;
};

/** A resolved address — the fetch result plus the marketplace it came from. */
export type ResolvedAddress = MarketplaceResolveResult & {
  /** Id of the marketplace that provided the package. */
  marketplace: string;
  /** The parsed address that was resolved. */
  address: ParsedAddress;
};

/**
 * Resolve an address into a verified `ComponentBundle`.
 *
 * Qualified addresses pin one marketplace — an unknown id fails with a
 * clear error naming the configured marketplaces. Bare addresses walk
 * the configured marketplaces in order: the first whose catalogue lists
 * a version satisfying the spec wins. A marketplace that simply lacks
 * the package is skipped; if none provide it, the collected reasons are
 * reported.
 *
 * Policy (M9.6): a blocked qualified name is refused outright; a bare
 * name carrying an override is redirected to the override's qualified
 * target (keeping the caller's version spec).
 */
export async function resolveAddress(
  input: string,
  opts: ResolveAddressOpts,
): Promise<ResolvedAddress> {
  const address = parseAddress(input);
  const policy = opts.policy ?? emptyPolicy();
  const fetchOpts = {
    trustedKeys: opts.trustedKeys,
    cacheDir: opts.cacheDir,
    refresh: opts.refresh,
    fetcher: opts.fetcher,
  };

  const findMarketplace = (id: string): MarketplaceConfig => {
    const mkt = opts.marketplaces.find((m) => m.id === id);
    if (!mkt) {
      const configured = opts.marketplaces.map((m) => m.id).join(', ') || '(none)';
      throw new AddressError(`marketplace "${id}" is not configured (configured: ${configured})`);
    }
    return mkt;
  };

  const resolveFrom = async (mkt: MarketplaceConfig, name: string): Promise<ResolvedAddress> => {
    const result = await resolveMarketplaceSource(
      { registry: mkt.registry, name, version: address.version },
      fetchOpts,
    );
    return { ...result, marketplace: mkt.id, address };
  };

  // Qualified address — pin exactly the named marketplace.
  if (address.marketplace !== null) {
    const mkt = findMarketplace(address.marketplace);
    if (isBlocked(policy, mkt.id, address.name)) {
      throw new AddressError(
        `"${qualifiedName(mkt.id, address.name)}" is blocked by marketplace policy`,
      );
    }
    return resolveFrom(mkt, address.name);
  }

  // Bare address with an override — redirect to the qualified target.
  const override = policy.overrides.get(address.name);
  if (override !== undefined) {
    const target = parseAddress(override);
    if (target.marketplace === null) {
      throw new AddressError(
        `policy override for "${address.name}" must be a qualified name, got "${override}"`,
      );
    }
    const mkt = findMarketplace(target.marketplace);
    if (isBlocked(policy, mkt.id, target.name)) {
      throw new AddressError(`override target "${override}" is blocked by marketplace policy`);
    }
    return resolveFrom(mkt, target.name);
  }

  // Bare address — walk marketplaces in order, first satisfying hit wins.
  const skipped: string[] = [];
  for (const mkt of opts.marketplaces) {
    if (isBlocked(policy, mkt.id, address.name)) {
      skipped.push(`  ${mkt.id}: blocked by marketplace policy`);
      continue;
    }
    let versions: string[];
    try {
      versions = await createMarketplaceCatalogue(mkt.registry, {
        fetcher: opts.fetcher,
      }).listVersions(address.name);
    } catch (err) {
      // Package absent (or registry unreachable) — skip to the next.
      const detail = err instanceof CatalogueError ? err.message : String(err);
      skipped.push(`  ${mkt.id}: ${detail}`);
      continue;
    }
    if (pickVersion(versions, address.version) === null) {
      skipped.push(`  ${mkt.id}: no version satisfies "${address.version}"`);
      continue;
    }
    return resolveFrom(mkt, address.name);
  }

  const detail = skipped.length > 0 ? `\n${skipped.join('\n')}` : '';
  throw new AddressError(
    `no configured marketplace provides "${address.name}@${address.version}"${detail}`,
  );
}
