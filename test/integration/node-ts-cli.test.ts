import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runPrompts } from '../../src/core/prompts/engine.js';
import type { Prompter } from '../../src/core/prompts/types.js';
import { renderBundle } from '../../src/core/render/engine.js';
import { loadFromPath } from '../../src/core/sources/file-source.js';

const TEMPLATE_PATH = resolve(__dirname, '..', '..', 'templates', 'node-ts-cli');

let work: string;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'hex-int-node-ts-cli-'));
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

function fixedPrompter(answers: {
  project_name: string;
  description: string;
  author: string;
  license: string;
  include_examples: boolean;
}): Prompter {
  return {
    async text(opts) {
      const map: Record<string, string> = {
        'Package name (e.g. my-cli)': answers.project_name,
        'Short description': answers.description,
        Author: answers.author,
      };
      const value = map[opts.message];
      if (value === undefined) throw new Error(`unexpected text prompt: ${opts.message}`);
      const validation = opts.validate?.(value);
      if (validation !== undefined) throw new Error(`validation failed: ${validation}`);
      return value;
    },
    async confirm(opts) {
      if (opts.message === 'Include an example "hello" command?') return answers.include_examples;
      throw new Error(`unexpected confirm prompt: ${opts.message}`);
    },
    async select(opts) {
      if (opts.message === 'License') return answers.license;
      throw new Error(`unexpected select prompt: ${opts.message}`);
    },
    async multiselect(opts) {
      throw new Error(`unexpected multiselect prompt: ${opts.message}`);
    },
    async password(opts) {
      throw new Error(`unexpected password prompt: ${opts.message}`);
    },
  };
}

describe('node-ts-cli template — end-to-end', () => {
  it('renders a complete project with examples included', async () => {
    const bundle = await loadFromPath(TEMPLATE_PATH);
    const answers = await runPrompts(
      bundle.manifest.prompts ?? [],
      fixedPrompter({
        project_name: 'my-cli',
        description: 'Demo CLI',
        author: 'Alice',
        license: 'MIT',
        include_examples: true,
      }),
    );

    const out = join(work, 'my-cli');
    const result = await renderBundle(bundle, out, answers);

    // Files we expect in the output
    expect(existsSync(join(out, 'package.json'))).toBe(true);
    expect(existsSync(join(out, 'tsconfig.json'))).toBe(true);
    expect(existsSync(join(out, 'biome.json'))).toBe(true);
    expect(existsSync(join(out, 'tsup.config.ts'))).toBe(true);
    expect(existsSync(join(out, 'src/cli.ts'))).toBe(true);
    expect(existsSync(join(out, 'src/examples/hello.ts'))).toBe(true);
    expect(existsSync(join(out, 'README.md'))).toBe(true);
    expect(existsSync(join(out, 'LICENSE'))).toBe(true);

    // Rename hook ran
    expect(existsSync(join(out, '.gitignore'))).toBe(true);
    expect(existsSync(join(out, 'gitignore'))).toBe(false);
    expect(result.renamed).toContainEqual({ from: 'gitignore', to: '.gitignore' });

    // package.json was templated
    const pkg = JSON.parse(await readFile(join(out, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('my-cli');
    expect(pkg.description).toBe('Demo CLI');
    expect(pkg.license).toBe('MIT');
    expect(pkg.bin['my-cli']).toBe('./dist/cli.js');

    // cli.ts contains the example command (include_examples = true)
    const cli = await readFile(join(out, 'src/cli.ts'), 'utf8');
    expect(cli).toContain("'my-cli'");
    expect(cli).toContain('Demo CLI');
    expect(cli).toContain('hello [name]');

    // LICENSE picked up MIT branch
    const license = await readFile(join(out, 'LICENSE'), 'utf8');
    expect(license).toContain('MIT License');
    expect(license).toContain('Alice');

    // README picked up author
    const readme = await readFile(join(out, 'README.md'), 'utf8');
    expect(readme).toContain('# my-cli');
    expect(readme).toContain('MIT © Alice');
  });

  it('drops the example command and src/examples/ when include_examples is false', async () => {
    const bundle = await loadFromPath(TEMPLATE_PATH);
    const answers = await runPrompts(
      bundle.manifest.prompts ?? [],
      fixedPrompter({
        project_name: 'minimal-cli',
        description: '',
        author: '',
        license: 'Apache-2.0',
        include_examples: false,
      }),
    );

    const out = join(work, 'minimal-cli');
    const result = await renderBundle(bundle, out, answers);

    // examples dir was deleted by post_render hook
    expect(existsSync(join(out, 'src/examples/hello.ts'))).toBe(false);
    expect(result.deleted).toContain('src/examples/hello.ts');

    // cli.ts does NOT include the example block
    const cli = await readFile(join(out, 'src/cli.ts'), 'utf8');
    expect(cli).not.toContain('hello [name]');
    expect(cli).toContain("'minimal-cli'");

    // LICENSE picked up Apache branch
    const license = await readFile(join(out, 'LICENSE'), 'utf8');
    expect(license).toContain('Apache License');
  });

  it('rejects an invalid project_name (pattern fails)', async () => {
    const bundle = await loadFromPath(TEMPLATE_PATH);
    await expect(
      runPrompts(
        bundle.manifest.prompts ?? [],
        fixedPrompter({
          project_name: 'BadName',
          description: '',
          author: '',
          license: 'MIT',
          include_examples: true,
        }),
      ),
    ).rejects.toThrow(/must match pattern/);
  });
});
