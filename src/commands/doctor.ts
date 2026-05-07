import type { Command } from 'commander';
import { brand } from '../brand/colors.js';
import { splash } from '../brand/splash.js';
import {
  type LoadedChecklist,
  countByStatus,
  readChecklistUpward,
} from '../core/checklist/index.js';

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
