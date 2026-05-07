import { existsSync } from 'node:fs';
import { isAbsolute, sep } from 'node:path';
import * as clack from '@clack/prompts';
import type { Command } from 'commander';
import { brand } from '../brand/colors.js';
import { splash } from '../brand/splash.js';
import { checklistFromTasks, writeChecklist } from '../core/checklist/index.js';
import { loadConfig } from '../core/config/load.js';
import { type TemplateEntry, discoverTemplates } from '../core/discovery/index.js';
import { createClackPrompter } from '../core/prompts/clack-prompter.js';
import { runPrompts } from '../core/prompts/engine.js';
import { PromptCancelledError } from '../core/prompts/types.js';
import { renderBundle } from '../core/render/engine.js';
import { type ComponentBundle, loadFromPath } from '../core/sources/file-source.js';
import { printSetupOutro, runSetupSession } from './setup.js';

export class NewCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NewCommandError';
  }
}

export function registerNew(program: Command): void {
  program
    .command('new')
    .description('render a template into a new directory')
    .argument('[template]', 'template path or registered name (omit to pick interactively)')
    .argument('[output]', 'path where the generated project will be written')
    .option('-f, --force', 'overwrite a non-empty output directory', false)
    .option('--no-setup', 'skip the post-render interactive setup loop')
    .action(
      async (
        templateArg: string | undefined,
        outputArg: string | undefined,
        opts: { force: boolean; setup: boolean },
      ) => {
        process.stdout.write(`${splash()}\n`);
        clack.intro(brand.honeyBold(' hex new '));

        const bundle = await resolveTemplate(templateArg);
        clack.log.info(
          `Template: ${brand.bold(bundle.manifest.name)} ${brand.dim(`@${bundle.manifest.version}`)}`,
        );

        const outputDir = await resolveOutputDir(outputArg);

        const answers = await runPrompts(
          bundle.manifest.prompts ?? [],
          createClackPrompter(),
          {},
          bundle.manifest.sections,
        );

        const spinner = clack.spinner();
        spinner.start('rendering');
        const result = await renderBundle(bundle, outputDir, answers, { force: opts.force });
        spinner.stop(`rendered ${result.written.length} files`);

        if (result.renamed.length > 0 || result.deleted.length > 0) {
          clack.log.info(
            `hooks: ${result.renamed.length} renamed, ${result.deleted.length} deleted`,
          );
        }

        const tasks = bundle.manifest.setup?.tasks ?? [];
        if (tasks.length === 0) {
          clack.outro(brand.done(`done — ${outputDir}`));
          return;
        }

        // Write the initial checklist before doing anything else, so a hard
        // exit at this point still leaves the project in a recoverable state.
        const initial = checklistFromTasks(tasks);
        await writeChecklist(outputDir, initial);

        if (bundle.manifest.setup?.message) {
          clack.note(bundle.manifest.setup.message, 'Post-scaffold setup');
        }

        const interactive = process.stdout.isTTY && opts.setup;
        if (!interactive) {
          clack.outro(
            `${tasks.length} setup tasks pending — run ${brand.bold('hex setup')} from ${outputDir}`,
          );
          return;
        }

        const setupResult = await runSetupSession(
          { rootDir: outputDir, checklist: initial },
          createClackPrompter(),
        );
        printSetupOutro(setupResult);
      },
    );
}

function looksLikePath(arg: string): boolean {
  return (
    arg.startsWith('.') ||
    arg.startsWith('/') ||
    arg.startsWith('~') ||
    isAbsolute(arg) ||
    arg.includes(sep) ||
    arg.includes('/') ||
    existsSync(arg)
  );
}

async function resolveTemplate(arg: string | undefined): Promise<ComponentBundle> {
  if (arg && looksLikePath(arg)) {
    return loadFromPath(arg);
  }

  const config = await loadConfig();
  const { templates, warnings } = await discoverTemplates(config);

  for (const w of warnings) clack.log.warn(w);

  if (arg) {
    const match = templates.find((t) => t.name === arg);
    if (!match) {
      throw new NewCommandError(
        `no template named "${arg}" found in configured source roots — try "hex list" to see what's available, or pass a path.`,
      );
    }
    return loadFromPath(match.rootPath);
  }

  if (templates.length === 0) {
    throw new NewCommandError(
      'no templates available — configure source roots in ~/.hex/config.yaml or pass a path.',
    );
  }

  const picked = await clack.select({
    message: 'Pick a template',
    options: templates.map((t) => ({
      value: t.rootPath,
      label: `${t.name} ${brand.dim(`@${t.version}`)}`,
      hint: hintFor(t),
    })),
  });
  if (clack.isCancel(picked)) throw new PromptCancelledError();

  return loadFromPath(picked as string);
}

function hintFor(t: TemplateEntry): string {
  const parts: string[] = [];
  if (t.kind) parts.push(t.kind);
  parts.push(t.rootPath);
  return parts.join(' — ');
}

async function resolveOutputDir(arg: string | undefined): Promise<string> {
  if (arg) return arg;
  const result = await clack.text({
    message: 'Output directory',
    placeholder: './my-app',
    validate: (v) => (v && v.length > 0 ? undefined : 'output directory is required'),
  });
  if (clack.isCancel(result)) throw new PromptCancelledError();
  return result as string;
}
