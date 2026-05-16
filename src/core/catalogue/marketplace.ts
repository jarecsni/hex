import { z } from 'zod';
import {
  type Fetcher,
  compareVersions,
  defaultFetcher,
  registryIndexSchema,
} from '../marketplace/source.js';
import { type Catalogue, type CatalogueEntry, CatalogueError } from './types.js';

/**
 * `MarketplaceSource`'s `Catalogue` implementation (M9.3) — the discovery
 * counterpart to `resolveMarketplaceSource` (the `Source` side). Search
 * and browse read a registry-wide `catalogue.json`; `listVersions` reads
 * the same per-package `index.json` the `Source` fetch path uses.
 *
 * Registry discovery endpoints (HTTP or `file://`):
 *
 *   <registry>/catalogue.json      →  { packages: [{name, type, …}] }
 *   <registry>/<name>/index.json   →  { name, versions: [{version, …}] }
 *
 * Only a marketplace gets a `Catalogue`. `FileSource` / `GitSource` have
 * nothing to search — see `core/catalogue/types.ts`.
 */

const semverRe = /^\d+\.\d+\.\d+(?:[-+].*)?$/;

/**
 * Block + override policy a company marketplace ships inside its
 * `catalogue.json` (M9.6). Granularity is by qualified name only.
 */
const policySchema = z.object({
  /** Qualified names (`<marketplace>/<name>`) hidden from discovery + resolution. */
  block: z.array(z.string().min(1)).default([]),
  /** Bare-name → qualified-name preferences for resolution. */
  override: z.array(z.object({ name: z.string().min(1), use: z.string().min(1) })).default([]),
});

const catalogueDocSchema = z.object({
  packages: z
    .array(
      z.object({
        name: z.string().min(1),
        type: z.enum(['component', 'recipe']),
        kind: z.string().min(1).optional(),
        latest: z.string().regex(semverRe, 'catalogue latest must be semver'),
        description: z.string().optional(),
        categories: z.array(z.string().min(1)).default([]),
      }),
    )
    .default([]),
  policy: policySchema.optional(),
});

/** The full parsed `catalogue.json` — packages plus optional policy. */
export type CatalogueDoc = z.infer<typeof catalogueDocSchema>;

export type MarketplaceCatalogueOpts = {
  /** Override the URL fetcher (test injection). */
  fetcher?: Fetcher;
};

function registryBase(registry: string): string {
  return registry.endsWith('/') ? registry : `${registry}/`;
}

/**
 * Fetch + schema-validate a registry's `catalogue.json`. Shared by the
 * `Catalogue` discovery methods and the M9.6 policy loader, so both see
 * exactly the same parsed document.
 */
export async function fetchCatalogueDoc(
  registry: string,
  fetcher: Fetcher = defaultFetcher,
): Promise<CatalogueDoc> {
  const url = new URL('catalogue.json', registryBase(registry)).href;
  let raw: Buffer;
  try {
    raw = await fetcher(url);
  } catch (err) {
    throw new CatalogueError(
      `cannot load catalogue from ${registry}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(raw.toString('utf8'));
  } catch (err) {
    throw new CatalogueError(
      `catalogue.json from ${registry} is not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  const parsed = catalogueDocSchema.safeParse(json);
  if (!parsed.success) {
    throw new CatalogueError(
      `catalogue.json from ${registry} failed validation: ${parsed.error.issues
        .map((i) => i.message)
        .join('; ')}`,
    );
  }
  return parsed.data;
}

/**
 * Build a `Catalogue` backed by the registry at `registry`.
 *
 * `search` and `browse` are deliberately uncached — discovery wants
 * fresh results, and `catalogue.json` is small. `listVersions` likewise
 * reads the index live; the *fetch* path (`MarketplaceSource`) is what
 * owns the package cache.
 */
export function createMarketplaceCatalogue(
  registry: string,
  opts: MarketplaceCatalogueOpts = {},
): Catalogue {
  const fetcher = opts.fetcher ?? defaultFetcher;
  const base = registryBase(registry);

  async function loadCatalogue(): Promise<CatalogueEntry[]> {
    const doc = await fetchCatalogueDoc(registry, fetcher);
    return doc.packages.map((p) => ({
      name: p.name,
      type: p.type,
      kind: p.kind,
      latest: p.latest,
      description: p.description,
      categories: p.categories,
    }));
  }

  return {
    async search(query) {
      const all = await loadCatalogue();
      const q = query.trim().toLowerCase();
      if (q.length === 0) return all;
      return all.filter((e) => {
        const haystack = [e.name, e.description ?? '', ...e.categories].join(' ').toLowerCase();
        return haystack.includes(q);
      });
    },

    async browse(category) {
      const all = await loadCatalogue();
      const wanted = category.trim().toLowerCase();
      return all.filter((e) => e.categories.some((c) => c.toLowerCase() === wanted));
    },

    async listVersions(name) {
      const url = new URL(`${encodeURIComponent(name)}/index.json`, base).href;
      let raw: Buffer;
      try {
        raw = await fetcher(url);
      } catch (err) {
        throw new CatalogueError(
          `no package "${name}" in ${registry}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      let json: unknown;
      try {
        json = JSON.parse(raw.toString('utf8'));
      } catch (err) {
        throw new CatalogueError(
          `index for "${name}" is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      const parsed = registryIndexSchema.safeParse(json);
      if (!parsed.success) {
        throw new CatalogueError(
          `index for "${name}" failed validation: ${parsed.error.issues
            .map((i) => i.message)
            .join('; ')}`,
        );
      }
      return parsed.data.versions.map((v) => v.version).sort((a, b) => compareVersions(b, a));
    },
  };
}
