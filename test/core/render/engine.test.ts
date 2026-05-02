import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RenderError, renderBundle } from '../../../src/core/render/engine.js';
import { loadFromPath } from '../../../src/core/sources/file-source.js';

let work: string;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'hex-render-'));
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

async function writeFileEnsure(path: string, body: string | Buffer): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, body);
}

async function buildTemplate(spec: {
  manifest: string;
  files?: Record<string, string | Buffer>;
  hexignore?: string;
}): Promise<string> {
  const root = join(work, 'template');
  await mkdir(join(root, '.hex'), { recursive: true });
  await writeFile(join(root, '.hex', 'manifest.yaml'), spec.manifest, 'utf8');
  if (spec.hexignore) {
    await writeFile(join(root, '.hexignore'), spec.hexignore, 'utf8');
  }
  for (const [rel, body] of Object.entries(spec.files ?? {})) {
    await writeFileEnsure(join(root, rel), body);
  }
  return root;
}

describe('renderBundle — basic', () => {
  it('renders file contents and writes to the output path', async () => {
    const root = await buildTemplate({
      manifest: `type: component
name: demo
version: 0.1.0
`,
      files: {
        'README.md': 'Hello, {{ name }}!',
      },
    });
    const bundle = await loadFromPath(root);
    const out = join(work, 'out');
    const result = await renderBundle(bundle, out, { name: 'World' });
    expect(result.written).toEqual(['README.md']);
    expect(await readFile(join(out, 'README.md'), 'utf8')).toBe('Hello, World!');
  });

  it('renders templated filenames', async () => {
    const root = await buildTemplate({
      manifest: `type: component
name: demo
version: 0.1.0
`,
      files: {
        'src/{{ project_name }}.ts': '// generated for {{ project_name }}',
      },
    });
    const bundle = await loadFromPath(root);
    const out = join(work, 'out');
    await renderBundle(bundle, out, { project_name: 'cli' });
    expect(await readFile(join(out, 'src', 'cli.ts'), 'utf8')).toBe('// generated for cli');
  });

  it('skips the .hex/ directory itself', async () => {
    const root = await buildTemplate({
      manifest: `type: component
name: demo
version: 0.1.0
`,
      files: {
        'index.ts': 'ok',
        '.hex/extra.txt': 'should not be emitted',
      },
    });
    const bundle = await loadFromPath(root);
    const out = join(work, 'out');
    const result = await renderBundle(bundle, out, {});
    expect(result.written).toEqual(['index.ts']);
  });

  it('honours .hexignore', async () => {
    const root = await buildTemplate({
      manifest: `type: component
name: demo
version: 0.1.0
`,
      files: {
        'src/index.ts': 'keep',
        'node_modules/foo/index.js': 'should be ignored',
        'dist/x.js': 'also ignored',
      },
      hexignore: 'node_modules/\ndist/\n',
    });
    const bundle = await loadFromPath(root);
    const out = join(work, 'out');
    const result = await renderBundle(bundle, out, {});
    expect(result.written.sort()).toEqual(['src/index.ts']);
  });
});

describe('renderBundle — output directory policy', () => {
  it('refuses to render into a non-empty target without force', async () => {
    const root = await buildTemplate({
      manifest: `type: component
name: demo
version: 0.1.0
`,
      files: { 'a.txt': 'A' },
    });
    const bundle = await loadFromPath(root);
    const out = join(work, 'out');
    await mkdir(out, { recursive: true });
    await writeFile(join(out, 'preexisting'), 'hi', 'utf8');
    await expect(renderBundle(bundle, out, {})).rejects.toThrow(RenderError);
  });

  it('allows --force to render into a non-empty directory', async () => {
    const root = await buildTemplate({
      manifest: `type: component
name: demo
version: 0.1.0
`,
      files: { 'a.txt': 'A' },
    });
    const bundle = await loadFromPath(root);
    const out = join(work, 'out');
    await mkdir(out, { recursive: true });
    await writeFile(join(out, 'preexisting'), 'hi', 'utf8');
    await renderBundle(bundle, out, {}, { force: true });
    expect(await readFile(join(out, 'a.txt'), 'utf8')).toBe('A');
    expect(await readFile(join(out, 'preexisting'), 'utf8')).toBe('hi');
  });

  it('refuses to render into a path that exists and is a file', async () => {
    const root = await buildTemplate({
      manifest: `type: component
name: demo
version: 0.1.0
`,
    });
    const bundle = await loadFromPath(root);
    const out = join(work, 'out-file');
    await writeFile(out, 'hi', 'utf8');
    await expect(renderBundle(bundle, out, {})).rejects.toThrow(/not a directory/);
  });
});

describe('renderBundle — include rules', () => {
  it('skips a file when its include rule when: is false', async () => {
    const root = await buildTemplate({
      manifest: `type: component
name: demo
version: 0.1.0
include:
  - { path: Dockerfile, when: containerize }
`,
      files: {
        'index.ts': 'ok',
        Dockerfile: 'FROM node:20',
      },
    });
    const bundle = await loadFromPath(root);
    const out = join(work, 'out');
    const result = await renderBundle(bundle, out, { containerize: false });
    expect(result.written.sort()).toEqual(['index.ts']);
  });

  it('emits a file when its include rule when: is true', async () => {
    const root = await buildTemplate({
      manifest: `type: component
name: demo
version: 0.1.0
include:
  - { path: Dockerfile, when: containerize }
`,
      files: {
        'index.ts': 'ok',
        Dockerfile: 'FROM node:20',
      },
    });
    const bundle = await loadFromPath(root);
    const out = join(work, 'out');
    const result = await renderBundle(bundle, out, { containerize: true });
    expect(result.written.sort()).toEqual(['Dockerfile', 'index.ts']);
  });

  it('honours glob-style include rules', async () => {
    const root = await buildTemplate({
      manifest: `type: component
name: demo
version: 0.1.0
include:
  - { glob: 'src/main.vue', when: 'framework == "vue"' }
  - { glob: 'src/main.react.tsx', when: 'framework == "react"' }
`,
      files: {
        'src/main.vue': 'vue',
        'src/main.react.tsx': 'react',
        'src/main.svelte': 'svelte',
      },
    });
    const bundle = await loadFromPath(root);
    const out = join(work, 'out');
    const result = await renderBundle(bundle, out, { framework: 'react' });
    expect(result.written.sort()).toEqual(['src/main.react.tsx', 'src/main.svelte']);
  });
});

describe('renderBundle — binary files', () => {
  it('copies binary files verbatim without trying to render them', async () => {
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]);
    const root = await buildTemplate({
      manifest: `type: component
name: demo
version: 0.1.0
`,
      files: { 'logo.png': binary },
    });
    const bundle = await loadFromPath(root);
    const out = join(work, 'out');
    await renderBundle(bundle, out, {});
    const written = await readFile(join(out, 'logo.png'));
    expect(written.equals(binary)).toBe(true);
  });
});
