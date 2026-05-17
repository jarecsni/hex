import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import type { z } from 'zod';
import { VERSION } from '../../brand/splash.js';
import type { ChildRef } from '../manifest/types.js';
import type { Answers } from '../prompts/types.js';
import type { ResolvedRecipe } from '../recipe/resolve.js';
import type { ComponentBundle } from '../sources/file-source.js';
import {
  LOCKFILE_SCHEMA_VERSION,
  type lockArtifactSchema,
  type lockChildSchema,
  type lockFileEntrySchema,
  lockfileSchema,
  type sourceSpecSchema,
} from './schema.js';

/**
 * The lockfile module (M10.1, M10.2) — `.hex/lockfile.yaml`, the file
 * that makes a generated app self-describing.
 *
 * In an *authored* component, `.hex/manifest.yaml` describes *how to
 * scaffold*. In a *generated* app, `.hex/lockfile.yaml` describes *what
 * was scaffolded* — same folder, mirrored roles (`idea.md`, "Component
 * repo layout"). M10.1 defined the schema; M10.2 (here) builds and
 * writes the file at the end of `hex new`; reading it back and verifying
 * integrity is M10.3.
 */

export { LOCKFILE_SCHEMA_VERSION, SHA256_RE, lockfileSchema } from './schema.js';

/** How to re-fetch an artifact during an upgrade. */
export type SourceSpec = z.infer<typeof sourceSpecSchema>;

/** Identity of one scaffolding artifact — the recipe root or a child. */
export type LockArtifact = z.infer<typeof lockArtifactSchema>;

/** A recipe's composed child. */
export type LockChild = z.infer<typeof lockChildSchema>;

/** One rendered file and the sha256 of its bytes at generation time. */
export type LockFileEntry = z.infer<typeof lockFileEntrySchema>;

/** The whole `.hex/lockfile.yaml` document. */
export type Lockfile = z.infer<typeof lockfileSchema>;

/** Errors raised reading, writing, or validating a lockfile. */
export class LockfileError extends Error {
  constructor(
    message: string,
    public readonly path?: string,
  ) {
    super(path ? `${path}: ${message}` : message);
    this.name = 'LockfileError';
  }
}

/** `.hex/` — the same folder name authored components use for their manifest. */
export const LOCKFILE_DIRNAME = '.hex';
export const LOCKFILE_FILENAME = 'lockfile.yaml';
export const LOCKFILE_REL_PATH = `${LOCKFILE_DIRNAME}/${LOCKFILE_FILENAME}`;

/**
 * Top-level directories never folded into the file-hash table. `.hex/`
 * holds Hex's own metadata (this lockfile, the M4 checklist) — hashing
 * it would make the table describe itself. `.git/` and `node_modules/`
 * are not part of the rendered artifact either.
 */
const SKIP_DIRS = new Set([LOCKFILE_DIRNAME, '.git', 'node_modules']);

/** Everything `buildLockfile` needs to describe a completed render. */
export type BuildLockfileInput = {
  /** The root bundle — the recipe, or a standalone component. */
  bundle: ComponentBundle;
  /** The resolved recipe tree; absent for a standalone component. */
  resolved?: ResolvedRecipe;
  /** The full answers tree the render consumed. */
  answers: Answers;
  /** The generated app's root directory — walked to fill `files`. */
  outputDir: string;
  /** Override the render timestamp (test injection). */
  now?: Date;
};

/**
 * Assemble a `Lockfile` describing a finished render: the root artifact,
 * its immediate composed children, the answers tree, and a per-file
 * sha256 table hashed from the rendered tree on disk — post-hooks,
 * post-render, so hook renames/deletes are reflected faithfully.
 *
 * Only the recipe's *immediate* children are recorded; a nested recipe's
 * own descendants are not yet captured (tracked for the M11 upgrade
 * engine, which needs the full tree for pristine reconstruction).
 */
export async function buildLockfile(input: BuildLockfileInput): Promise<Lockfile> {
  const { bundle, resolved, answers, outputDir } = input;

  const children: LockChild[] = [];
  if (resolved) {
    for (const child of resolved.children.values()) {
      children.push({
        ...artifactOf(child.bundle, child.ref),
        key: child.key,
        stub: child.ref.stub === true,
      });
    }
  }

  return {
    schema_version: LOCKFILE_SCHEMA_VERSION,
    hex_version: VERSION,
    generated_at: (input.now ?? new Date()).toISOString(),
    root: artifactOf(bundle),
    children,
    answers,
    files: await hashRenderedTree(outputDir),
  };
}

/**
 * Write a lockfile to `<outputDir>/.hex/lockfile.yaml`, creating `.hex/`
 * if needed. Validates against the schema first, so a buggy caller can
 * never persist a malformed file.
 */
export async function writeLockfile(outputDir: string, lockfile: Lockfile): Promise<string> {
  const parsed = lockfileSchema.safeParse(lockfile);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('\n');
    throw new LockfileError(`refusing to write malformed lockfile:\n${issues}`);
  }

  const dir = join(outputDir, LOCKFILE_DIRNAME);
  await mkdir(dir, { recursive: true });
  const path = join(dir, LOCKFILE_FILENAME);
  await writeFile(path, stringifyYaml(parsed.data), 'utf8');
  return path;
}

/** Identity + source spec of one artifact (the root, or a child via `ref`). */
function artifactOf(bundle: ComponentBundle, ref?: ChildRef): LockArtifact {
  return {
    name: bundle.manifest.name,
    version: bundle.manifest.version,
    type: bundle.manifest.type,
    source: sourceSpecFor(bundle, ref),
  };
}

/**
 * Derive the source spec — *how to re-fetch this artifact*.
 *
 * A `git:` child reference carries the upstream coordinate verbatim, so
 * it is recorded exactly. Everything else — `file:` references, bare
 * `name`/`slot` references resolved through discovery, and the root
 * bundle — is recorded as the resolved local path it was loaded from.
 */
function sourceSpecFor(bundle: ComponentBundle, ref?: ChildRef): SourceSpec {
  if (ref?.kind === 'git') {
    return ref.ref ? { kind: 'git', url: ref.url, ref: ref.ref } : { kind: 'git', url: ref.url };
  }
  return { kind: 'file', path: bundle.rootPath };
}

/** Walk the rendered tree and hash every file, sorted by POSIX path. */
async function hashRenderedTree(outputDir: string): Promise<LockFileEntry[]> {
  const entries: LockFileEntry[] = [];
  await walk(outputDir, outputDir, entries);
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return entries;
}

async function walk(dir: string, root: string, out: LockFileEntry[]): Promise<void> {
  for (const dirent of await readdir(dir, { withFileTypes: true })) {
    if (dirent.isDirectory()) {
      if (SKIP_DIRS.has(dirent.name)) continue;
      await walk(join(dir, dirent.name), root, out);
    } else if (dirent.isFile()) {
      const abs = join(dir, dirent.name);
      out.push({
        path: relative(root, abs).split(sep).join('/'),
        sha256: createHash('sha256')
          .update(await readFile(abs))
          .digest('hex'),
      });
    }
    // symlinks / special files are intentionally skipped
  }
}
