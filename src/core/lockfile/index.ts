import type { z } from 'zod';
import type {
  lockArtifactSchema,
  lockChildSchema,
  lockFileEntrySchema,
  lockfileSchema,
  sourceSpecSchema,
} from './schema.js';

/**
 * The lockfile module (M10.1) — `.hex/lockfile.yaml`, the file that
 * makes a generated app self-describing.
 *
 * In an *authored* component, `.hex/manifest.yaml` describes *how to
 * scaffold*. In a *generated* app, `.hex/lockfile.yaml` describes *what
 * was scaffolded* — same folder, mirrored roles (`idea.md`, "Component
 * repo layout"). M10.1 defines the schema; M10.2 writes it; M10.3 reads
 * it back and verifies integrity.
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
