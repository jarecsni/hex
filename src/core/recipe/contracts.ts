import type { Requirement } from '../manifest/types.js';
import type { ChildResolution, ResolvedRecipe } from './resolve.js';

/**
 * Raised when a resolved recipe fails contract validation.
 *
 * `kind` distinguishes the two failure modes called out in idea.md §2:
 *   - `wiring` — a `consumes` entry has no provider among peers. Fix is to
 *     add or rewire a sibling that provides the symbol.
 *   - `composition` — a `requires` entry has no peer satisfying it. Fix is
 *     to add the missing peer to the recipe.
 */
export class RecipeContractError extends Error {
  constructor(
    message: string,
    public readonly kind: 'wiring' | 'composition',
    public readonly recipe: string,
    public readonly child: string,
  ) {
    super(message);
    this.name = 'RecipeContractError';
  }
}

/**
 * Walk a resolved recipe tree and validate component contracts at every
 * recipe level. Throws `RecipeContractError` on the first violation.
 *
 * Contracts are scoped to one recipe level — peers means "siblings under
 * the same `composes` block". Sub-recipes are validated recursively but
 * their children's contracts are not visible at the parent level.
 */
export function validateContracts(resolved: ResolvedRecipe): void {
  validateOneLevel(resolved);
  for (const child of resolved.children.values()) {
    if (child.resolved) validateContracts(child.resolved);
  }
}

function validateOneLevel(resolved: ResolvedRecipe): void {
  const recipeName = resolved.recipeBundle.manifest.name;
  const peers = [...resolved.children.values()];
  const providesIndex = buildProvidesIndex(peers);

  for (const child of peers) {
    const m = child.bundle.manifest;
    if (m.type !== 'component') continue;

    if (m.consumes) {
      for (const symbol of m.consumes) {
        if (!providesIndex.has(symbol)) {
          throw new RecipeContractError(
            `recipe "${recipeName}": child "${child.key}" (${m.name}) consumes "${symbol}" but no peer provides it`,
            'wiring',
            recipeName,
            child.key,
          );
        }
      }
    }

    if (m.requires) {
      for (const req of m.requires) {
        const fail = checkRequirement(req, child, peers);
        if (fail) {
          throw new RecipeContractError(
            `recipe "${recipeName}": child "${child.key}" (${m.name}) requires ${describeRequirement(req)} but ${fail}`,
            'composition',
            recipeName,
            child.key,
          );
        }
      }
    }
  }
}

function buildProvidesIndex(peers: ChildResolution[]): Map<string, Set<string>> {
  // symbol → set of child keys providing it. Set rather than count so we can
  // surface "who provides what" later if we want richer errors.
  const index = new Map<string, Set<string>>();
  for (const peer of peers) {
    const m = peer.bundle.manifest;
    if (m.type !== 'component' || !m.provides) continue;
    for (const symbol of providesSymbols(m.provides)) {
      let set = index.get(symbol);
      if (!set) {
        set = new Set();
        index.set(symbol, set);
      }
      set.add(peer.key);
    }
  }
  return index;
}

/** Iterable of symbol names regardless of whether `provides` is array or map form. */
export function providesSymbols(p: string[] | Record<string, string>): string[] {
  return Array.isArray(p) ? p : Object.keys(p);
}

function checkRequirement(
  req: Requirement,
  self: ChildResolution,
  peers: ChildResolution[],
): string | null {
  if ('kind' in req) {
    // kind: only component peers carry `kind:`. A peer is anyone except self.
    const match = peers.find(
      (p) =>
        p.key !== self.key &&
        p.bundle.manifest.type === 'component' &&
        p.bundle.manifest.kind === req.kind,
    );
    return match ? null : `no peer with kind "${req.kind}" is present`;
  }
  // name+version
  const candidates = peers.filter((p) => p.key !== self.key && p.bundle.manifest.name === req.name);
  if (candidates.length === 0) return `no peer named "${req.name}" is present`;
  const versionMatch = candidates.find((p) =>
    versionSatisfies(p.bundle.manifest.version, req.version),
  );
  return versionMatch
    ? null
    : `peer "${req.name}" present at version "${candidates[0]?.bundle.manifest.version}" does not satisfy "${req.version}"`;
}

function describeRequirement(req: Requirement): string {
  return 'kind' in req ? `peer of kind "${req.kind}"` : `peer "${req.name}@${req.version}"`;
}

/**
 * Minimal semver-spec matcher covering the shapes accepted by
 * VERSION_SPEC_RE: `*`, bare/`=` exact, `^`, `~`, `>=/<=/>/<`. Prerelease
 * and build metadata are stripped before comparison — fine for current
 * needs, and consistent with how the schema accepts them syntactically
 * without acting on them.
 */
export function versionSatisfies(version: string, spec: string): boolean {
  if (spec === '*') return true;

  const m = /^(\^|~|>=|<=|>|<|=)?(\d+)\.(\d+)\.(\d+)/.exec(spec);
  if (!m) return false;
  const op = m[1] ?? '=';
  const sMaj = Number(m[2]);
  const sMin = Number(m[3]);
  const sPat = Number(m[4]);

  const v = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!v) return false;
  const vMaj = Number(v[1]);
  const vMin = Number(v[2]);
  const vPat = Number(v[3]);

  const cmp = compareTriplet([vMaj, vMin, vPat], [sMaj, sMin, sPat]);
  switch (op) {
    case '=':
      return cmp === 0;
    case '>=':
      return cmp >= 0;
    case '<=':
      return cmp <= 0;
    case '>':
      return cmp > 0;
    case '<':
      return cmp < 0;
    case '^':
      // Same major; version must be ≥ the spec.
      return vMaj === sMaj && cmp >= 0;
    case '~':
      // Same major.minor; version must be ≥ the spec.
      return vMaj === sMaj && vMin === sMin && cmp >= 0;
    default:
      return false;
  }
}

function compareTriplet(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    const ai = a[i] as number;
    const bi = b[i] as number;
    if (ai !== bi) return ai < bi ? -1 : 1;
  }
  return 0;
}
