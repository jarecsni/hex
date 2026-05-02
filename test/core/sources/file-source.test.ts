import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ManifestError } from '../../../src/core/manifest/parse.js';
import { SourceError, loadFromPath } from '../../../src/core/sources/file-source.js';

let work: string;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'hex-file-source-'));
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

async function writeManifest(
  rootPath: string,
  body: string,
  fileName = 'manifest.yaml',
): Promise<void> {
  await mkdir(join(rootPath, '.hex'), { recursive: true });
  await writeFile(join(rootPath, '.hex', fileName), body, 'utf8');
}

describe('FileSource — loadFromPath', () => {
  it('loads a valid template bundle', async () => {
    await writeManifest(
      work,
      `type: component
name: demo
version: 0.1.0
prompts:
  - project_name: { type: string, required: true }
`,
    );
    const bundle = await loadFromPath(work);
    expect(bundle.rootPath).toBe(work);
    expect(bundle.manifest.name).toBe('demo');
    expect(bundle.manifest.prompts?.[0]?.name).toBe('project_name');
  });

  it('also accepts manifest.yml as an alternative extension', async () => {
    await writeManifest(
      work,
      `type: component
name: demo
version: 0.1.0
`,
      'manifest.yml',
    );
    const bundle = await loadFromPath(work);
    expect(bundle.manifest.name).toBe('demo');
  });

  it('rejects a non-existent path', async () => {
    await expect(loadFromPath(join(work, 'does-not-exist'))).rejects.toThrow(SourceError);
  });

  it('rejects a path that is not a directory', async () => {
    const filePath = join(work, 'just-a-file.txt');
    await writeFile(filePath, 'hello', 'utf8');
    await expect(loadFromPath(filePath)).rejects.toThrow(SourceError);
  });

  it('rejects a directory missing .hex/manifest.yaml', async () => {
    await expect(loadFromPath(work)).rejects.toThrow(SourceError);
  });

  it('propagates manifest validation errors', async () => {
    await writeManifest(
      work,
      `type: component
name: demo
version: not-a-version
`,
    );
    await expect(loadFromPath(work)).rejects.toThrow(ManifestError);
  });

  it('resolves a relative path against cwd', async () => {
    await writeManifest(
      work,
      `type: component
name: demo
version: 0.1.0
`,
    );
    const cwd = process.cwd();
    process.chdir(work);
    try {
      const bundle = await loadFromPath('.');
      expect(bundle.manifest.name).toBe('demo');
    } finally {
      process.chdir(cwd);
    }
  });
});
