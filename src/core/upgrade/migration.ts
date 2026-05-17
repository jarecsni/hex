import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { ProjectFs } from '../hooks/project-fs.js';
import type { HookLog } from '../hooks/runner.js';
import { createSandbox } from '../hooks/sandbox.js';

/**
 * Migration script vocabulary (M11.3) — `idea.md` §1, "delete /
 * delete_if_unmodified / rename / replace".
 *
 * A version bump can ship a migration at
 * `.hex/migrations/<from>-to-<to>.{yaml,js}`. The declarative YAML form
 * is a small ordered op list; the `.js` form is an escape hatch run
 * inside the M7 sandbox. Migrations transform a *pristine* tree — never
 * the user's working copy — so the upgrade engine's diff stays
 * deterministic.
 *
 * The one exception is the **user-tree escape hatch** (M11.6): a
 * migration may declare itself a user-tree migration, which routes it
 * against the user's working copy instead. A declarative migration opts
 * in with `user_tree: true`; a JS migration opts in via the `.user.js`
 * extension (a bare `.js` file carries no schema to hang a flag on).
 * The upgrade engine — not this module — decides which tree a migration
 * runs against; this module just reports `userTree` from discovery.
 *
 * The chain walker (M11.2) calls one migration per hop; this module
 * discovers, parses, and runs it. How the result feeds the 3-way merge
 * is M11.4 — `applyMigration` reports the structural changes it made
 * (`renames`, `deletes`) so a rename-aware diff can be built later.
 */

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

const relPath = z.string().min(1);
const fromTo = z.object({ from: relPath, to: relPath }).strict();

/** One declarative migration op — exactly one of the four verbs. */
const migrationOpSchema = z.union([
  z.object({ delete: relPath }).strict(),
  z.object({ delete_if_unmodified: relPath }).strict(),
  z.object({ rename: fromTo }).strict(),
  z.object({ replace: fromTo }).strict(),
]);

/**
 * A declarative migration document: an ordered list of ops, plus the
 * optional `user_tree` escape-hatch flag (M11.6). When `user_tree` is
 * true the engine runs the ops against the user's working copy.
 */
export const migrationDocSchema = z
  .object({
    user_tree: z.boolean().optional(),
    steps: z.array(migrationOpSchema).min(1),
  })
  .strict();

export type MigrationOp = z.infer<typeof migrationOpSchema>;
export type MigrationDoc = z.infer<typeof migrationDocSchema>;

/**
 * Where a migration for a given hop was found, in what form, and whether
 * it is a user-tree migration. `doc` is carried on declarative results
 * so a caller need not re-read and re-parse the file.
 */
export type DiscoveredMigration =
  | { kind: 'declarative'; path: string; userTree: boolean; doc: MigrationDoc }
  | { kind: 'js'; path: string; userTree: boolean }
  | null;

/** Structural changes a migration made — consumed by the M11.4 merge. */
export type MigrationResult = {
  /** False when no migration file exists for the hop (a clean no-op). */
  applied: boolean;
  /** `rename`/`replace` ops, in order. `replace` flags a content change. */
  renames: Array<{ from: string; to: string; kind: 'rename' | 'replace' }>;
  /** Paths removed by `delete` / `delete_if_unmodified`. */
  deletes: string[];
};

export type MigrationContext = {
  /** The tree the migration transforms — pristine, or the user's copy. */
  treeDir: string;
  /**
   * Whether the user has edited `relPath` since generation. Consulted by
   * `delete_if_unmodified`; defaults to "nothing modified" when absent.
   */
  isUserModified?: (relPath: string) => boolean;
  /** Log sink for JS migrations. Defaults to console. */
  log?: HookLog;
};

/** The `<from>-to-<to>` stem a migration file for this hop must use. */
function migrationStem(from: string, to: string): string {
  return `${from}-to-${to}`;
}

/**
 * Find the migration file for the `from`→`to` hop in `migrationsDir`.
 * Returns null when none exists — a hop without a migration is allowed
 * (the version bump simply had no structural change). A declarative and
 * a JS file for the same hop is an authoring error, as is shipping both
 * the pristine (`.js`) and user-tree (`.user.js`) JS forms.
 */
export async function discoverMigration(
  migrationsDir: string,
  from: string,
  to: string,
): Promise<DiscoveredMigration> {
  const stem = migrationStem(from, to);
  const declarative = await firstExisting(migrationsDir, [`${stem}.yaml`, `${stem}.yml`]);
  const pristineJs = await firstExisting(migrationsDir, [`${stem}.js`]);
  const userJs = await firstExisting(migrationsDir, [`${stem}.user.js`]);

  if (declarative && (pristineJs || userJs)) {
    throw new MigrationError(
      `hop ${from}→${to} has both a declarative and a JS migration — keep one`,
    );
  }
  if (pristineJs && userJs) {
    throw new MigrationError(
      `hop ${from}→${to} has both a \`.js\` and a \`.user.js\` migration — keep one`,
    );
  }

  if (declarative) {
    const doc = await parseDeclarative(declarative);
    return { kind: 'declarative', path: declarative, userTree: doc.user_tree ?? false, doc };
  }
  if (userJs) return { kind: 'js', path: userJs, userTree: true };
  if (pristineJs) return { kind: 'js', path: pristineJs, userTree: false };
  return null;
}

