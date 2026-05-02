import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HookError, runPostRenderHooks } from '../../../src/core/hooks/declarative.js';

let work: string;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'hex-hooks-'));
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

async function writeFileEnsure(path: string, body: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, body, 'utf8');
}

async function setupOutput(files: Record<string, string>): Promise<string[]> {
  const written: string[] = [];
  for (const [rel, body] of Object.entries(files)) {
    await writeFileEnsure(join(work, rel), body);
    written.push(rel);
  }
  return written;
}

describe('runPostRenderHooks — rename', () => {
  it('renames a file in the output tree', async () => {
    const written = await setupOutput({ gitignore: 'node_modules\n' });
    const result = await runPostRenderHooks(
      work,
      [{ rename: { from: 'gitignore', to: '.gitignore' } }],
      {},
      written,
    );
    expect(result.renamed).toEqual([{ from: 'gitignore', to: '.gitignore' }]);
    expect(existsSync(join(work, 'gitignore'))).toBe(false);
    expect(await readFile(join(work, '.gitignore'), 'utf8')).toBe('node_modules\n');
  });

  it('skips when: false', async () => {
    const written = await setupOutput({ gitignore: 'x\n' });
    const result = await runPostRenderHooks(
      work,
      [{ rename: { from: 'gitignore', to: '.gitignore', when: 'never' } }],
      { never: false },
      written,
    );
    expect(result.renamed).toEqual([]);
    expect(existsSync(join(work, 'gitignore'))).toBe(true);
  });

  it('errors when source is missing', async () => {
    const written = await setupOutput({ other: 'x' });
    await expect(
      runPostRenderHooks(work, [{ rename: { from: 'missing', to: 'foo' } }], {}, written),
    ).rejects.toThrow(HookError);
  });

  it('errors when target already exists', async () => {
    const written = await setupOutput({ gitignore: 'x', '.gitignore': 'y' });
    await expect(
      runPostRenderHooks(work, [{ rename: { from: 'gitignore', to: '.gitignore' } }], {}, written),
    ).rejects.toThrow(HookError);
  });
});

describe('runPostRenderHooks — delete', () => {
  it('deletes a file by path', async () => {
    const written = await setupOutput({ 'src/legacy.ts': 'x', 'src/index.ts': 'y' });
    const result = await runPostRenderHooks(
      work,
      [{ delete: { path: 'src/legacy.ts' } }],
      {},
      written,
    );
    expect(result.deleted).toEqual(['src/legacy.ts']);
    expect(existsSync(join(work, 'src/legacy.ts'))).toBe(false);
    expect(existsSync(join(work, 'src/index.ts'))).toBe(true);
  });

  it('deletes files matching a glob', async () => {
    const written = await setupOutput({
      'src/examples/a.ts': 'a',
      'src/examples/b.ts': 'b',
      'src/index.ts': 'i',
    });
    const result = await runPostRenderHooks(
      work,
      [{ delete: { glob: 'src/examples/**' } }],
      {},
      written,
    );
    expect(result.deleted.sort()).toEqual(['src/examples/a.ts', 'src/examples/b.ts']);
    expect(existsSync(join(work, 'src/index.ts'))).toBe(true);
  });

  it('honours when: on a delete hook', async () => {
    const written = await setupOutput({ 'src/examples/a.ts': 'a', 'src/index.ts': 'i' });
    const result = await runPostRenderHooks(
      work,
      [{ delete: { glob: 'src/examples/**', when: 'not include_examples' } }],
      { include_examples: true },
      written,
    );
    expect(result.deleted).toEqual([]);
    expect(existsSync(join(work, 'src/examples/a.ts'))).toBe(true);
  });
});

describe('runPostRenderHooks — sequencing', () => {
  it('rename followed by delete-glob sees the new name', async () => {
    const written = await setupOutput({ gitignore: 'a', 'docs/foo.md': 'b' });
    const result = await runPostRenderHooks(
      work,
      [{ rename: { from: 'gitignore', to: '.gitignore' } }, { delete: { glob: 'docs/**' } }],
      {},
      written,
    );
    expect(result.renamed).toEqual([{ from: 'gitignore', to: '.gitignore' }]);
    expect(result.deleted).toEqual(['docs/foo.md']);
    expect(existsSync(join(work, '.gitignore'))).toBe(true);
    expect(existsSync(join(work, 'docs/foo.md'))).toBe(false);
  });
});
