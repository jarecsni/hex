import * as clack from '@clack/prompts';
import type { Command } from 'commander';
import { brand } from '../brand/colors.js';
import { splash } from '../brand/splash.js';
import { createClackPrompter } from '../core/prompts/clack-prompter.js';
import { runPrompts } from '../core/prompts/engine.js';
import { renderBundle } from '../core/render/engine.js';
import { loadFromPath } from '../core/sources/file-source.js';

export function registerNew(program: Command): void {
  program
    .command('new')
    .description('render a template into a new directory')
    .argument('<template>', 'path to a template directory containing .hex/manifest.yaml')
    .argument('<output>', 'path where the generated project will be written')
    .option('-f, --force', 'overwrite a non-empty output directory', false)
    .action(async (templatePath: string, outputDir: string, opts: { force: boolean }) => {
      process.stdout.write(`${splash()}\n`);
      clack.intro(brand.honeyBold(' hex new '));

      const bundle = await loadFromPath(templatePath);
      clack.log.info(
        `Template: ${brand.bold(bundle.manifest.name)} ${brand.dim(`@${bundle.manifest.version}`)}`,
      );

      const answers = await runPrompts(bundle.manifest.prompts ?? [], createClackPrompter());

      const spinner = clack.spinner();
      spinner.start('rendering');
      const result = await renderBundle(bundle, outputDir, answers, { force: opts.force });
      spinner.stop(`rendered ${result.written.length} files`);

      if (result.renamed.length > 0 || result.deleted.length > 0) {
        clack.log.info(`hooks: ${result.renamed.length} renamed, ${result.deleted.length} deleted`);
      }

      clack.outro(brand.done(`done — ${outputDir}`));
    });
}
