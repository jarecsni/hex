import type { Command } from 'commander';
import { brand } from '../brand/colors.js';
import { splash } from '../brand/splash.js';

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('inspect terminal capabilities and runtime info')
    .action(() => {
      const lines = [
        splash(),
        '',
        row('Node', process.version),
        row('Platform', `${process.platform} ${process.arch}`),
        row('Terminal', process.env.TERM_PROGRAM ?? process.env.TERM ?? 'unknown'),
      ];
      console.log(lines.join('\n'));
    });
}

function row(label: string, value: string): string {
  return `  ${brand.dim(label.padEnd(16))}  ${value}`;
}
