#!/usr/bin/env node
import { Command } from 'commander';
import { brand } from './brand/colors.js';
import { splash } from './brand/splash.js';
import { registerDoctor } from './commands/doctor.js';

const VERSION = '0.1.0';

const program = new Command();

program
  .name('hex')
  .description('Scaffolding tool that assembles applications from templated components.')
  .version(VERSION, '-v, --version', 'print version and exit')
  .addHelpText('beforeAll', `${splash()}\n`)
  .addHelpText('afterAll', `\n  ${brand.dim(`hex ${VERSION} — honeycomb scaffolding`)}\n`);

registerDoctor(program);

program.parseAsync(process.argv).catch((err) => {
  console.error(brand.error(`error: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
