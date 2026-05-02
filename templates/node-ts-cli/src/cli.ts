#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('{{ project_name }}')
  .description('{{ description }}')
  .version('0.1.0', '-v, --version', 'print version and exit');
{% if include_examples %}

program
  .command('hello [name]')
  .description('say hello')
  .action((name?: string) => {
    console.log(`Hello, ${name ?? 'world'}!`);
  });
{% endif %}

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
