#!/usr/bin/env node
import { Command } from 'commander';
import { brand } from './brand/colors.js';
import { VERSION, splash } from './brand/splash.js';
import { registerDoctor } from './commands/doctor.js';
import { registerList } from './commands/list.js';
import { registerNew } from './commands/new.js';
import { maybeUpdate } from './update.js';

process.on('exit', () => {
  if (process.stdout.isTTY) process.stdout.write('\n');
});

async function main() {
  await maybeUpdate();

  const program = new Command();

  program
    .name('hex')
    .version(VERSION, '-v, --version', 'print version and exit')
    .addHelpText('beforeAll', `${splash()}\n`);

  registerDoctor(program);
  registerList(program);
  registerNew(program);

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(brand.error(`error: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
