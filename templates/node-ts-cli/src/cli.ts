#!/usr/bin/env node
import { Command } from 'commander';
{% if include_self_update %}
import { maybeUpdate } from './update.js';
{% endif %}

process.on('exit', () => {
  if (process.stdout.isTTY) process.stdout.write('\n');
});

async function main(): Promise<void> {
{% if include_self_update %}
  await maybeUpdate();

{% endif %}
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

  await program.parseAsync(process.argv);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
