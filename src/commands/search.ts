import type { Command } from 'commander';
import { brand } from '../brand/colors.js';
import {
  type AggregateCatalogueEntry,
  createAggregateCatalogue,
} from '../core/catalogue/aggregate.js';
import { getDefaultConfigPath, loadConfig } from '../core/config/load.js';
import type { MarketplaceConfig } from '../core/marketplace/address.js';
import { loadAggregatePolicy } from '../core/marketplace/policy.js';

export type SearchResult = {
  /** Matches across all marketplaces, blocked entries already filtered out. */
  results: AggregateCatalogueEntry[];
  /** Soft failures — unreachable marketplaces, unloadable policy. */
  warnings: string[];
};

/**
 * Search every configured marketplace for `query` and aggregate the
 * hits. Block/override policy is loaded and applied: blocked entries are
 * dropped from the results (`override` is a resolution-time concern, so
 * it does not alter discovery output). Policy-load and per-marketplace
 * search failures are collected as warnings rather than thrown.
 */
export async function searchMarketplaces(
  marketplaces: MarketplaceConfig[],
  query: string,
): Promise<SearchResult> {
  const policy = await loadAggregatePolicy(marketplaces);
  const { entries, warnings } = await createAggregateCatalogue(marketplaces, { policy }).search(
    query,
  );
  return { results: entries, warnings: [...policy.warnings, ...warnings] };
}

/** Render search hits as an aligned `qualified-name@version  type  description` table. */
export function formatSearchTable(results: AggregateCatalogueEntry[]): string {
  const rows = results.map((e) => ({
    qualified: `${e.marketplace}/${e.name}`,
    version: `@${e.latest}`,
    type: e.type,
    description: e.description ?? '',
  }));

  const widths = {
    qualified: Math.max(4, ...rows.map((r) => r.qualified.length)),
    version: Math.max(7, ...rows.map((r) => r.version.length)),
    type: Math.max(4, ...rows.map((r) => r.type.length)),
  };

  return rows
    .map((r) => {
      const qualified = brand.bold(r.qualified.padEnd(widths.qualified));
      const version = brand.dim(r.version.padEnd(widths.version));
      const type = r.type.padEnd(widths.type);
      const description = brand.dim(r.description);
      return `${qualified}  ${version}  ${type}  ${description}\n`;
    })
    .join('');
}

export function registerSearch(program: Command): void {
  program
    .command('search')
    .description('search templates + components across configured marketplaces')
    .argument('<query>', 'free-text search query')
    .option('--json', 'emit machine-readable JSON', false)
    .action(async (query: string, opts: { json: boolean }) => {
      const config = await loadConfig();
      const marketplaces = config.marketplaces ?? [];

      if (marketplaces.length === 0) {
        if (opts.json) {
          process.stdout.write(`${JSON.stringify({ results: [], warnings: [] }, null, 2)}\n`);
          return;
        }
        const configPath = getDefaultConfigPath();
        const example =
          '  marketplaces:\n    - id: hex\n      registry: https://registry.hex.dev/\n';
        process.stdout.write(
          `${brand.dim('No marketplaces configured.')}\n\nAdd a marketplaces block to ${brand.bold(configPath)}:\n\n${example}`,
        );
        return;
      }

      const { results, warnings } = await searchMarketplaces(marketplaces, query);

      if (opts.json) {
        process.stdout.write(`${JSON.stringify({ results, warnings }, null, 2)}\n`);
        return;
      }

      if (results.length === 0) {
        process.stdout.write(`${brand.dim(`No matches for "${query}".`)}\n`);
      } else {
        process.stdout.write(formatSearchTable(results));
      }

      if (warnings.length > 0) {
        process.stdout.write('\n');
        for (const w of warnings) {
          process.stdout.write(`${brand.warn(`! ${w}`)}\n`);
        }
      }
    });
}
