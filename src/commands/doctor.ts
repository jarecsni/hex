import type { Command } from 'commander';
import { brand } from '../brand/colors.js';
import { getGlyphs } from '../brand/glyphs.js';
import { splash } from '../brand/splash.js';
import { detectCapabilities } from '../util/tty.js';

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('inspect terminal capabilities and runtime info')
    .action(() => {
      const caps = detectCapabilities();
      const g = getGlyphs(caps.unicode);
      const tick = caps.color ? brand.done(g.filled) : g.filled;
      const cross = caps.color ? brand.error(g.error) : g.error;

      const lines = [
        '',
        splash(),
        '',
        `  ${brand.bold('hex 0.1.0')}  ${brand.dim('— honeycomb scaffolding')}`,
        '',
        row('Node', process.version),
        row('Platform', `${process.platform} ${process.arch}`),
        row('Terminal', process.env.TERM_PROGRAM ?? process.env.TERM ?? 'unknown'),
        row('TTY', caps.isTTY ? `${tick} yes` : `${cross} no`),
        row(
          'Unicode glyphs',
          caps.unicode
            ? `${tick} yes  (${g.empty} ${g.filled} ${g.error})`
            : `${cross} no  (using ${g.empty} / ${g.filled} / ${g.error})`,
        ),
        row('ANSI colours', caps.color ? `${tick} yes` : `${cross} no`),
        '',
      ];
      console.log(lines.join('\n'));
    });
}

function row(label: string, value: string): string {
  return `  ${brand.dim(label.padEnd(16))}  ${value}`;
}
