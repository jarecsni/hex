#!/usr/bin/env node
import { Command } from 'commander';
import { brand } from './brand/colors.js';
import { VERSION, splash } from './brand/splash.js';
import { registerDoctor } from './commands/doctor.js';

process.on('exit', () => {
  if (process.stdout.isTTY) process.stdout.write('\n');
});

const program = new Command();

program
  .name('hex')
  .version(VERSION, '-v, --version', 'print version and exit')
  .addHelpText('beforeAll', `${splash()}\n`);

registerDoctor(program);

program.parseAsync(process.argv).catch((err) => {
  console.error(brand.error(`error: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
