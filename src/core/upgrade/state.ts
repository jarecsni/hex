import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

/**
 * Upgrade state file (M11.4) — `.hex/upgrade-state.yaml`.
 *
 * When `hex upgrade` stops on conflicts, it records what is in flight
 * here: the version range being upgraded and the files left with
 * conflict markers. `hex upgrade --continue` (M11.5) reads it back to
 * know what is pending; `--abort` clears it. The file exists only
 * *during* a paused upgrade — a clean upgrade never writes one, and a
 * completed or aborted one removes it.
 */

export class UpgradeStateError extends Error {
  constructor(
    message: string,
    public readonly path?: string,
  ) {
    super(path ? `${path}: ${message}` : message);
    this.name = 'UpgradeStateError';
  }
}

/** Format version of the upgrade-state file this build writes. */
export const UPGRADE_STATE_SCHEMA_VERSION = 1;

export const UPGRADE_STATE_DIRNAME = '.hex';
export const UPGRADE_STATE_FILENAME = 'upgrade-state.yaml';
export const UPGRADE_STATE_REL_PATH = `${UPGRADE_STATE_DIRNAME}/${UPGRADE_STATE_FILENAME}`;

export const upgradeStateSchema = z.object({
  /** Format version — see `UPGRADE_STATE_SCHEMA_VERSION`. */
  schema_version: z.number().int().positive(),
  /** The version the app was on when the upgrade started. */
  from: z.string().min(1),
  /** The target version of the in-flight upgrade. */
  to: z.string().min(1),
  /** Files left with conflict markers, awaiting user resolution. */
  conflicts: z.array(z.string()),
});

/** A paused upgrade's recorded state. */
export type UpgradeState = z.infer<typeof upgradeStateSchema>;

/**
 * Write `.hex/upgrade-state.yaml` into a generated app. Validates against
 * the schema first, so a buggy caller cannot persist a malformed file.
 */
export async function writeUpgradeState(rootDir: string, state: UpgradeState): Promise<string> {
  const parsed = upgradeStateSchema.safeParse(state);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('\n');
    throw new UpgradeStateError(`refusing to write malformed upgrade state:\n${issues}`);
  }
  const dir = join(rootDir, UPGRADE_STATE_DIRNAME);
  await mkdir(dir, { recursive: true });
  const path = join(dir, UPGRADE_STATE_FILENAME);
  await writeFile(path, stringifyYaml(parsed.data), 'utf8');
  return path;
}

/**
 * Read `.hex/upgrade-state.yaml` from a generated app. Returns null when
 * no upgrade is in flight (the common case); throws `UpgradeStateError`
 * when a file exists but is malformed.
 */
export async function readUpgradeState(rootDir: string): Promise<UpgradeState | null> {
  const path = join(rootDir, UPGRADE_STATE_DIRNAME, UPGRADE_STATE_FILENAME);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return null;
  }

  let data: unknown;
  try {
    data = parseYaml(raw);
  } catch (err) {
    throw new UpgradeStateError(
      `invalid YAML: ${err instanceof Error ? err.message : String(err)}`,
      path,
    );
  }

  const result = upgradeStateSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('\n');
    throw new UpgradeStateError(`schema validation failed:\n${issues}`, path);
  }
  return result.data;
}

/**
 * Remove `.hex/upgrade-state.yaml` — the upgrade completed or was
 * aborted. A no-op when no state file exists.
 */
export async function clearUpgradeState(rootDir: string): Promise<void> {
  await rm(join(rootDir, UPGRADE_STATE_DIRNAME, UPGRADE_STATE_FILENAME), { force: true });
}
