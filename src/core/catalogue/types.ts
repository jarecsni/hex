/**
 * The `Catalogue` interface — the *discovery* side of a marketplace
 * (M9.3). `idea.md` §9 deliberately splits discovery from fetch:
 *
 *   - `Source` (file / git / marketplace) answers "fetch me *this*
 *     `(name, version)`" — the recipe resolver's concern.
 *   - `Catalogue` answers "what is *out there*?" — search, browse,
 *     list-versions. Only a marketplace can answer this.
 *
 * `FileSource` and `GitSource` are `Source`s but **not** `Catalogue`s: a
 * directory or a git URL has nothing to search. Giving them no-op
 * `Catalogue` stubs would fuse two abstractions that are kept apart on
 * purpose — so only `MarketplaceSource` carries a `Catalogue`.
 */

/** A single package as it appears in discovery results. */
export type CatalogueEntry = {
  name: string;
  type: 'component' | 'recipe';
  /** Component kind (`db`, `api`, …) — absent for recipes. */
  kind?: string;
  /** Highest published version. */
  latest: string;
  /** One-line human description, if the registry provides one. */
  description?: string;
  /** Browse categories this package belongs to. */
  categories: string[];
};

/** The discovery surface a marketplace exposes. */
export type Catalogue = {
  /**
   * Free-text search across package name, description, and categories.
   * Case-insensitive substring match; an empty query returns everything.
   */
  search(query: string): Promise<CatalogueEntry[]>;
  /** Every package filed under `category`. */
  browse(category: string): Promise<CatalogueEntry[]>;
  /** Published versions of `name`, newest first. */
  listVersions(name: string): Promise<string[]>;
};

export class CatalogueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogueError';
  }
}