/**
 * Discover and run the migration for one upgrade hop against `treeDir`.
 * A missing migration is a clean no-op (`applied: false`).
 *
 * Note: the *caller* picks `ctx.treeDir` — the pristine tree for a
 * normal migration, the user's working copy for a user-tree one. This
 * function does not route; it runs the discovered migration as told.
 */
export async function applyMigration(
  migrationsDir: string,
  from: string,
  to: string,
  ctx: MigrationContext,
): Promise<MigrationResult> {
  const found = await discoverMigration(migrationsDir, from, to);
  if (!found) return { applied: false, renames: [], deletes: [] };
  return runDiscoveredMigration(found, from, to, ctx);
}

/** Run an already-discovered migration against `ctx.treeDir`. */
export async function runDiscoveredMigration(
  found: NonNullable<DiscoveredMigration>,
  from: string,
  to: string,
  ctx: MigrationContext,
): Promise<MigrationResult> {
  if (found.kind === 'js') {
    await runJsMigration(found.path, from, to, ctx);
    return { applied: true, renames: [], deletes: [] };
  }
  return runDeclarativeMigration(found.doc, from, to, ctx);
}

/** Read, parse, and schema-check a declarative migration document. */
async function parseDeclarative(path: string): Promise<MigrationDoc> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    throw new MigrationError(`cannot read migration ${path}: ${errMsg(err)}`);
  }

  let data: unknown;
  try {
    data = parseYaml(raw);
  } catch (err) {
    throw new MigrationError(`migration ${path}: invalid YAML: ${errMsg(err)}`);
  }

  const parsed = migrationDocSchema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('\n');
    throw new MigrationError(`migration ${path}: schema validation failed:\n${issues}`);
  }
  return parsed.data;
}

/** Execute a parsed declarative migration document against `ctx.treeDir`. */
async function runDeclarativeMigration(
  doc: MigrationDoc,
  from: string,
  to: string,
  ctx: MigrationContext,
): Promise<MigrationResult> {
  const isModified = ctx.isUserModified ?? (() => false);
  const result: MigrationResult = { applied: true, renames: [], deletes: [] };

  for (const op of doc.steps) {
    if ('delete' in op) {
      await deletePath(ctx.treeDir, op.delete, from, to);
      result.deletes.push(op.delete);
    } else if ('delete_if_unmodified' in op) {
      const target = op.delete_if_unmodified;
      if (!isModified(target)) {
        await deletePath(ctx.treeDir, target, from, to);
        result.deletes.push(target);
      }
    } else if ('rename' in op) {
      await movePath(ctx.treeDir, op.rename.from, op.rename.to, from, to);
      result.renames.push({ ...op.rename, kind: 'rename' });
    } else {
      await movePath(ctx.treeDir, op.replace.from, op.replace.to, from, to);
      result.renames.push({ ...op.replace, kind: 'replace' });
    }
  }
  return result;
}

/** Remove `rel` from the tree; a missing target is an authoring error. */
async function deletePath(treeDir: string, rel: string, from: string, to: string): Promise<void> {
  const abs = join(treeDir, rel);
  if (!(await pathExists(abs))) {
    throw new MigrationError(`migration ${from}→${to}: delete target not found: ${rel}`);
  }
  await rm(abs, { recursive: true, force: true });
}

/** Move `from`→`to` within the tree. */
async function movePath(
  treeDir: string,
  fromRel: string,
  toRel: string,
  from: string,
  to: string,
): Promise<void> {
  const fromAbs = join(treeDir, fromRel);
  const toAbs = join(treeDir, toRel);
  if (!(await pathExists(fromAbs))) {
    throw new MigrationError(`migration ${from}→${to}: rename source not found: ${fromRel}`);
  }
  if (await pathExists(toAbs)) {
    throw new MigrationError(`migration ${from}→${to}: rename target already exists: ${toRel}`);
  }
  await mkdir(dirname(toAbs), { recursive: true });
  await rename(fromAbs, toAbs);
}

/**
 * Run a `.js` migration inside the M7 sandbox. The script gets the same
 * `project` filesystem facade JS hooks use — scoped to `ctx.treeDir` —
 * plus a `log` sink and a `migration` global naming the hop.
 */
async function runJsMigration(
  path: string,
  from: string,
  to: string,
  ctx: MigrationContext,
): Promise<void> {
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch (err) {
    throw new MigrationError(`cannot read migration ${path}: ${errMsg(err)}`);
  }

  const log = ctx.log ?? consoleLog;
  const sandbox = await createSandbox();
  try {
    sandbox.installProjectFs(new ProjectFs(ctx.treeDir));
    sandbox.installGlobal('migration', { from, to });
    sandbox.installHostObject('log', {
      info: (msg) => {
        log.info(String(msg ?? ''));
        return undefined;
      },
      warn: (msg) => {
        log.warn(String(msg ?? ''));
        return undefined;
      },
      error: (msg) => {
        log.error(String(msg ?? ''));
        return undefined;
      },
    });
    try {
      sandbox.runScript(source, `${migrationStem(from, to)}.js`);
    } catch (err) {
      throw new MigrationError(`migration ${from}→${to} (${path}) failed: ${errMsg(err)}`);
    }
  } finally {
    sandbox.dispose();
  }
}

const consoleLog: HookLog = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
};

async function firstExisting(dir: string, names: string[]): Promise<string | null> {
  for (const name of names) {
    const candidate = join(dir, name);
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
