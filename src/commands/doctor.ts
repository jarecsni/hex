import type { Command } from 'commander';
import { brand } from '../brand/colors.js';
import { splash } from '../brand/splash.js';
import {
  type LoadedChecklist,
  countByStatus,
  readChecklistUpward,
} from '../core/checklist/index.js';
import {
  type LoadedLockfile,
  type LockChild,
  type LockfileIntegrity,
  checkLockfileIntegrity,
  readLockfileUpward,
} from '../core/lockfile/index.js';

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('inspect terminal capabilities and runtime info')
    .action(async () => {
      const lines = [
        splash(),
        '',
        row('Node', process.version),
        row('Platform', `${process.platform} ${process.arch}`),
        row('Terminal', process.env.TERM_PROGRAM ?? process.env.TERM ?? 'unknown'),
      ];

      const loaded = await readChecklistUpward(process.cwd()).catch(() => null);
      const setupSection = formatSetupSection(loaded);
      if (setupSection) lines.push('', setupSection);

      const lockSection = await lockfileSection(process.cwd());
      if (lockSection) lines.push('', lockSection);

      console.log(lines.join('\n'));
    });
}

function row(label: string, value: string): string {
  return `  ${brand.dim(label.padEnd(16))}  ${value}`;
}

/**
 * Render an "Outstanding setup tasks" block for `hex doctor`. Returns null
 * when there's no checklist nearby or every task is already done — doctor
 * stays silent in those cases. Pure: no I/O, no stdout.
 */
export function formatSetupSection(loaded: LoadedChecklist | null): string | null {
  if (!loaded) return null;
  const counts = countByStatus(loaded.checklist);
  if (counts.pending === 0) return null;

  const header = brand.bold(
    `Outstanding setup tasks  ${brand.dim(`(${counts.pending} pending, ${counts.done} done)`)}`,
  );
  const rows = loaded.checklist.tasks
    .filter((t) => t.status === 'pending')
    .map((t) => `  ${brand.dim('[ ]')}  ${t.id}  ${brand.dim('—')}  ${t.title}`);
  const footer = brand.dim(`  run "hex setup" to walk through them`);

  return [header, ...rows, footer].join('\n');
}

/**
 * Load the nearest lockfile, run its integrity check, and format the
 * "Lockfile" block — or surface a one-line warning if the file is
 * present but unreadable (malformed, or written by a newer Hex).
 *
 * Absent lockfile → null (doctor stays silent), same as the setup
 * section. This is the only function here that touches the filesystem.
 */
async function lockfileSection(cwd: string): Promise<string | null> {
  let loaded: LoadedLockfile | null;
  try {
    loaded = await readLockfileUpward(cwd);
  } catch (err) {
    return `${brand.bold('Lockfile')}  ${brand.warn('⚠')}  ${
      err instanceof Error ? err.message : String(err)
    }`;
  }
  if (!loaded) return null;

  const integrity = await checkLockfileIntegrity(loaded.rootDir, loaded.lockfile).catch(() => null);
  return formatLockfileSection(loaded, integrity);
}

/**
 * Render the "Lockfile" block — recipe/component identity, the composed
 * children tree with versions, and the integrity status. Returns null
 * for an absent lockfile. Pure: no I/O, no stdout.
 */
export function formatLockfileSection(
  loaded: LoadedLockfile | null,
  integrity: LockfileIntegrity | null,
): string | null {
  if (!loaded) return null;
  const { root, children } = loaded.lockfile;

  const header = brand.bold(
    `Lockfile  ${brand.dim(`(${root.type} ${root.name}@${root.version})`)}`,
  );
  const childRows: string[] = [];
  appendChildRows(children, 1, childRows);

  return [header, ...childRows, integrityLine(integrity)].join('\n');
}

/** Append a row per child, recursing into nested recipes with deeper indent. */
function appendChildRows(children: LockChild[] | undefined, depth: number, out: string[]): void {
  for (const c of children ?? []) {
    const indent = '  '.repeat(depth);
    const stub = c.stub ? brand.dim(' (stub)') : '';
    out.push(`${indent}${c.key}  ${brand.dim('—')}  ${c.name}@${c.version}${stub}`);
    appendChildRows(c.children, depth + 1, out);
  }
}

/** The single integrity-status line: a clean ✓ or an "N files diverged" ⚠. */
function integrityLine(integrity: LockfileIntegrity | null): string {
  if (!integrity) return `  ${brand.dim('integrity: not checked')}`;
  if (integrity.ok) return `  ${brand.done('✓')}  integrity clean`;

  const total = integrity.modified.length + integrity.missing.length + integrity.added.length;
  const breakdown = `${integrity.modified.length} modified, ${integrity.missing.length} missing, ${integrity.added.length} added`;
  return `  ${brand.warn('⚠')}  ${total} file${total === 1 ? '' : 's'} diverged from the lockfile  ${brand.dim(`(${breakdown})`)}`;
}
