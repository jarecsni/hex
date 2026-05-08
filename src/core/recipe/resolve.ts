import { isAbsolute, resolve as resolvePath } from 'node:path';
import type { HexConfig } from '../config/types.js';
import { type TemplateEntry, discoverTemplates } from '../discovery/index.js';
import type { ChildRef } from '../manifest/types.js';
import { type ComponentBundle, loadFromPath } from '../sources/file-source.js';
import { resolveGitSource } from '../sources/git-source.js';

export class RecipeResolutionError extends Error {
  constructor(
    message: string,
    public readonly key: string,
    public override readonly cause?: Error,
  ) {
    super(message);
    this.name = 'RecipeResolutionError';
  }
}

export type ChildResolution = {
  /** Composes-block key (kebab-case identifier on the recipe). */
  key: string;
  /** Original parsed reference from the recipe manifest. */
  ref: ChildRef;
  /** Loaded child component bundle. */
  bundle: ComponentBundle;
};

export type ResolvedRecipe = {
  recipeBundle: ComponentBundle;
  children: Map<string, ChildResolution>;
};

export type ResolveRecipeOpts = {
  /** Source-roots config; required for bare-name resolution. */
  config: HexConfig;
  /** Forwarded to `resolveGitSource` and `discoverTemplates`. */
  cacheDir?: string;
  /** Override base directory for relative `file:` paths. Defaults to the recipe bundle's rootPath. */
  cwd?: string;
  /** When provided, non-fatal warnings (e.g. duplicate-name discovery clashes) are pushed here. */
  warnings?: string[];
};

/**
 * Walk a recipe's `composes:` block and resolve every child to a loaded
 * `ComponentBundle`. Discovery (for bare-name children) is invoked at most
 * once and is skipped entirely if no child is a bare-name reference.
 *
 * Failure to resolve any child throws a `RecipeResolutionError` naming the
 * failing key. Children are resolved sequentially in declaration order.
 */
export async function resolveRecipe(
  recipeBundle: ComponentBundle,
  opts: ResolveRecipeOpts,
): Promise<ResolvedRecipe> {
  if (recipeBundle.manifest.type !== 'recipe') {
    throw new Error(
      `resolveRecipe called on a ${recipeBundle.manifest.type} bundle (${recipeBundle.manifest.name})`,
    );
  }

  const composes = recipeBundle.manifest.composes;
  if (!composes || Object.keys(composes).length === 0) {
    return { recipeBundle, children: new Map() };
  }

  const needsDiscovery = Object.values(composes).some((c) => c.kind === 'name');
  let discovered: TemplateEntry[] | null = null;
  if (needsDiscovery) {
    const result = await discoverTemplates(opts.config, { cacheDir: opts.cacheDir });
    discovered = result.templates;
    if (opts.warnings) opts.warnings.push(...result.warnings);
  }

  const children = new Map<string, ChildResolution>();
  for (const [key, ref] of Object.entries(composes)) {
    let bundle: ComponentBundle;
    try {
      bundle = await loadChild(ref, recipeBundle, discovered, opts);
    } catch (err) {
      const cause = err instanceof Error ? err : undefined;
      const detail = err instanceof Error ? err.message : String(err);
      throw new RecipeResolutionError(
        `failed to resolve child "${key}" (${describeRef(ref)}): ${detail}`,
        key,
        cause,
      );
    }
    children.set(key, { key, ref, bundle });
  }

  return { recipeBundle, children };
}

async function loadChild(
  ref: ChildRef,
  recipeBundle: ComponentBundle,
  discovered: TemplateEntry[] | null,
  opts: ResolveRecipeOpts,
): Promise<ComponentBundle> {
  if (ref.kind === 'file') {
    const baseDir = opts.cwd ?? recipeBundle.rootPath;
    const resolvedPath = isAbsolute(ref.path) ? ref.path : resolvePath(baseDir, ref.path);
    return loadFromPath(resolvedPath);
  }
  if (ref.kind === 'git') {
    const result = await resolveGitSource(
      { url: ref.url, ref: ref.ref },
      { cacheDir: opts.cacheDir },
    );
    return loadFromPath(result.localPath);
  }
  // ref.kind === 'name'
  if (!discovered) {
    throw new Error('discovered templates not loaded — internal resolver invariant violated');
  }
  const match = discovered.find((t) => t.name === ref.name);
  if (!match) {
    throw new Error(
      `no template named "${ref.name}" found in configured source roots (version spec "${ref.versionSpec}" — version matching is M5.x)`,
    );
  }
  return loadFromPath(match.rootPath);
}

function describeRef(ref: ChildRef): string {
  if (ref.kind === 'file') return `file:${ref.path}`;
  if (ref.kind === 'git') return ref.ref ? `git+${ref.url}@${ref.ref}` : `git+${ref.url}`;
  return `${ref.name}@${ref.versionSpec}`;
}
